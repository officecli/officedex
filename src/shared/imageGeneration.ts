import type { ImageCameraSettings, ImageGenerationInput } from "./uiPort";

/**
 * The image options, and the arithmetic both sides of the port need.
 *
 * The composer shows a size under the ratio buttons and the service sends that
 * same size to the runtime. Computing it twice, once per layer, is how "16:9 ·
 * 2K" would come to mean 2048×1152 on screen and something else on the wire.
 */

export type ImageRatio = ImageGenerationInput["ratio"];
export type ImageResolution = ImageGenerationInput["resolution"];
export type ImageStyle = ImageGenerationInput["style"];

/** The order the settings popover lays them out in; `custom` is reached by typing a size. */
export const IMAGE_RATIOS: readonly Exclude<ImageRatio, "custom">[] = [
  "auto",
  "1:1",
  "3:4",
  "16:9",
  "4:3",
  "9:16",
  "2:3",
  "3:2",
  "21:9",
];

export const IMAGE_RESOLUTIONS: readonly { value: ImageResolution; label: string; edge: number }[] = [
  { value: "1K", label: "Standard", edge: 1024 },
  { value: "2K", label: "High", edge: 2048 },
  { value: "4K", label: "Ultra", edge: 4096 },
];

export const IMAGE_COUNTS = [1, 2, 3, 4] as const;

/*
 * What the default image model accepts (gpt-image-2 behind the hosted route):
 * each edge 256–3840 and a multiple of 16, total pixels between 655,360 and
 * 8,294,400, and no more than 3:1 either way. A size outside this is rejected
 * or silently replaced upstream, so the composer never offers one.
 */
export const MIN_IMAGE_EDGE = 256;
export const MAX_IMAGE_EDGE = 3840;
export const MIN_IMAGE_PIXELS = 655_360;
export const MAX_IMAGE_PIXELS = 8_294_400;
export const MAX_IMAGE_ASPECT = 3;
export const MAX_REFERENCES = 4;

export const IMAGE_STYLES: readonly { value: ImageStyle; label: string; detail: string }[] = [
  { value: "auto", label: "Auto", detail: "Follow your prompt" },
  { value: "photo", label: "Photo", detail: "Natural light and realistic detail" },
  { value: "cinematic", label: "Cinematic", detail: "Atmosphere, depth and film-like light" },
  { value: "illustration", label: "Illustration", detail: "Editorial shapes and expressive color" },
  { value: "3d", label: "3D render", detail: "Dimensional objects and studio materials" },
  { value: "minimal", label: "Minimal", detail: "Clean shapes and open space" },
];

export const CAMERA_FIELDS: readonly { key: keyof ImageCameraSettings; label: string; values: readonly string[] }[] = [
  {
    key: "body",
    label: "Camera body",
    values: ["Sony Venice", "Arri Alexa 35", "Arri Alexa 65", "Red V-Raptor", "Panavision DXL2", "IMAX Film Camera"],
  },
  {
    key: "lens",
    label: "Lens",
    values: ["Zeiss Ultra Prime", "Arri Signature Prime", "Canon K-35", "Cooke S4", "Panavision C-series", "Hawk Class X"],
  },
  { key: "focal", label: "Focal length", values: ["8mm", "14mm", "24mm", "35mm", "50mm", "75mm", "125mm", "200mm"] },
  { key: "aperture", label: "Aperture", values: ["f/1.4", "f/2", "f/2.8", "f/4", "f/5.6", "f/8", "f/11"] },
];

export const DEFAULT_CAMERA: ImageCameraSettings = {
  body: "Arri Alexa 35",
  lens: "Zeiss Ultra Prime",
  focal: "35mm",
  aperture: "f/2.8",
};

