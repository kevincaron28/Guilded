import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { cardBackdropArt } from "./card-backdrop.js";
import { renderBannerCard, renderDungeonCard, renderResultCard, type CardSpecLadderRow, type DungeonPartyRow, type NextCardSpec } from "./card-layouts-next.js";
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
  if (card.ladder && !card.recap && !card.record && !card.roster && !card.unlocks?.length) return ladderCard(card);
  if (card.ladder || card.recap || card.record || card.roster || card.unlocks?.length) return null;
  const kind = card.backdrop?.kind;
  if (kind === "board" && card.backdrop?.key === "duel" && card.rows?.length === 2 && card.stats.length === 3) return duelCard(card);
  if (kind === "battleground" && card.stats.length === 3) return battlegroundCard(card);
  return dataCard(card);
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

/** Data cards (weekly report, raid report, rookie, season, welcome, PvP recap, achievements...): the painting as a banner, the first figure as the hero, the other figures on the right, up to three rows. */
const DATA_LOOK: Record<string, Kind> = { raid: { type: "raid", emblem: "flame" }, weekly: { type: "weekly", emblem: "cup" }, "world-pvp": { type: "battleground", emblem: "duel" } };
async function dataCard(card: ScoreCard): Promise<Buffer | null> {
  if (!card.backdrop || card.stats.length === 0) return null;
  const art = await cardBackdropArt(card.backdrop, "wide");
  if (!art) return null;
  const [lead, ...rest] = card.stats as [ScoreCard["stats"][number], ...ScoreCard["stats"]];
  const look = DATA_LOOK[card.backdrop.kind] ?? DATA_LOOK[card.backdrop.key] ?? { type: "weekly" as const, emblem: "star" as const };
  const { png } = await renderBannerCard({
    type: look.type, emblem: look.emblem, label: (tail(card.eyebrow).at(-1) ?? card.title).toUpperCase(), title: card.title,
    hero: lead.value, heroColor: ACCENT[lead.accent ?? "gold"] ?? GOOD, heroNote: lead.note ? `${lead.label} · ${lead.note}` : lead.label,
    stats: rest.slice(0, 3).map((s) => ({ value: s.value, label: s.note ? `${s.label} · ${s.note}` : s.label })),
    rows: (card.rows ?? []).slice(0, 4).map((r) => ({ name: r.name, color: r.color, sub: r.sub, right: r.right })),
    strip: [card.subtitle, ...(card.badges ?? []).map((b) => b.text)].filter(Boolean).join("  ·  "), art
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

type Kind = Pick<NextCardSpec, "type" | "emblem">;
/** The look of each board by its painting key (the stored definition names it); anything else gets the weekly look. */
const BOARD_LOOK: Record<string, Kind & { focus?: number }> = {
  duel: { type: "duel", emblem: "bars" }, battlegrounds: { type: "battleground", emblem: "flag" }, "world-pvp": { type: "battleground", emblem: "duel" },
  "dungeon-season": { type: "dungeon", emblem: "gate" }, crafters: { type: "crafting", emblem: "anvil" }, activity: { type: "weekly", emblem: "bars" },
  "race-to-60": { type: "achievement", emblem: "crown" }
};

async function ladderCard(card: ScoreCard): Promise<Buffer | null> {
  const visual = card.ladder!, key = card.backdrop?.key ?? "";
  const boards = visual.boards.filter((board) => board.rows.length);
  // A board longer than 25 rows (a race board set to its top 50) keeps the old long card: the banner layout shows twelve.
  if (!boards.length || !card.backdrop || boards.some((board) => board.rows.length > 25)) return null;
  const art = await cardBackdropArt(card.backdrop, "wide");
  if (!art) return null;
  const cols = visual.columns;
  const primary = Math.max(0, cols.findIndex((c) => c.primary));
  const plain = cols.map((c, i) => ({ c, i })).filter(({ c, i }) => i !== primary && c.kind !== "move" && c.kind !== "bar");
  const bar = cols.findIndex((c) => c.kind === "bar");
  const legend: string[] = [];
  const cell = (values: string[], i: number) => (values[i] ?? "").trim();
  // How a row's score and small second figure are chosen (by board; others: the primary column, then up to three more joined with "/" and named in the strip).
  const scoreAndRecord = (values: string[]): { score: string; record?: string | undefined } => {
    if (key === "duel") return { score: cell(values, 0), record: [cell(values, 1), cell(values, 2)].every(Boolean) ? `${cell(values, 1)}-${cell(values, 2)}` : undefined };
    if (key === "battlegrounds") return { score: cell(values, 2) || cell(values, 0), record: [cell(values, 0), cell(values, 1)].every(Boolean) ? `${cell(values, 0)}-${cell(values, 1)}` : undefined };
    if (key === "world-pvp") return { score: cell(values, 0), record: cell(values, 4) ? `${cell(values, 4)} ${cols[4]?.label ?? ""}`.trim() : undefined };
    const rest = plain.map(({ i }) => cell(values, i)).filter(Boolean).slice(0, 3);
    return { score: cell(values, primary) || (bar >= 0 ? cell(values, primary) : ""), record: rest.length ? rest.join(" / ") : undefined };
  };
  if (!["duel", "battlegrounds", "world-pvp"].includes(key) && plain.length > 1) legend.push(plain.slice(0, 3).map(({ c }) => c.label).filter(Boolean).join(" / "));
  const rowsOf = (rows: typeof boards[number]["rows"]): CardSpecLadderRow[] => rows.map((row) => {
    const { score, record } = scoreAndRecord(row.values);
    return { rank: row.rank, name: row.name, color: row.color, score: score || "—", ...(record ? { record } : {}), ...(row.move !== undefined ? { move: row.move } : {}) };
  });
  const first = boards[0]!.rows[0]!, firstScore = scoreAndRecord(first.values).score;
  const look = BOARD_LOOK[key] ?? { type: "weekly" as const, emblem: "bars" as const };
  const { png } = await renderBannerCard({
    type: look.type, emblem: look.emblem, label: (tail(card.eyebrow).at(-1) ?? card.title).toUpperCase(), title: card.title,
    hero: first.name, heroColor: first.color, heroNote: firstScore ? `${cols[primary]?.label ? cols[primary]!.label + " " : ""}${firstScore}` : undefined,
    ...(boards.length > 1 ? { boards: boards.map((b) => ({ title: b.title, rows: rowsOf(b.rows) })) } : { ladder: rowsOf(boards[0]!.rows) }),
    strip: [card.subtitle, ...legend, visual.meta].filter(Boolean).join("  ·  "), art
  });
  return png;
}
