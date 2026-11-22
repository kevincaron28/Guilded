import { cardArtPlain, cardBackdropArt as paintedArt, type BackdropVariant, type CardBackdrop } from "./card-backdrop.js";
import { plainArt } from "./card-layouts-recap.js";
import { renderGenericCard, renderRecapKind } from "./card-next-recap.js";
import { renderBannerCard, renderDungeonCard, renderResultCard, type CardSpecLadderRow, type DungeonPartyRow, type NextCardSpec } from "./card-layouts-next.js";
import { GOOD } from "./card-kit.js";
import { dungeonBackdrop } from "./dungeon-backdrop.js";
import { BG_PARTY_LABEL } from "./end-cards.js";
import { type ScoreCard } from "./score-card.js";

/**
 * Maps the stored ScoreCard definitions of the result cards onto the redesigned layouts (13 Nov 2026). The definitions are
 * untouched, so a message queued before this existed still draws; a card this file does not recognise (or cannot draw) returns
 * null and score-card.ts draws it as before. Renders run inside scoreCardPng's bound and cache, never a queue of their own.
 */
/** The painting a card asks for, or a plain glow when it has none (an unapproved key, an old definition): a card is always drawn. */
const cardBackdropArt = async (request: CardBackdrop | undefined, variant: BackdropVariant): Promise<Buffer> => (await paintedArt(request, variant)) ?? plainArt();
const ACCENT = { green: GOOD, red: "#ff8a7a", gold: "#ffd100" } as const;
const tail = (text: string | undefined) => (text ?? "").split("·").map((part) => part.trim()).filter(Boolean);
const isDate = (part: string) => /^\d{4}-\d{2}-\d{2}/.test(part) || /^\d{1,2} \S+ \d{4}$/.test(part) || /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(part);

export async function renderNextCard(card: ScoreCard, options: { branded?: boolean } = {}): Promise<Buffer | null> {
  const fit = !options.branded; // Discord posts are cut to their content; the website's share images keep 1200 x 630
  if (card.dungeon) return dungeonCard(card);
  const recapped = await renderRecapKind(card, fit);
  if (recapped) return recapped;
  if (card.promotion) return (await import("./card-promotion.js")).renderPromotionCard(card);
  if (card.donation) return (await import("./card-donation.js")).renderDonationCard(card);
  if (card.weekly) return (await import("./card-podium.js")).renderWeeklyHonorsCard(card);
  if (card.ladder && card.backdrop?.key === "community" && card.ladder.boards.some((board) => board.rows.length)) return (await import("./card-podium.js")).renderCommunityPodium(card);
  if (card.ladder) return ladderCard(card);
  const kind = card.backdrop?.kind;
  if (kind === "board" && card.backdrop?.key === "duel" && (card.duel || (card.rows?.length === 2 && card.stats.length >= 1 && card.stats.length <= 3))) return duelCard(card);
  if (kind === "battleground" && card.stats.length === 3) return battlegroundCard(card);
  return (await dataCard(card)) ?? renderGenericCard(card, fit);
}

async function duelCard(card: ScoreCard): Promise<Buffer | null> {
  // 21 Nov 2026: the face-off layout draws the unshaded painting itself; a card queued before it has no `duel` and keeps the list layout below.
  if (card.duel) return (await (await import("./card-duel.js")).renderDuelFaceOff(card.duel, (await cardArtPlain(card.backdrop)) ?? await plainArt())).png;
  const art = await cardBackdropArt(card.backdrop, "wide");
  if (!art) return null;
  // A duel without a known level ("— vs —") or without a streak draws the same layout, just with fewer figures.
  const [points, ...others] = card.stats as [ScoreCard["stats"][number], ...ScoreCard["stats"]];
  const [winner, loser] = card.rows as [NonNullable<ScoreCard["rows"]>[number], NonNullable<ScoreCard["rows"]>[number]];
  const line = (row: typeof winner) => ({ text: row.sub ? `${row.name} · ${row.sub}` : row.name, color: row.color });
  const { png } = await renderResultCard({
    type: "duel", emblem: "duel", label: card.title.toUpperCase(), title: card.subtitle,
    hero: points.value, heroNote: points.note,
    names: [line(winner), line(loser)],
    stats: others.filter((s) => s.value && !/^[—\-\s]*(vs)?[—\-\s]*$/i.test(s.value)).map((s) => ({ value: s.value, label: s.note ? `${s.label} · ${s.note}` : s.label })),
    strip: tail(card.footer)[0] ?? "", art
  });
  return png;
}

