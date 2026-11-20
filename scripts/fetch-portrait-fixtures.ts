// One-off: fetches the real Armory renders of two characters once and saves the head-and-shoulders cuts as fixture files, so the card
// previews (scripts/render-portrait-previews.ts) run without any network. Usage: npx tsx scripts/fetch-portrait-fixtures.ts <out dir>
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fetchRenderImage, headAndShoulders, portraitUrl } from "../src/services/character-portrait.js";

const out = process.argv[2];
if (!out) throw new Error("Pass the output folder.");
await mkdir(out, { recursive: true });
for (const id of [6978517n, 6691071n]) {
  const full = await fetchRenderImage(portraitUrl(id, "main-raw.png"), 15000);
  if (!full) { console.log(id, "no render"); continue; }
  await writeFile(join(out, `${id}-main-raw.png`), full);
  const cut = await headAndShoulders(full);
  if (cut) await writeFile(join(out, `${id}-portrait.png`), cut);
  console.log(id, full.length, cut ? "cut ok" : "no figure");
}
