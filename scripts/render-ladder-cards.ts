// Renders sample leaderboard cards (the shared ladder layout) to PNG files, for design review and docs/cards/.
// Usage: npx tsx scripts/render-ladder-cards.ts [outDir]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bgLadderCard } from "../src/services/bg-ladder.js";
import { duelBoardCard } from "../src/services/duel-board.js";
import { dungeonSeasonCard } from "../src/services/dungeon-leaderboard.js";
import { buildClassBook } from "../src/services/ladder-classes.js";
import { raceCard, type RaceRow } from "../src/services/race-board.js";
import { scoreCardPng, type ScoreCard } from "../src/services/score-card.js";

const outDir = process.argv[2] ?? "docs/cards";
const at = new Date("2026-11-07T14:05:00Z");
const first = ["Gauthier", "Mélodie", "Kev", "Xaldin", "Aurore", "Bastien", "Céline", "Damien", "Éloïse", "Félix", "Gaëlle", "Hugo", "Inès", "Jules", "Katia", "Léo",
  "Maëlle", "Noé", "Océane", "Paul", "Quentin", "Rose", "Samuel", "Thaïs", "Ulysse"];
const last = ["Tremblay", "Gagnon", "Caron", "Morrow", "Roy", "Côté", "Bouchard", "Gauthier", "Morin", "Lavoie", "Fortin", "Gagné", "Ouellet", "Pelletier", "Bélanger", "Lévesque"];
const classes = ["Warrior", "Paladin", "Hunter", "Rogue", "Priest", "Shaman", "Mage", "Warlock", "Druid"];
const races = ["Human", "Dwarf", "Night Elf", "Gnome", "Orc", "Tauren", "Troll", "Undead"];
const name = (i: number) => `${first[i % first.length]} ${last[(i * 7) % last.length]}`;
const cls = (i: number) => classes[(i * 5) % classes.length]!;
const book = buildClassBook(Array.from({ length: 50 }, (_, i) => ({ name: name(i), className: cls(i) })));

const rows: RaceRow[] = Array.from({ length: 64 }, (_, i) => ({ key: `k${i}`, name: name(i), className: cls(i), race: races[i % races.length]!, level: Math.max(8, 60 - Math.floor(i * 0.9)),
  reachedMaxAt: i < 3 ? new Date(at.getTime() - (3 - i) * 3600_000) : null, firstSeenAt: at, weekGain: i % 4 === 3 ? 0 : (i * 3) % 9 + 1,
  memberId: null, discordId: i % 3 === 0 ? String(100000000000000000n + BigInt(i)) : null, professions: [], lastSeenAt: at }));
const members = new Map(rows.filter(r => r.discordId).map(r => [r.discordId!, r.name.split(" ")[0]!.toLowerCase()]));

const cards: [string, ScoreCard][] = [
  ["ladder-race-to-60", raceCard({ rows, total: rows.length, finished: 3, edition: "forever" }, "en", 50, members, at)],
  ["ladder-duels", duelBoardCard({ duels: 214, edition: "forever", recent: [], standings: Array.from({ length: 18 }, (_, i) => {
    const wins = Math.max(2, 34 - i * 2 + (i % 3)), losses = 4 + i;
    return { memberId: `m${i}`, name: name(i + 2), wins, losses, games: wins + losses, winRate: wins / (wins + losses), streak: [3, -2, 1, 5, -1][i % 5]!, bestStreak: 6 - (i % 4) };
  }) }, "fr", book, at)],
  ["ladder-battlegrounds", bgLadderCard({ participations: 186, edition: "forever", brackets: ["Warsong Gulch · 20-29", "Arathi Basin · 30-39", "Warsong Gulch · 30-39", "Alterac Valley · 51-60"].map((label, b) => {
    const [mode, bracket] = label.split(" · ") as [string, string];
    const standings = Array.from({ length: 8 - b }, (_, i) => { const wins = 14 - i - b, losses = 3 + i, draws = i % 4 === 1 ? 1 : 0;
      return { memberId: `m${i}`, name: name(i + b * 3), games: wins + losses + draws, wins, losses, draws, winRate: wins / (wins + losses + draws) }; });
    return { mode, bracket, games: standings.reduce((sum, row) => sum + row.games, 0), standings };
  }) }, "en", book, at)],
  ["ladder-dungeon-season", dungeonSeasonCard(Array.from({ length: 25 }, (_, i) => ({ name: name(i), points: 1420 - i * 37 - (i % 3) * 5, dungeons: 8 - Math.floor(i / 5) })), "Season 1", "fr", true, book, at)]
];
mkdirSync(outDir, { recursive: true });
for (const [file, card] of cards) {
  const t0 = Date.now(), png = await scoreCardPng(card);
  writeFileSync(join(outDir, `${file}.png`), png!);
  console.log(`${file}.png ${(png!.length / 1024).toFixed(0)} KB ${Date.now() - t0} ms`);
}