async function battlegroundCard(card: ScoreCard): Promise<Buffer | null> {
  const art = await cardBackdropArt(card.backdrop, "wide");
  if (!art) return null;
  const [result, time, format] = card.stats as [ScoreCard["stats"][number], ScoreCard["stats"][number], ScoreCard["stats"][number]];
  const { png } = await renderResultCard({
    type: "battleground", emblem: "flag", label: (tail(card.eyebrow).slice(-2)[0] ?? card.title).toUpperCase(), title: card.title,
    hero: result.value, heroColor: ACCENT[result.accent ?? "gold"] ?? GOOD,
    stats: [{ value: time.value, label: time.label }, { value: format.value, label: format.note ?? format.label }].filter((s) => s.value && s.value !== "—"),
    rows: Object.values(BG_PARTY_LABEL).includes(card.rowsLabel ?? "") ? (card.rows ?? []).slice(0, 4).map((r) => ({ name: r.name, color: r.color })) : [],
    strip: [card.subtitle, card.badges?.[0]?.text].filter(Boolean).join("  ·  "), art
  });
  return png;
}

/** Data cards (weekly report, raid report, rookie, season, welcome, PvP recap, achievements...): the painting as a banner, the first figure as the hero, the other figures on the right, up to three rows. */
const DATA_LOOK: Record<string, Kind> = { raid: { type: "raid", emblem: "flame" }, weekly: { type: "weekly", emblem: "cup" }, "world-pvp": { type: "battleground", emblem: "duel" } };
async function dataCard(card: ScoreCard): Promise<Buffer | null> {
  // The achievements and anniversary cards (medallion badges, a picture, a list of members) use the body layout of card-layouts-recap.ts.
  if (!card.backdrop || card.stats.length === 0 || card.backdrop.key === "achievements" || card.backdrop.key === "anniversary") return null;
  const art = await cardBackdropArt(card.backdrop, "wide");
  if (!art) return null;
  const [lead, ...rest] = card.stats as [ScoreCard["stats"][number], ...ScoreCard["stats"]];
  const look = DATA_LOOK[card.backdrop.kind] ?? DATA_LOOK[card.backdrop.key] ?? { type: "weekly" as const, emblem: "star" as const };
  const { png } = await renderBannerCard({
    type: look.type, emblem: look.emblem, label: (tail(card.eyebrow).at(-1) ?? card.title).toUpperCase(), title: card.title,
    hero: lead.value, heroColor: ACCENT[lead.accent ?? "gold"] ?? GOOD, heroNote: lead.note ? `${lead.label} · ${lead.note}` : lead.label,
    stats: rest.slice(0, 3).map((s) => ({ value: s.value, label: s.note ? `${s.label} · ${s.note}` : s.label })),
    rows: (card.rows ?? []).slice(0, 4).map((r) => ({ name: r.name, color: r.color, sub: r.sub, right: r.right })),
    ...(card.checks?.length ? { checks: card.checks, moreWord: card.moreLabel ?? "more" } : {}),
    ...(card.portrait ? { portrait: Buffer.from(card.portrait, "base64") } : {}),
    strip: [card.subtitle, ...(card.badges ?? []).map((b) => b.text)].filter(Boolean).join("  ·  "), art
  });
  return png;
}


