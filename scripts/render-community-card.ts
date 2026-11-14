// Renders the community leaderboard card (English and French, ordinary and long names) for design review.
// Usage: npx tsx scripts/render-community-card.ts [outDir]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { communityBoardCard } from "../src/services/community-leaderboard.js";
import { scoreCardPng } from "../src/services/score-card.js";

const outDir = process.argv[2] ?? "community-card";
mkdirSync(outDir, { recursive: true });
const at = new Date("2026-11-14T15:05:00Z");
const NAMES = ["Aldric Stormvale", "Brenna Ironwood", "Cedric Dawnhollow", "Dara Nightbloom", "Edric Thornfield", "Fenna Ashgrove", "Garrick Moonwell", "Hilda Redcliff", "Ivor Stonebrook", "Jora Whitefen", "Kell Duskmantle", "Lysa Brightwater"];
const LONG = "Mira Coldharbour-des-Tempêtes-Sombres ✦ la Très Longue";
const rows = (names: string[]) => names.map((name, i) => ({ userId: name, balance: 0, discord: 220 - i * 14, dungeons: i === 3 ? 0 : 120 - i * 8, pvp: i % 4 === 0 ? 0 : 40 - i * 2, points: 0 }))
  .map(row => ({ ...row, points: row.discord + row.dungeons + row.pvp })).sort((a, b) => b.points - a.points);
const moves = (names: string[]) => new Map(names.map((n, i) => [n, i % 3 === 0 ? 1 : i % 3 === 1 ? -2 : i === 5 ? "new" : 0])) as never;
for (const lang of ["en", "fr"] as const) {
  const season = { name: "Season 3 \u2014 November 2026", number: 3, status: "ACTIVE" };
  for (const [label, names] of [["ordinary", NAMES], ["long-names", [LONG, ...NAMES.slice(1)]], ["three-rows", NAMES.slice(0, 3)]] as const) {
    const png = await scoreCardPng(communityBoardCard({ lang, season, board: rows([...names]), names: new Map(names.map(n => [n, n])), moves: moves([...names]), updatedAt: at }));
    if (png) writeFileSync(join(outDir, `after-community-${label}-${lang}.png`), png);
  }
}
