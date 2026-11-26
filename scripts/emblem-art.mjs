// Shared pieces for the Guilded app icons (phone and Windows), cut from three painted sources:
//   docs/branding/guilded-logo-emblem-cut.png   the emblem (crown, G, frame) on a transparent background
//   docs/branding/guilded-backdrop.webp         the navy brush-stroke backdrop, empty
//   docs/branding/guilded-logo-emblem.png       the emblem as painted (used where the old art is still right)
// The emblem is fitted by the distance of its farthest painted pixel from its centre, so a circular mask
// (Android adaptive icon, Android splash screen, round avatars) never clips the crown or the bottom gem.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

export const at = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const CUT = readFileSync(at("docs/branding/guilded-logo-emblem-cut.png"));
const BACKDROP = readFileSync(at("docs/branding/guilded-backdrop.webp"));
const PNG = { compressionLevel: 9 };

let measured;
/** The emblem's bounding box and the radius (in source pixels) of the circle that holds all of it. */
async function emblem() {
  if (measured) return measured;
  const { data, info } = await sharp(CUT).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const painted = [];
  let left = info.width, top = info.height, right = 0, bottom = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] <= 128) continue;
      painted.push(x, y);
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  const box = { left, top, width: right - left + 1, height: bottom - top + 1 };
  let radius = 0;
  for (let i = 0; i < painted.length; i += 2) {
    radius = Math.max(radius, Math.hypot(painted[i] - left - box.width / 2, painted[i + 1] - top - box.height / 2));
  }
  measured = { box, radius, image: await sharp(CUT).extract(box).png().toBuffer() };
  return measured;
}

/** The emblem scaled so it fits a circle of `radius` pixels, with the offset that centres it on a canvas. */
async function placed(width, height, radius) {
  const { box, radius: full, image } = await emblem();
  const scale = radius / full;
  const w = Math.round(box.width * scale), h = Math.round(box.height * scale);
  const input = await sharp(image).resize(w, h).png().toBuffer();
  return { input, left: Math.round((width - w) / 2), top: Math.round((height - h) / 2) };
}

/** The backdrop covering a width x height canvas (centre crop). */
export function backdrop(width, height = width) {
  return sharp(BACKDROP).resize(width, height, { fit: "cover", position: "centre" }).png(PNG).toBuffer();
}

/** The emblem alone on a transparent canvas. */
export async function cutout(size, radius) {
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([await placed(size, size, radius)]).png(PNG).toBuffer();
}

/** The emblem on the painted backdrop, opaque. */
export async function tile(width, height, radius) {
  return sharp(await backdrop(width, height)).composite([await placed(width, height, radius)]).removeAlpha().png(PNG).toBuffer();
}

/** A white silhouette of the gold parts only (Android themed icon and notification icon). */
export async function silhouette(size, radius) {
  const { data, info } = await sharp(await cutout(1024, 500)).raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(data.length, 255);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const gold = r > 120 && r > b + 40 && g > b;
    out[i + 3] = gold ? data[i + 3] : 0;
  }
  const white = await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  // 500 px of the 1024 working canvas is the emblem's radius: scale the whole canvas to match the asked radius.
  const scaled = Math.round(1024 * radius / 500);
  if (scaled <= size) {
    const input = await sharp(white).resize(scaled, scaled).png().toBuffer();
    const offset = Math.round((size - scaled) / 2);
    return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input, left: offset, top: offset }]).png(PNG).toBuffer();
  }
  const trim = Math.round((scaled - size) / 2);
  const resized = await sharp(white).resize(scaled, scaled).png().toBuffer();
  return sharp(resized).extract({ left: trim, top: trim, width: size, height: size }).png(PNG).toBuffer();
}