async function dungeonCard(card: ScoreCard): Promise<Buffer | null> {
  const visual = card.dungeon!;
  const art = visual.pvp ? (await cardBackdropArt({ kind: "battleground", key: "default" }, "wide")) ?? await dungeonBackdrop(visual.theme) : await dungeonBackdrop(visual.theme);
  const parts = tail(card.subtitle), date = parts.find(isDate), difficulty = parts.filter((p) => !isDate(p)).join(" · ");
  const stat = (i: number) => card.stats[i];
  const fact = (i: number) => { const s = stat(i); return s && s.value && s.value !== "—" ? `${s.label} ${s.value}` : ""; };
  const deaths = fact(2), score = fact(3), boss = fact(1);
  const badge = card.badges?.[0], time = stat(0), rated = visual.pvp ? undefined : stat(3);
  const roleOf = (role: string | undefined): DungeonPartyRow["role"] => role === "TANK" ? "tank" : role === "HEALER" ? "healer" : role === "DPS" ? "dps" : undefined;
  const members = visual.party, extra = !visual.pvp && members.length > 5 ? members.length - 4 : 0;
  const party: DungeonPartyRow[] = (extra ? members.slice(0, 4) : members.slice(0, visual.pvp ? 40 : 5)).map((m) => ({ name: m.name, color: m.color, role: roleOf(m.role), score: m.score, guild: m.guildName, level: m.level, gain: m.gain, total: m.total === undefined ? undefined : String(m.total), member: m.guild, ...(m.portrait ? { portrait: Buffer.from(m.portrait, "base64") } : {}) }));
  if (extra || visual.pvp) party.push({ name: `+${extra} ${visual.moreLabel}`, color: "#ddd4c0" }); // a PvP card's renderer reads the "more" word from this row and counts the rest itself
  // No death map (owner, 17 Nov 2026): too small to read and it darkened the painting.
  const { png } = await renderDungeonCard({
    label: [(tail(card.eyebrow).at(-1) ?? "").toUpperCase(), difficulty.toUpperCase()].filter(Boolean).join(" · "), title: card.title,
    hero: time?.value ?? "—", heroNote: badge ? badge.text : time?.note,
    facts: [deaths, score, boss].filter(Boolean), party,
    // An unranked run says why in one line (the score stat's note: the reason, or "Already counted").
    ...(rated && rated.value === "—" && rated.note ? { reason: `${rated.label} — ${rated.note}` } : {}),
    // The Guild column is always drawn: a card queued before it was always there gets the level, run and season headers from its guild label's language.
    ...(visual.pvp ? { pvp: { levelLabel: visual.pvp.levelLabel, waiting: visual.pvp.waiting } }
      : { columns: { ...(visual.columns ?? (visual.guildLabel === "Guilde" ? { level: "Niv", gain: "Cette run", total: "Saison (rôle)" } : { level: "Lv", gain: "This run", total: "Season (role)" })), guild: visual.guildLabel } }),
    strip: visual.pvp ? card.footer : [date, card.rowsLabel].filter(Boolean).join("  ·  "), art
  });
  return png;
}

type Kind = Pick<NextCardSpec, "type" | "emblem">;
/** The look of each board by its painting key (the stored definition names it); anything else gets the weekly look. */
const BOARD_LOOK: Record<string, Kind & { focus?: number }> = {
  duel: { type: "duel", emblem: "bars" }, battlegrounds: { type: "battleground", emblem: "flag" }, "world-pvp": { type: "battleground", emblem: "duel" },
  "dungeon-season": { type: "dungeon", emblem: "gate" }, crafters: { type: "crafting", emblem: "anvil" }, activity: { type: "weekly", emblem: "bars" }, community: { type: "weekly", emblem: "crown" },
  "race-to-60": { type: "achievement", emblem: "crown" }
};

