import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { cardBackdropArt } from "./card-backdrop.js";
import { renderDungeonCard, renderResultCard, type DungeonPartyRow } from "./card-layouts-next.js";
import { GOOD } from "./card-kit.js";
import { dungeonBackdrop } from "./dungeon-backdrop.js";
import { type ScoreCard } from "./score-card.js";

/**
 * Maps the stored ScoreCard definitions of the result cards onto the redesigned layouts (13 Nov 2026). The definitions are
 * untouched, so a message queued before this existed still draws; a card this file does not recognise (or cannot draw) returns
 * null and score-card.ts draws it as before. Renders run inside scoreCardPng's bound and cache, never a queue of their own.
 */
const ACCENT = { green: GOOD, red: "#ff8a7a", gold: "#ffd100" } as const;
const tail = (text: string | undefined) => (text ?? "").split("·").map((part) => part.trim()).filter(Boolean);
const isDate = (part: string) => /^\d{4}-\d{2}-\d{2}/.test(part);

export async function renderNextCard(card: ScoreCard): Promise<Buffer | null> {
  if (card.dungeon) return dungeonCard(card);
  if (card.ladder || card.recap || card.record || card.roster || card.unlocks?.length) return null;
  const kind = card.backdrop?.kind;
  if (kind === "board" && card.backdrop?.key === "duel" && card.rows?.length === 2 && card.stats.length === 3) return duelCard(card);
  if (kind === "battleground" && card.stats.length === 3) return battlegroundCard(card);
  return null;
}

async function duelCard(card: ScoreCard): Promise<Buffer | null> {
  const art = await cardBackdropArt(card.backdrop, "wide");
  if (!art) return null;
  const [points, levels, streak] = card.stats as [ScoreCard["stats"][number], ScoreCard["stats"][number], ScoreCard["stats"][number]];
  const [winner, loser] = card.rows as [NonNullable<ScoreCard["rows"]>[number], NonNullable<ScoreCard["rows"]>[number]];
  const line = (row: typeof winner) => ({ text: row.sub ? `${row.name} · ${row.sub}` : row.name, color: row.color });
  const { png } = await renderResultCard({
    type: "duel", emblem: "duel", label: card.title.toUpperCase(), title: card.subtitle,
    hero: points.value, heroNote: points.note,
    names: [line(winner), line(loser)],
    stats: [levels, streak].filter((s) => s.value && s.value !== "—").map((s) => ({ value: s.value, label: s.note ? `${s.label} · ${s.note}` : s.label })),
    strip: tail(card.footer)[0] ?? "", art
  });
  return png;
}

async function battlegroundCard(card: ScoreCard): Promise<Buffer | null> {
  const art = await cardBackdropArt(card.backdrop, "wide");
  if (!art) return null;
  const [result, time, format] = card.stats as [ScoreCard["stats"][number], ScoreCard["stats"][number], ScoreCard["stats"][number]];
  const { png } = await renderResultCard({
    type: "battleground", emblem: "flag", label: (tail(card.eyebrow)[1] ?? card.title).toUpperCase(), title: card.title,
    hero: result.value, heroColor: ACCENT[result.accent ?? "gold"] ?? GOOD,
    stats: [{ value: time.value, label: time.label }, { value: format.value, label: format.note ?? format.label }].filter((s) => s.value && s.value !== "—"),
    strip: [card.subtitle, card.badges?.[0]?.text].filter(Boolean).join("  ·  "), art
  });
  return png;
}

const MAP_FILE = /^[a-z0-9-]{1,60}$/;

async function dungeonCard(card: ScoreCard): Promise<Buffer | null> {
  const visual = card.dungeon!;
  const art = await dungeonBackdrop(visual.theme);
  const parts = tail(card.subtitle), date = parts.find(isDate), difficulty = parts.filter((p) => !isDate(p)).join(" · ");
  const stat = (i: number) => card.stats[i];
  const fact = (i: number) => { const s = stat(i); return s && s.value && s.value !== "—" ? `${s.label} ${s.value}` : ""; };
  const deaths = fact(2), score = fact(3), boss = fact(1);
  const badge = card.badges?.[0], time = stat(0);
  const roleOf = (role: string | undefined): DungeonPartyRow["role"] => role === "TANK" ? "tank" : role === "HEALER" ? "healer" : role === "DPS" ? "dps" : undefined;
  const members = visual.party, extra = members.length > 5 ? members.length - 4 : 0;
  const party: DungeonPartyRow[] = (extra ? members.slice(0, 4) : members.slice(0, 5)).map((m) => ({ name: m.name, color: m.color, role: roleOf(m.role), score: m.score, guild: m.guild ? undefined : m.guildName }));
  if (extra) party.push({ name: `+${extra} ${visual.moreLabel}`, color: "#ddd4c0" });
  let map;
  if (visual.deathPoints?.length) {
    let image: Buffer | undefined;
    if (!visual.mapOutline?.cells.length && visual.mapKey && MAP_FILE.test(visual.mapKey)) {
      image = await readFile(fileURLToPath(new URL(`../../site/dungeon-maps/${visual.mapKey}.png`, import.meta.url))).catch(() => undefined);
    }
    map = { cells: visual.mapOutline?.cells ?? [], points: visual.deathPoints, image };
  }
  const { png } = await renderDungeonCard({
    label: [(tail(card.eyebrow).at(-1) ?? "").toUpperCase(), difficulty.toUpperCase()].filter(Boolean).join(" · "), title: card.title,
    hero: time?.value ?? "—", heroNote: badge ? badge.text : time?.note,
    facts: [deaths, score, boss].filter(Boolean), party, map,
    strip: [date, card.rowsLabel].filter(Boolean).join("  ·  "), art
  });
  return png;
}
