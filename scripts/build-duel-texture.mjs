// The end-of-duel card's painting (9.3): converts the approved duel painting (scripts/art-src/duel-card.jpg, the 1032x516 crop of
// board-duel-v2.png with the two fighters on the right) into addon/Guilded/Media/DuelCard.blp (512x256 DXT1, power of two).
// The left 55% is darkened toward the card colour so the text keeps contrast; the addon adds its own scrim and a win/defeat tint.
//   node scripts/build-duel-texture.mjs [--preview out.png]
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { encodeBlp } from "./build-dungeon-textures.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const W = 512, H = 256, BG = [9, 11, 17];
const base = await sharp(join(repo, "scripts", "art-src", "duel-card.jpg")).resize(W, H, { fit: "cover" }).removeAlpha().raw().toBuffer();
const out = Buffer.alloc(W * H * 3);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const fx = x / (W - 1), fy = y / (H - 1);
  const left = Math.min(1, Math.max(0, (0.62 - fx) / 0.5));       // 1 at the far left, 0 from 62% across
  const bottom = fy < 0.7 ? 0 : (fy - 0.7) / 0.3;                  // fades into the card colour at the bottom edge
  const mix = Math.min(0.9, 0.78 * left + 0.55 * bottom);
  for (let c = 0; c < 3; c++) {
    const i = (y * W + x) * 3 + c;
    out[i] = Math.round(base[i] * 0.8 * (1 - mix) + BG[c] * mix);
  }
}
const data = encodeBlp(out, W, H);
writeFileSync(join(repo, "addon", "Guilded", "Media", "DuelCard.blp"), data);
const i = process.argv.indexOf("--preview");
if (i >= 0) await sharp(out, { raw: { width: W, height: H, channels: 3 } }).png().toFile(process.argv[i + 1]);
console.log(`Wrote DuelCard.blp ${W}x${H} (${(data.length / 1024).toFixed(0)} KB).`);