async function ladderCard(card: ScoreCard): Promise<Buffer | null> {
  const visual = card.ladder!, key = card.backdrop?.key === "duel-ladder" ? "duel" : card.backdrop?.key ?? "";
  const boards = visual.boards.filter((board) => board.rows.length);
  // A board longer than 25 rows (a race board set to its top 50) keeps the long ladder of score-card.ts: the banner layout shows twelve.
  if (boards.some((board) => board.rows.length > 25)) return null;
  const art = await cardBackdropArt(card.backdrop, "wide");
  if (!art) return null;
  const cols = visual.columns;
  const primary = Math.max(0, cols.findIndex((c) => c.primary));
  const plain = cols.map((c, i) => ({ c, i })).filter(({ c, i }) => i !== primary && c.kind !== "move" && c.kind !== "bar");
  const bar = cols.findIndex((c) => c.kind === "bar");
  const cell = (values: string[], i: number) => (values[i] ?? "").trim();
  const label = (i: number) => (cols[i]?.label ?? "").trim();
  const join = (items: string[], by: string) => items.filter(Boolean).join(by);
  // How a row's score and small second figure are chosen (by board; others: the primary column, then up to three more joined with "/").
  // `heads` names those two columns in a header row, so the footer carries no legend any more (16 Nov 2026).
  const rest = plain.slice(0, 3);
  let heads: { score: string; record?: string } = { score: label(primary), ...(rest.length ? { record: join(rest.map(({ c }) => c.label), " / ") } : {}) };
  const scoreAndRecord = (values: string[]): { score: string; record?: string | undefined } => {
    if (key === "duel") return { score: cell(values, 0), record: [cell(values, 1), cell(values, 2)].every(Boolean) ? `${cell(values, 1)}-${cell(values, 2)} · ${cell(values, 3)}` : undefined };
    if (key === "battlegrounds") return { score: cell(values, 2) || cell(values, 0), record: [cell(values, 0), cell(values, 1)].every(Boolean) ? `${cell(values, 0)}-${cell(values, 1)}` : undefined };
    // Community: Discord / dungeons / PvP packed tight so three-digit figures still fit beside a long name.
    if (key === "community") return { score: cell(values, 3), record: [0, 1, 2].map(i => cell(values, i)).join("/") };
    if (key === "world-pvp") return { score: cell(values, 0), record: cell(values, 4) || undefined };
    const more = plain.slice(0, 3).map(({ i }) => cell(values, i)).filter(Boolean);
    return { score: cell(values, primary) || (bar >= 0 ? cell(values, primary) : ""), record: more.length ? more.join(" / ") : undefined };
  };
  if (key === "duel") heads = { score: label(0), record: `${label(1)}-${label(2)} · ${label(3)}` };
  else if (key === "battlegrounds") heads = { score: label(2), record: `${label(0)}-${label(1)}` };
  else if (key === "community") heads = { score: label(3), record: join([0, 1, 2].map(label), " / ") };
  else if (key === "world-pvp") heads = { score: label(0), record: label(4) };
  const fr = /Mis à jour/.test(visual.meta ?? ""); // ladderMeta writes the language of the card
  const rowsOf = (rows: typeof boards[number]["rows"]): CardSpecLadderRow[] => rows.map((row) => {
    const { score, record } = scoreAndRecord(row.values);
    // A row's second line (the level bracket on the dungeon season board) is an extra beside the name: dropped before the name is cut.
    return { rank: row.rank, name: row.name, ...(row.sub && key === "dungeon-season" ? { extra: row.sub } : {}), color: row.color, score: score || "—", ...(record ? { record } : {}), ...(row.move !== undefined ? { move: row.move } : {}) };
  });
  const look = BOARD_LOOK[key] ?? { type: "weekly" as const, emblem: "bars" as const };
  const { png } = await renderBannerCard({
    type: look.type, emblem: look.emblem, label: (tail(card.eyebrow).at(-1) ?? card.title).toUpperCase(), title: card.title,
    // The header says what the board is (title, then subtitle), never who leads it: row 1 of the table already does (16 Nov 2026).
    hero: card.subtitle,
    ...(boards.length > 1 ? { boards: boards.map((b) => ({ title: b.title, rows: rowsOf(b.rows) })) } : { ladder: rowsOf(boards[0]!.rows) }),
    heads, moreWord: fr ? "autres" : "more",
    strip: visual.meta ?? "", art
  });
  return png;
}
