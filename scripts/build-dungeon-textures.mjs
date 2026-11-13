// Dungeon card textures for the addon (9.2.x): converts the approved paintings in site/dungeon-art/*.jpg into in-game
// textures the WoW client loads from an addon folder.
//   node scripts/build-dungeon-textures.mjs                 write addon/Guilded/Media/Dungeons/<key>.blp (default 512x256 DXT1)
//   node scripts/build-dungeon-textures.mjs --report        build every option in memory and print sizes (writes nothing)
//   node scripts/build-dungeon-textures.mjs --size 256x128  another size   --format tga   TGA instead of BLP
//   node scripts/build-dungeon-textures.mjs --preview DIR   also write PNG previews of what the game will show
// Each texture is the painting cropped to 2:1, darkened and vignetted so white text stays readable, with its lower part
// fading into the card's own background colour (so the addon needs no gradient layer). Uses sharp (already a dependency)
// and fflate (already a dependency, only to estimate the zipped size). The BLP2 DXT1 writer below is our own: sharp cannot write BLP.
import { readdirSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { zipSync } from "fflate";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
export const ART_DIR = join(repo, "site", "dungeon-art");
export const OUT_DIR = join(repo, "addon", "Guilded", "Media", "Dungeons");
/** The card background colour (RunResults.lua SetBackdropColor 0.035,0.045,0.065), 0-255. */
const BG = [9, 11, 17];

export function paintingKeys() {
  return readdirSync(ART_DIR).filter((f) => f.endsWith(".jpg")).map((f) => f.slice(0, -4)).sort();
}

/** RGBA-free raw RGB (w*h*3) of one painting: cropped to 2:1, darkened, vignetted, bottom faded into the card background. */
export async function renderRgb(key, width, height) {
  const base = await sharp(join(ART_DIR, `${key}.jpg`)).resize(width, height, { fit: "cover", position: "centre" }).removeAlpha().raw().toBuffer();
  const out = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    const fy = y / (height - 1);
    // Fade into the background over the lower 45%; keep some of the picture even at the very bottom edge.
    const fade = fy < 0.55 ? 0 : Math.min(1, (fy - 0.55) / 0.45) ** 1.4;
    for (let x = 0; x < width; x++) {
      const fx = x / (width - 1);
      const dx = (fx - 0.5) * 2, dy = (fy - 0.4) * 1.6;
      const vignette = 1 - Math.min(0.5, 0.32 * (dx * dx + dy * dy));
      const dark = 0.62 * vignette;           // overall darkening: the painting stays recognisable, white text stays readable
      for (let c = 0; c < 3; c++) {
        const i = (y * width + x) * 3 + c;
        const v = base[i] * dark;
        out[i] = Math.round(v * (1 - fade) + BG[c] * fade);
      }
    }
  }
  return out;
}

// ---- TGA: 24-bit uncompressed, origin top-left (descriptor bit 5), the format the addon's logo already uses.
export function encodeTga(rgb, width, height) {
  const header = Buffer.alloc(18);
  header[2] = 2; header.writeUInt16LE(width, 12); header.writeUInt16LE(height, 14); header[16] = 24; header[17] = 0x20;
  const px = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) { px[i * 3] = rgb[i * 3 + 2]; px[i * 3 + 1] = rgb[i * 3 + 1]; px[i * 3 + 2] = rgb[i * 3]; }
  return Buffer.concat([header, px]);
}

// ---- BLP2 with DXT1 and a full mip chain (same container the client's own DXT1 files use: colour encoding 2, no alpha).
const to565 = (r, g, b) => ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
const from565 = (v) => [((v >> 11) & 31) * 255 / 31, ((v >> 5) & 63) * 255 / 63, (v & 31) * 255 / 31];

