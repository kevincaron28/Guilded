import { readFileSync, writeFileSync } from "node:fs";

// Lists the English texts in the French-capable screens (T("...") / tx(lang, "...") calls and a few
// constant tables), so a translator (or a test) can see what needs a French entry in src/i18n-fr.ts.
//   node scripts/i18n-keys.mjs            prints the texts that have no French yet
//   node scripts/i18n-keys.mjs --all      prints every text
export const SOURCES = [
  "src/commands/setup.ts", "src/services/setup-status.ts", "src/commands/craft-board.ts", "src/commands/dungeon-group.ts",
  "src/commands/poll.ts", "src/services/raid-core.ts", "src/commands/wcl.ts",
  // 5.0
  "src/services/dungeon-guide.ts", "src/commands/group-alerts.ts", "src/commands/faq.ts"
];

const CALL = /\b(?:T|tx)\(\s*(?:\w+\s*,\s*)?("(?:[^"\\]|\\.)*")/g;

export function collectKeys(read = (file) => readFileSync(file, "utf8")) {
  const keys = new Set();
  for (const file of SOURCES) {
    const source = read(file);
    for (const match of source.matchAll(CALL)) keys.add(JSON.parse(match[1]));
  }
  const setup = read("src/commands/setup.ts");
  const titles = /const STEP_TITLES = \[([\s\S]*?)\];/.exec(setup)?.[1] ?? "";
  for (const match of titles.matchAll(/"((?:[^"\\]|\\.)*)"/g)) keys.add(JSON.parse(`"${match[1]}"`));
  const zones = /const TIMEZONES[^=]*= \[([\s\S]*?)\n\];/.exec(setup)?.[1] ?? "";
  for (const match of zones.matchAll(/\["((?:[^"\\]|\\.)*)"/g)) keys.add(JSON.parse(`"${match[1]}"`));
  return [...keys];
}

if (process.argv[1] && process.argv[1].endsWith("i18n-keys.mjs")) {
  const { FR_TEXT } = await import("../src/i18n-fr.ts").catch(() => ({ FR_TEXT: {} }));
  const all = process.argv.includes("--all");
  const keys = collectKeys().filter((key) => all || !(key in FR_TEXT));
  writeFileSync("_keys.json", JSON.stringify(keys, null, 1));
  console.log(`${keys.length} texts written to _keys.json`);
}
