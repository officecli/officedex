import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { applyImageFills } from "./fill.mjs";
import { generateImage } from "./llm.mjs";

export function classifyPicture(pic, pageKind = "", canvas = {}) {
  const w = pic?.width || 0;
  const h = pic?.height || 0;
  const canvasW = canvas.widthPt || 960;
  const canvasH = canvas.heightPt || 540;
  if (pic?.logo) return "logo";
  if (w > canvasW * 0.85 && h > canvasH * 0.85) {
    if (/cover|closing|section-divider/.test(pageKind)) return "chrome";
    return "chrome";
  }
  if (Math.min(w, h) < 90 && Math.max(w, h) < 160) return "icon";
  return "photo";
}

export function photoPrompt(slot, facts = {}) {
  const kind = slot.pageKind || "";
  const purpose = slot.purpose || "";
  const caption = slot.caption || (slot.bullets || []).join("、");
  if (kind === "team" || /团队/.test(purpose)) {
    const person = slot.person || {};
    const name = person.name || "an East Asian professional";
    const role = person.role || "office teammate";
    return `Black-and-white studio portrait photograph of ${name}, an East Asian ${role}, looking at camera, natural expression, head and shoulders, soft lighting, no text, no logo, photorealistic. Unique composition for slot ${slot.slotId}.`;
  }
  if (kind === "split-image" || /图文/.test(purpose)) {
    return `Photorealistic documentary photo for a Chinese SaaS company intro: ${purpose || "team collaboration"}. ${caption}. Office or product context, natural light, no text, no logos, no watermarks. Slot ${slot.slotId}.`;
  }
  const subject = caption || purpose || "people collaborating in a modern office on documents";
  return `Photorealistic editorial photo of ${subject}, modern Chinese office, natural light, no text, no logos, no watermarks. Distinct scene for slot ${slot.slotId}.`;
}

export function imageSizeFor(slot) {
  const w = slot.width || 1;
  const h = slot.height || 1;
  const ratio = w / h;
  if (ratio > 1.25) return "1536x1024";
  if (ratio < 0.8) return "1024x1536";
  return "1024x1024";
}

export async function replacePhotos({ mopRoot, mopDir, slots, facts, cacheDir }) {
  const photos = (slots || []).filter((slot) => slot.kind === "photo");
  const fills = [];
  for (const slot of photos) {
    const prompt = photoPrompt(slot, facts);
    const key = crypto.createHash("sha1").update(prompt + imageSizeFor(slot)).digest("hex").slice(0, 16);
    const cacheFile = cacheDir ? path.join(cacheDir, `${key}.png`) : "";
    let bytes;
    if (cacheFile) {
      try { bytes = await fs.readFile(cacheFile); } catch { bytes = null; }
    }
    if (!bytes) {
      try {
        const image = await generateImage(prompt, { size: imageSizeFor(slot) });
        bytes = image.bytes;
        if (cacheFile && bytes) {
          await fs.mkdir(path.dirname(cacheFile), { recursive: true });
          await fs.writeFile(cacheFile, bytes);
        }
      } catch (err) {
        console.warn(`[images] skip ${slot.slotId}: ${err.message}`);
        continue;
      }
    }
    const installed = await writeMedia(mopDir, bytes);
    fills.push({ slotId: slot.slotId, ...installed });
    console.log(`[images] ${slot.slotId} ${slot.pageKind} ${installed.digest.slice(0, 10)}`);
  }
  applyImageFills(mopRoot, fills);
  return fills;
}

export async function writeMedia(mopDir, bytes) {
  const hex = crypto.createHash("sha256").update(bytes).digest("hex");
  const mime = bytes[0] === 0xff ? "image/jpeg" : "image/png";
  const ext = mime === "image/jpeg" ? "jpg" : "png";
  const dir = path.join(mopDir, "media");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${hex}.${ext}`), bytes);
  return { digest: hex, extension: ext, contentType: mime, size: bytes.length };
}
