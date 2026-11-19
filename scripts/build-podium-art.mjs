// Podium art (19 Nov 2026): cuts the owner-approved painted emblem sheets (flat magenta #FF00FF, kept outside the repository in
// Guilded-Art\podium-emblems-19nov) into the small transparent WebP files in site/podium-art/ that the community leaderboard and the weekly
// card draw (src/services/podium-art.ts). Reuses the badge-art cut-out, so the dark painted outline keeps its colour and no pink fringe is left.
//   node scripts/build-podium-art.mjs --source "C:\Users\Kev\Desktop\Guilded-Art\podium-emblems-19nov"
//   node scripts/build-podium-art.mjs --check
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { cutOut, magentaResidue } from "./build-badge-art.mjs";

export const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "site", "podium-art");
/** Sheet file, grid (columns x rows), the names in reading order, and the output size (the longest side). */
export const SHEETS = [
  { file: "sheet-a-medals.png", cols: 3, rows: 2, size: 192, names: ["medal-gold", "medal-silver", "medal-bronze", "crown", "mvp-shield", "rookie-banner"] },
  { file: "sheet-b-icons.png", cols: 4, rows: 2, size: 96, names: ["icon-points", "icon-messages", "icon-voice", "icon-dungeons", "icon-newcomers", "icon-activities", "icon-reactions", "icon-raids"] }
];
export const MAX_FILE_BYTES = 30_000, MAX_TOTAL_BYTES = 200_000;
export const expectedFiles = () => SHEETS.flatMap((s) => s.names.map((n) => `${n}.webp`));

async function cell(source, sheet, index) {
  const meta = await sharp(source).metadata();
  const cw = Math.floor(meta.width / sheet.cols), ch = Math.floor(meta.height / sheet.rows);
  const col = index % sheet.cols, row = Math.floor(index / sheet.cols);
  const crop = await sharp(source).extract({ left: col * cw, top: row * ch, width: cw, height: ch }).png().toBuffer();
  const { data, width, height } = await cutOut(crop);
  const trimmed = await sharp(data, { raw: { width, height, channels: 4 } }).trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 }).png().toBuffer();
  return sharp(trimmed).resize(sheet.size, sheet.size, { fit: "inside", kernel: "lanczos3" }).webp({ quality: 90, alphaQuality: 100, effort: 6 }).toBuffer();
}

export async function build(dir) {
  mkdirSync(OUT_DIR, { recursive: true });
  let total = 0;
  for (const sheet of SHEETS) for (const [i, name] of sheet.names.entries()) {
    const buffer = await cell(join(dir, sheet.file), sheet, i);
    writeFileSync(join(OUT_DIR, `${name}.webp`), buffer); total += buffer.length;
    console.log(`${name}.webp ${buffer.length}`);
  }
  console.log(`total ${total} bytes`);
}

export async function check() {
  const problems = []; let total = 0;
  for (const name of expectedFiles()) {
    const file = join(OUT_DIR, name);
    if (!existsSync(file)) { problems.push(`missing ${name}`); continue; }
    const bytes = statSync(file).size; total += bytes;
    if (bytes > MAX_FILE_BYTES) problems.push(`${name} is ${bytes} bytes (limit ${MAX_FILE_BYTES})`);
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (data[3] !== 0) problems.push(`${name} has an opaque corner (not cut out)`);
    if (magentaResidue(data, info.width, info.height) > 0.002) problems.push(`${name} still has magenta`);
  }
  if (total > MAX_TOTAL_BYTES) problems.push(`assets total ${total} bytes (limit ${MAX_TOTAL_BYTES})`);
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2), at = args.indexOf("--source");
  if (args.includes("--check")) {
    const problems = await check();
    if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
    console.log(`podium art ok (${expectedFiles().length} files)`);
  } else if (at >= 0) await build(args[at + 1]);
  else { console.error("usage: build-podium-art.mjs --source DIR | --check"); process.exit(2); }
}
