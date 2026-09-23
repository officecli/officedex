import { describe, expect, it } from "vitest";

import {
  IMAGE_RATIOS,
  IMAGE_RESOLUTIONS,
  MAX_IMAGE_ASPECT,
  MAX_IMAGE_EDGE,
  MAX_IMAGE_PIXELS,
  MIN_IMAGE_PIXELS,
  imageDimensions,
  imageSizeProblem,
  imageStyleText,
  ratioBucket,
} from "./imageGeneration";

describe("imageDimensions", () => {
  it("puts the resolution on the long edge when the model allows it", () => {
    expect(imageDimensions({ ratio: "16:9", resolution: "2K" })).toEqual([2048, 1152]);
    expect(imageDimensions({ ratio: "9:16", resolution: "2K" })).toEqual([1152, 2048]);
    expect(imageDimensions({ ratio: "1:1", resolution: "1K" })).toEqual([1024, 1024]);
  });

  it("scales a size the model would refuse back into range, keeping its shape", () => {
    // 4K square is 16.7M pixels; the model stops at 8.3M.
    expect(imageDimensions({ ratio: "1:1", resolution: "4K" })).toEqual([2880, 2880]);
    // 4K 16:9 would be 4096 wide; the edge limit is 3840.
    expect(imageDimensions({ ratio: "16:9", resolution: "4K" })).toEqual([3840, 2160]);
    // 1K at 21:9 is too few pixels.
    const [width, height] = imageDimensions({ ratio: "21:9", resolution: "1K" });
    expect(width * height).toBeGreaterThanOrEqual(MIN_IMAGE_PIXELS);
    expect(width / height).toBeCloseTo(21 / 9, 1);
  });

  it("never offers a size the model rejects, for any ratio at any resolution", () => {
    for (const ratio of IMAGE_RATIOS) {
      for (const { value: resolution } of IMAGE_RESOLUTIONS) {
        const [width, height] = imageDimensions({ ratio, resolution });
        expect(imageSizeProblem(width, height), `${ratio} @ ${resolution} = ${width}x${height}`).toBeNull();
        expect(Math.max(width, height)).toBeLessThanOrEqual(MAX_IMAGE_EDGE);
        expect(width * height).toBeLessThanOrEqual(MAX_IMAGE_PIXELS);
        expect(Math.max(width, height) / Math.min(width, height)).toBeLessThanOrEqual(MAX_IMAGE_ASPECT);
      }
    }
  });

  it("uses a typed size as-is", () => {
    expect(imageDimensions({ ratio: "custom", resolution: "2K", width: 1536, height: 1024 })).toEqual([1536, 1024]);
  });
});

describe("imageSizeProblem", () => {
  it("names what is wrong with a typed size", () => {
    expect(imageSizeProblem(1000, 1024)).toMatch(/multiple of 16/);
    expect(imageSizeProblem(4096, 1024)).toMatch(/256 to 3840/);
    expect(imageSizeProblem(512, 512)).toMatch(/too small/);
    expect(imageSizeProblem(3840, 3840)).toMatch(/too large/);
    expect(imageSizeProblem(3072, 768)).toMatch(/three times/);
    expect(imageSizeProblem(1536, 1024)).toBeNull();
  });
});

describe("ratioBucket", () => {
  it("maps a size onto the runtime's three shapes", () => {
    expect(ratioBucket(2048, 1152)).toBe("landscape");
    expect(ratioBucket(1152, 2048)).toBe("portrait");
    expect(ratioBucket(1024, 1024)).toBe("square");
  });
});

describe("imageStyleText", () => {
  it("is empty when nothing about the look was chosen", () => {
    expect(imageStyleText({ style: "auto", camera: null })).toBe("");
  });

  it("joins the style and the camera into one sentence", () => {
    expect(
      imageStyleText({
        style: "cinematic",
        camera: { body: "Arri Alexa 35", lens: "Cooke S4", focal: "50mm", aperture: "f/2" },
      }),
    ).toBe("Cinematic, shot on Arri Alexa 35 with Cooke S4, 50mm, f/2");
  });
});
