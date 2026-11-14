// Badge art (9.3): turns the owner-approved badge paintings (style A, painted metal medallion) into the web-ready assets in site/badge-art/.
//   node scripts/build-badge-art.mjs --source DIR     cut out, trim, centre and write the assets (DIR holds frames/<tier>.png and emblems/<key>.png)
//   node scripts/build-badge-art.mjs --check          verify the committed assets (CI): every expected file, transparent, no magenta, within the size budget
//   node scripts/build-badge-art.mjs --source DIR --only emblems --emblem dungeons-torch   a later batch: name the newly approved emblems
// The source paintings (about 1254 x 1254 on flat magenta #FF00FF) are NOT in the repository, only the processed assets are.
// Cut-out: the background is unmixed rather than thresholded. Every pixel within two pixels of a definite background pixel is treated as
// subject * (1 - f) + magenta * f, and the subject colour and alpha are recovered from f, so the dark painted outline keeps its colour and
// no pink fringe is left. Pixels further inside the picture are never touched (a purple frame is not mistaken for background).
// Output: transparent WebP, 256 px (the Discord hero badge) and 128 px (list rows; also the website's 64 px badge at 2x), square, trimmed and centred.
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
export const OUT_DIR = join(repo, "site", "badge-art");
export const TIERS = ["bronze", "silver", "gold", "platinum", "epic", "legendary"];
/** The first approved batch (13 November 2026): one emblem per family. More are added by file name, never in code. */
export const FAMILY_EMBLEMS = ["dungeons-gate", "raids-banner", "duels-blades", "pvp-helm", "professions-anvil", "levelling-axe", "guild-horn", "seasons-laurel", "ingame-star"];
/** The second approved batch (13 November 2026, the rest of set A): finer emblems that metrics and achievements name in src/services/badge-art.ts. */
export const MORE_EMBLEMS = ["duels-flame", "duels-throne", "dungeons-key", "dungeons-map", "dungeons-torch", "guild-brazier", "guild-hand", "guild-pouch", "guild-sparkle-hand", "guild-sun-tablet", "guild-trophy", "ingame-banner", "ingame-boot", "ingame-scroll", "levelling-cap", "professions-first-laurel", "professions-gem", "professions-mortar", "professions-tools-crown", "pvp-drum", "raids-horn", "raids-siege", "raids-skull", "seasons-attendee", "seasons-helper", "seasons-organizer"];
export const ALL_EMBLEMS = [...FAMILY_EMBLEMS, ...MORE_EMBLEMS];
/** Painted role emblems for the dungeon run card (tank, healer, damage; 14 November 2026). Source files are <key>-CHOSEN.png; one 128 px size. */
export const ROLE_EMBLEMS = ["tank", "healer", "damage"];
export const SIZES = [256, 128];
/** Largest file and total budget for the committed assets (bytes). */
export const MAX_FILE_BYTES = 60_000, MAX_TOTAL_BYTES = 2_500_000;
const MAGENTA = [255, 0, 255];

/** How magenta a pixel is, 0 (none) to 1 (flat background): the share of #FF00FF it is made of. */
const magentaShare = (r, g, b) => Math.max(0, Math.min(1, (Math.min(r, b) - g) / 255));

/**
 * Cuts the magenta out of a picture. The background is found as connected regions: everything reachable from the border over pixels that are
 * at least 55% magenta, plus enclosed pockets (between a horn and a body) that are on average at least 85% magenta. Those pixels become fully
 * transparent. Within `reach` pixels of them the colour is unmixed (pixel = subject * (1 - f) + magenta * f), which restores the dark painted
 * outline's own colour and a matching partial alpha, so no pink fringe is left. Pixels further inside are never touched: a purple frame or a
 * pink gem is not background because it is not connected to the outside.
 */
export async function cutOut(input, reach = 2) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info, n = width * height;
  const share = new Float32Array(n);
  for (let i = 0; i < n; i++) share[i] = magentaShare(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  const gone = new Uint8Array(n), seen = new Uint8Array(n), stack = new Int32Array(n);
  const flood = (start, limit) => {
    let top = 0, count = 0, sum = 0; const members = [];
    stack[top++] = start; seen[start] = 1;
    while (top) {
      const i = stack[--top]; members.push(i); count++; sum += share[i];
      const x = i % width, y = (i - x) / width;
      for (const j of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, y < height - 1 ? i + width : -1]) {
        if (j >= 0 && !seen[j] && share[j] >= limit) { seen[j] = 1; stack[top++] = j; }
      }
    }
    return { members, mean: sum / count };
  };
  // Outside: everything connected to the border.
  for (let x = 0; x < width; x++) for (const y of [0, height - 1]) { const i = y * width + x; if (!seen[i] && share[i] >= 0.55) for (const m of flood(i, 0.55).members) gone[m] = 1; }
  for (let y = 0; y < height; y++) for (const x of [0, width - 1]) { const i = y * width + x; if (!seen[i] && share[i] >= 0.55) for (const m of flood(i, 0.55).members) gone[m] = 1; }
  // Enclosed pockets that are plainly background.
  for (let i = 0; i < n; i++) {
    if (seen[i] || share[i] < 0.8) continue;
    const region = flood(i, 0.55);
    if (region.members.length >= 30 && region.mean >= 0.85) for (const m of region.members) gone[m] = 1;
  }
  // Pixels within `reach` of the removed region (square neighbourhood, separable).
  const tmp = new Uint8Array(n), near = new Uint8Array(n);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let hit = 0;
    for (let d = -reach; d <= reach && !hit; d++) { const xx = x + d; if (xx >= 0 && xx < width && gone[y * width + xx]) hit = 1; }
    tmp[y * width + x] = hit;
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let hit = 0;
    for (let d = -reach; d <= reach && !hit; d++) { const yy = y + d; if (yy >= 0 && yy < height && tmp[yy * width + x]) hit = 1; }
    near[y * width + x] = hit;
  }
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (gone[i]) { data[o] = data[o + 1] = data[o + 2] = data[o + 3] = 0; continue; }
    if (!near[i]) continue;
    const f = share[i];
    if (f >= 0.97) { data[o] = data[o + 1] = data[o + 2] = data[o + 3] = 0; continue; }
    if (f < 0.03) continue;
    const keep = 1 - f;
    for (let c = 0; c < 3; c++) data[o + c] = Math.max(0, Math.min(255, Math.round((data[o + c] - f * MAGENTA[c]) / keep)));
    data[o + 3] = Math.round(255 * keep);
  }
  return { data, width, height };
}