/**
 * Pixel size for a ratio at a resolution — the long edge is the resolution,
 * as far as the model allows.
 *
 * The resolution is where the size starts, not a promise: 4K square is 16.7M
 * pixels and the model stops at 8.3M, 1K at 21:9 is too few. So the shape is
 * kept and the size is scaled into range, then snapped to 16. The number the
 * settings panel shows is this one, so what is shown is what is sent.
 *
 * `auto` has no shape of its own and reads as square, which is also what the
 * runtime falls back to when it is given no ratio.
 */
export function imageDimensions(
  input: Pick<ImageGenerationInput, "ratio" | "resolution" | "width" | "height">,
): [number, number] {
  if (input.ratio === "custom" && input.width && input.height) return [input.width, input.height];
  const [w, h] = (input.ratio === "auto" || input.ratio === "custom" ? "1:1" : input.ratio).split(":").map(Number);
  const edge = IMAGE_RESOLUTIONS.find((entry) => entry.value === input.resolution)?.edge ?? 2048;
  let width = w >= h ? edge : (edge * w) / h;
  let height = w >= h ? (edge * h) / w : edge;
  // Largest scale that keeps both the edge and the area inside the limits…
  const shrink = Math.min(1, MAX_IMAGE_EDGE / Math.max(width, height), Math.sqrt(MAX_IMAGE_PIXELS / (width * height)));
  // …and the smallest that reaches the minimum area.
  const grow = Math.max(1, Math.sqrt(MIN_IMAGE_PIXELS / (width * height)));
  const scale = shrink < 1 ? shrink : grow;
  width *= scale;
  height *= scale;
  // Down, not nearest, when shrinking: rounding up can step back over a limit.
  const snap = (value: number) =>
    Math.min(MAX_IMAGE_EDGE, Math.max(MIN_IMAGE_EDGE, (scale < 1 ? Math.floor(value / 16) : Math.ceil(value / 16)) * 16));
  return [snap(width), snap(height)];
}

/** Why a typed size cannot be sent, or null when it can. */
export function imageSizeProblem(width: number, height: number): string | null {
  if (!isValidImageEdge(width) || !isValidImageEdge(height)) {
    return `Enter a whole number from ${MIN_IMAGE_EDGE} to ${MAX_IMAGE_EDGE}.`;
  }
  if (width % 16 !== 0 || height % 16 !== 0) return "Use a multiple of 16 for each side.";
  const pixels = width * height;
  if (pixels < MIN_IMAGE_PIXELS) return "That size is too small. Try at least 816 × 816.";
  if (pixels > MAX_IMAGE_PIXELS) return "That size is too large. Try at most 2880 × 2880.";
  if (Math.max(width, height) / Math.min(width, height) > MAX_IMAGE_ASPECT) {
    return "Keep the long side within three times the short side.";
  }
  return null;
}

/** The runtime's three-way ratio, for providers that only understand that much. */
export function ratioBucket(width: number, height: number): "square" | "landscape" | "portrait" {
  const aspect = width / height;
  if (aspect > 1.05) return "landscape";
  if (aspect < 0.95) return "portrait";
  return "square";
}

export function isValidImageEdge(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_IMAGE_EDGE && value <= MAX_IMAGE_EDGE;
}

/**
 * The look, as the one sentence the runtime takes for it.
 *
 * The runtime has a `style` argument and nothing for a camera, and it turns
 * `style` into a line of the prompt anyway. So the camera rides along in the
 * same sentence rather than being appended to what the user typed — their
 * words stay exactly theirs in the task history.
 */
export function imageStyleText(input: Pick<ImageGenerationInput, "style" | "camera">): string {
  const parts: string[] = [];
  const style = IMAGE_STYLES.find((entry) => entry.value === input.style);
  if (style && style.value !== "auto") parts.push(style.label);
  const camera = input.camera;
  if (camera) {
    parts.push(`shot on ${camera.body} with ${camera.lens}, ${camera.focal}, ${camera.aperture}`);
  }
  return parts.join(", ");
}

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);

/** Whether a path names a picture the runtime accepts as a reference. */
export function isReferenceImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(path.split(".").pop()?.toLowerCase() ?? "");
}
