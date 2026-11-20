// Renders sample duel cards (before and after the 21 Nov 2026 redesign) to a folder, no network: `npx tsx scripts/duel-card-preview.ts <dir>`.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { duelResultCard } from "../src/services/duel-card.js";
import { emptyNameBook } from "../src/services/character-display.js";
import { scoreCardPng, type ScoreCard } from "../src/services/score-card.js";

const dir = process.argv[2] ?? "duel-card-preview";
mkdirSync(dir, { recursive: true });
const classes = new Map([["hulke hogan", "Warrior"], ["lebowski holyroller", "Paladin"], ["aldric", "Warrior"]]);
const base = { reportKey: "k1", winnerId: "w", loserId: "l", winnerCharacter: "Hulke Hogan", loserCharacter: "Lebowski Holyroller", winnerLevel: 40, loserLevel: 34, reason: "knockout", endedAt: new Date(Date.UTC(2026, 10, 20, 18, 5)), points: 14, winnerScore: 14, winnerStreak: 1, winnerBest: 1 };
const rating = { winnerDelta: 1, loserDelta: -1, winnerScore: 1001, loserScore: 999, winnerPlacement: null, loserPlacement: null, rated: true, seasonId: "2026-11", startsAt: "2026-11-04T23:00:00Z" };
const face = async (color: string) => (await sharp({ create: { width: 256, height: 256, channels: 3, background: color } }).composite([{ input: Buffer.from(`<svg width="256" height="256"><circle cx="128" cy="100" r="60" fill="#e8c9a0"/><rect x="48" y="170" width="160" height="90" rx="40" fill="#555"/></svg>`) }]).png().toBuffer()).toString("base64");

const withPortraits = async (card: ScoreCard) => ({ ...card, duel: { ...card.duel!, winner: { ...card.duel!.winner, portrait: await face("#3a5a8a") }, loser: { ...card.duel!.loser, portrait: await face("#7a3a4a") } } });
const old = (card: ScoreCard) => { const { duel: _drop, ...rest } = card; void _drop; return rest as ScoreCard; };
const save = async (name: string, card: ScoreCard) => { const png = await scoreCardPng(card); if (!png) throw new Error(`${name}: busy`); writeFileSync(join(dir, name), png); console.log(name); };

for (const lang of ["fr", "en"] as const) {
  const card = duelResultCard({ ...base, rating }, lang, classes, emptyNameBook);
  await save(`before-${lang}.png`, old(card));
  await save(`after-${lang}.png`, await withPortraits(card));
}
const fr = duelResultCard({ ...base, rating }, "fr", classes, emptyNameBook);
await save("after-fr-no-portrait.png", fr);
const long = duelResultCard({ ...base, winnerCharacter: "Aldric-de-la-Vallée-des-Tempêtes-Sombres-et-Brumeuses", loserCharacter: "Lebowski Holyroller le Magnifique Gardien des Flammes Éternelles", winnerLevel: null, rating }, "fr", classes, emptyNameBook);
await save("after-fr-long-names.png", await withPortraits(long));
await save("after-en-draw-no-rating.png", await withPortraits(duelResultCard({ ...base, rating: { ...rating, rated: false, winnerDelta: 0, loserDelta: 0 } }, "en", classes, emptyNameBook)));
await save("after-en-points-only.png", await withPortraits(duelResultCard({ ...base, reason: "retreat" }, "en", classes, emptyNameBook)));
await save("after-en-placement.png", await withPortraits(duelResultCard({ ...base, rating: { ...rating, winnerPlacement: "3/5", loserPlacement: "2/5" } }, "en", classes, emptyNameBook)));