/**
 * Share of the visible pixels along the cut edge (within 3 px of a transparent pixel) that still look magenta. It should be about 0; a
 * pink gem or purple metal deeper inside the picture is not counted.
 */
export function magentaResidue(data, width, height) {
  const n = width * height, clear = new Uint8Array(n), edge = new Uint8Array(n);
  for (let i = 0; i < n; i++) clear[i] = data[i * 4 + 3] < 26 ? 1 : 0;
  const reach = 3;
  const tmp = new Uint8Array(n);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { let hit = 0; for (let d = -reach; d <= reach && !hit; d++) { const xx = x + d; if (xx >= 0 && xx < width && clear[y * width + xx]) hit = 1; } tmp[y * width + x] = hit; }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { let hit = 0; for (let d = -reach; d <= reach && !hit; d++) { const yy = y + d; if (yy >= 0 && yy < height && tmp[yy * width + x]) hit = 1; } edge[y * width + x] = hit; }
  let visible = 0, pink = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (!edge[i] || data[o + 3] < 26) continue;
    visible++;
    if (magentaShare(data[o], data[o + 1], data[o + 2]) > 0.45 && data[o] > 150 && data[o + 2] > 150) pink++;
  }
  return visible ? pink / visible : 0;
}

/** Cut out, trim to the picture's bounds and fit into a transparent square of `size` pixels (never enlarged beyond the source). */
export async function prepare(input, size) {
  const { data, width, height } = await cutOut(input);
  const trimmed = await sharp(data, { raw: { width, height, channels: 4 } }).trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 }).png().toBuffer();
  return sharp(trimmed).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: "lanczos3" }).webp({ quality: 90, alphaQuality: 100, effort: 6 }).toBuffer();
}

/** Every file name the committed set must contain. */
export function expectedFiles() {
  const files = [];
  for (const size of SIZES) {
    for (const tier of TIERS) files.push(`frames/${tier}-${size}.webp`);
    for (const key of ALL_EMBLEMS) files.push(`emblems/${key}-${size}.webp`);
  }
  for (const key of ROLE_EMBLEMS) files.push(`roles/${key}-128.webp`);
  return files;
}

export async function build(source, only, extra = []) {
  let total = 0;
  const jobs = [];
  if (!only || only === "frames") for (const tier of TIERS) jobs.push(["frames", tier]);
  if (only === "roles") for (const key of ROLE_EMBLEMS) jobs.push(["roles", key]);
  if (!only || only === "emblems") {
    // Only the approved emblems (FAMILY_EMBLEMS, or the names passed with --emblem): the source folder may hold pictures not approved yet.
    for (const key of extra.length ? extra : ALL_EMBLEMS) jobs.push(["emblems", key]);
  }
  for (const [kind, key] of jobs) {
    const input = kind === "roles" ? join(source, `${key}-CHOSEN.png`) : join(source, kind, `${key}.png`);
    for (const size of kind === "roles" ? [128] : SIZES) {
      const buffer = await prepare(input, size), dest = join(OUT_DIR, kind, `${key}-${size}.webp`);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, buffer); total += buffer.length;
      console.log(`${kind}/${key}-${size}.webp ${buffer.length}`);
    }
  }
  console.log(`total ${total} bytes`);
}

/** CI check: the committed set is complete, transparent, free of magenta and small. Returns a list of problems (empty when fine). */
export async function check() {
  const problems = [];
  let total = 0;
  for (const name of expectedFiles()) {
    const file = join(OUT_DIR, name);
    if (!existsSync(file)) { problems.push(`missing ${name}`); continue; }
    const bytes = statSync(file).size; total += bytes;
    if (bytes > MAX_FILE_BYTES) problems.push(`${name} is ${bytes} bytes (limit ${MAX_FILE_BYTES})`);
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const size = Number(/-(\d+)\.webp$/.exec(name)[1]);
    if (info.width !== size || info.height !== size) problems.push(`${name} is ${info.width}x${info.height}, expected ${size}x${size}`);
    if (data[3] !== 0) problems.push(`${name} has an opaque corner (not cut out)`);
    const residue = magentaResidue(data, info.width, info.height);
    if (residue > 0.002) problems.push(`${name} still has magenta (${(residue * 100).toFixed(2)}% of visible pixels)`);
  }
  if (total > MAX_TOTAL_BYTES) problems.push(`assets total ${total} bytes (limit ${MAX_TOTAL_BYTES})`);
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2), option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  if (args.includes("--check")) {
    const problems = await check();
    if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
    console.log(`badge art ok (${expectedFiles().length} files)`);
  } else if (option("--source")) await build(option("--source"), option("--only"), args.flatMap((arg, i) => arg === "--emblem" ? [args[i + 1]] : []));
  else { console.error("usage: build-badge-art.mjs --source DIR [--only frames|emblems] | --check"); process.exit(2); }
}