function dxt1Block(rgb, width, bx, by) {
  const px = [];
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    const i = ((by * 4 + y) * width + bx * 4 + x) * 3;
    px.push([rgb[i], rgb[i + 1], rgb[i + 2]]);
  }
  // Endpoints: the pair of block pixels farthest apart along the block's principal colour axis (power iteration).
  const mean = [0, 1, 2].map((c) => px.reduce((s, p) => s + p[c], 0) / 16);
  let axis = [1, 1, 1];
  for (let it = 0; it < 4; it++) {
    const next = [0, 0, 0];
    for (const p of px) { const d = [p[0] - mean[0], p[1] - mean[1], p[2] - mean[2]]; const dot = d[0] * axis[0] + d[1] * axis[1] + d[2] * axis[2]; for (let c = 0; c < 3; c++) next[c] += d[c] * dot; }
    const len = Math.hypot(...next) || 1; axis = next.map((v) => v / len);
  }
  let lo = px[0], hi = px[0], loD = Infinity, hiD = -Infinity;
  for (const p of px) { const d = p[0] * axis[0] + p[1] * axis[1] + p[2] * axis[2]; if (d < loD) { loD = d; lo = p; } if (d > hiD) { hiD = d; hi = p; } }
  let c0 = to565(hi[0], hi[1], hi[2]), c1 = to565(lo[0], lo[1], lo[2]);
  if (c0 < c1) [c0, c1] = [c1, c0];
  const out = Buffer.alloc(8);
  out.writeUInt16LE(c0, 0); out.writeUInt16LE(c1, 2);
  if (c0 === c1) return out; // flat block: every index 0
  const a = from565(c0), b = from565(c1);
  const pal = [a, b, a.map((v, i) => (2 * v + b[i]) / 3), a.map((v, i) => (v + 2 * b[i]) / 3)];
  let bits = 0;
  px.forEach((p, n) => {
    let best = 0, bestD = Infinity;
    pal.forEach((q, k) => { const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2; if (d < bestD) { bestD = d; best = k; } });
    bits |= best << (n * 2);
  });
  out.writeUInt32LE(bits >>> 0, 4);
  return out;
}
function dxt1(rgb, width, height) {
  const blocks = [];
  for (let by = 0; by < height / 4; by++) for (let bx = 0; bx < width / 4; bx++) blocks.push(dxt1Block(rgb, width, bx, by));
  return Buffer.concat(blocks);
}
function halve(rgb, width, height) {
  const w = width >> 1, h = height >> 1, out = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
    const at = (xx, yy) => rgb[((yy * width) + xx) * 3 + c];
    out[(y * w + x) * 3 + c] = Math.round((at(2 * x, 2 * y) + at(2 * x + 1, 2 * y) + at(2 * x, 2 * y + 1) + at(2 * x + 1, 2 * y + 1)) / 4);
  }
  return out;
}
export function encodeBlp(rgb, width, height) {
  const mips = [];
  let cur = rgb, w = width, h = height;
  while (true) {
    mips.push(dxt1(cur, Math.max(w, 4), Math.max(h, 4)));
    if (w <= 4 && h <= 4) break;
    // 4x4 is the smallest block image; below that the chain stops (the client accepts a short chain).
    cur = halve(cur, w, h); w >>= 1; h >>= 1;
    if (w < 4 || h < 4) break;
  }
  const header = Buffer.alloc(148 + 1024);
  header.write("BLP2", 0, "ascii"); header.writeUInt32LE(1, 4);
  header[8] = 2; header[9] = 0; header[10] = 0; header[11] = 1; // DXT, no alpha, DXT1, has mips
  header.writeUInt32LE(width, 12); header.writeUInt32LE(height, 16);
  let offset = header.length;
  mips.forEach((m, i) => { header.writeUInt32LE(offset, 20 + i * 4); header.writeUInt32LE(m.length, 84 + i * 4); offset += m.length; });
  return Buffer.concat([header, ...mips]);
}

const FORMATS = { blp: { encode: encodeBlp, ext: "blp" }, tga: { encode: encodeTga, ext: "tga" } };

export async function build(key, width, height, format) {
  return FORMATS[format].encode(await renderRgb(key, width, height), width, height);
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
  const keys = paintingKeys();
  if (args.includes("--report")) {
    const rows = [];
    for (const size of ["512x256", "256x128"]) for (const format of ["blp", "tga"]) {
      const [w, h] = size.split("x").map(Number);
      let raw = 0; const zipFiles = {}; let biggest = 0;
      for (const key of keys) { const data = await build(key, w, h, format); raw += data.length; biggest = Math.max(biggest, data.length); zipFiles[`${key}.${format}`] = new Uint8Array(data); }
      const zipped = zipSync(zipFiles, { level: 9 });
      rows.push({ option: `${format.toUpperCase()} ${size}`, files: keys.length, perFile: Math.round(raw / keys.length), raw, zipped: zipped.length });
    }
    console.table(rows.map((r) => ({ ...r, perFileKB: (r.perFile / 1024).toFixed(0), rawMB: (r.raw / 1048576).toFixed(2), zippedMB: (r.zipped / 1048576).toFixed(2) })));
    return;
  }
  const [w, h] = opt("--size", "512x256").split("x").map(Number);
  const format = opt("--format", "blp");
  if (!FORMATS[format]) throw new Error(`Unknown format ${format} (blp or tga).`);
  if (w % 4 || h % 4 || (w & (w - 1)) || (h & (h - 1))) throw new Error("Textures must be power-of-two sizes.");
  const preview = opt("--preview", null);
  if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });
  if (preview) mkdirSync(preview, { recursive: true });
  let total = 0;
  for (const key of keys) {
    const rgb = await renderRgb(key, w, h);
    const data = FORMATS[format].encode(rgb, w, h);
    writeFileSync(join(OUT_DIR, `${key}.${FORMATS[format].ext}`), data);
    total += data.length;
    if (preview) await sharp(rgb, { raw: { width: w, height: h, channels: 3 } }).png().toFile(join(preview, `${key}.png`));
  }
  console.log(`Wrote ${keys.length} ${format.toUpperCase()} ${w}x${h} textures to ${OUT_DIR} (${(total / 1048576).toFixed(2)} MB).`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
