import sharp from "sharp";
import { cardArtPlain, cardBackdropArt, type CardBackdrop } from "./card-backdrop.js";
import { dungeonArt, type DungeonArtTheme } from "./dungeon-art.js";
import { dungeonBackdrop } from "./dungeon-backdrop.js";
import { renderBarsCard, renderBodyCard, renderUnlockHero, plainArt, type BodyCardSpec, type BodyRow, type UnlockHeroSpec } from "./card-layouts-recap.js";
import { GOOD } from "./card-kit.js";
import type { ScoreCard } from "./score-card.js";

/**
 * Maps the stored ScoreCard definitions that used to be drawn by the old framed layout onto the banner layouts of
 * card-layouts-recap.ts (16 Nov 2026). Definitions are untouched, so a message queued before this still draws.
 */
const TONE = { gold: "#ffd100", green: GOOD, red: "#ff8a7a" } as const;
const tail = (text: string | undefined) => (text ?? "").split("·").map((part) => part.trim()).filter(Boolean);
const labelOf = (card: ScoreCard) => (tail(card.eyebrow).at(-1) ?? card.title).toUpperCase();
const toRow = (r: NonNullable<ScoreCard["rows"]>[number]): BodyRow => ({ name: r.name, color: r.color, sub: r.sub, right: r.right, rightColor: r.rightTone ? TONE[r.rightTone] : undefined, icon: r.icon });

async function painting(backdrop: CardBackdrop | undefined, fallback?: () => Promise<Buffer>): Promise<Buffer> {
  return (await cardBackdropArt(backdrop, "wide")) ?? (fallback ? await fallback() : await plainArt());
}
const scene = (theme: DungeonArtTheme) => () => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">${dungeonArt(theme)}</svg>`)).jpeg({ quality: 88 }).toBuffer();

/** The cards the old layout drew, or null when `card` is none of them (the caller then tries its other layouts). */
export async function renderRecapKind(card: ScoreCard, fit = false): Promise<Buffer | null> {
  if (card.recap) return (await renderBodyCard({ ...(await recapSpec(card)), fit })).png;
  if (card.record) return (await (await import("./card-record.js")).renderRecordCard(card, await dungeonBackdrop(card.record.theme))).png;
  if (card.roster) return (await renderBarsCard(await rosterSpec(card))).png;
  if (card.unlocks?.length && card.unlocks.length <= 3) return (await renderUnlockHero(await unlockHeroSpec(card))).png;
  if (card.unlocks?.length) return (await renderBodyCard({ ...(await unlockSpec(card)), fit })).png;
  if (card.ladder && card.backdrop?.key === "server-stats" && card.ladder.boards.some((b) => b.rows.length)) return (await renderBarsCard(await statsSpec(card))).png;
  if (card.ladder && !card.ladder.boards.some((b) => b.rows.length)) return (await renderBodyCard({ ...(await emptySpec(card)), fit })).png;
  return null;
}

async function recapSpec(card: ScoreCard): Promise<BodyCardSpec> {
  const visual = card.recap!, raid = card.backdrop?.kind === "raid";
  return {
    type: raid ? "raid" : "weekly", emblem: raid ? "flame" : "star", label: labelOf(card), title: card.title, hero: card.subtitle,
    tiles: card.stats.slice(0, 4).map((s) => ({ value: s.value, label: s.label, color: TONE[s.accent ?? "gold"] })),
    sections: visual.sections.slice(0, 3).map((s, i) => ({ title: s.title, rows: s.rows.map(toRow), moreLabel: card.moreLabel, ...(raid ? { weight: i === 0 ? 0.85 : 1.075 } : {}) })),
    art: await painting(card.backdrop, scene(visual.theme))
  };
}

async function rosterSpec(card: ScoreCard): Promise<Parameters<typeof renderBarsCard>[0]> {
  const d = card.roster!, labels = card.rosterLabels ?? { crafter: "crafter", crafters: "crafters", none: "No crafter" };
  const withCrafters = d.professions.filter((p) => p.crafters > 0), gaps = d.professions.filter((p) => p.crafters === 0).map((p) => p.name);
  return {
    type: "roster", emblem: "people", label: labelOf(card), title: card.title, hero: card.subtitle,
    barsTitle: undefined, legend: d.bands.slice(0, 4), otherLabel: card.rosterLabels?.other ?? "+",
    bars: d.classes.map((c) => ({ name: c.name, color: c.color, parts: c.byBand, total: c.total })),
    rightTitle: card.rosterProfessionsLabel ?? "Professions",
    tiles: withCrafters.map((p) => ({ name: p.name, value: `${p.crafters} ${p.crafters === 1 ? labels.crafter : labels.crafters}`, side: String(p.maxSkill) })),
    ...(gaps.length ? { rightNote: `${labels.none} ${gaps.join(", ")}` } : {}),
    art: await painting(card.backdrop)
  };
}

async function statsSpec(card: ScoreCard): Promise<Parameters<typeof renderBarsCard>[0]> {
  const board = card.ladder!.boards.find((b) => b.rows.length)!;
  return {
    type: "roster", emblem: "bars", label: labelOf(card), title: card.title, hero: card.subtitle, heroNote: card.badges?.[0]?.text,
    barsTitle: board.title,
    bars: board.rows.map((r) => ({ name: r.name, color: r.color, parts: [], total: r.bar?.value ?? (Number(r.values.at(-1)) || 0) })),
    ...(card.rowsLabel ? { rightTitle: card.rowsLabel } : {}),
    tiles: card.stats.map((s) => ({ name: s.label, value: s.value, ...(s.note ? { side: s.note } : {}) })),
    ...(card.footer ? { strip: card.footer } : {}),
    art: await painting(card.backdrop)
  };
}

/** One to three unlocks: the badge-as-hero layout. */
async function unlockHeroSpec(card: ScoreCard): Promise<UnlockHeroSpec> {
  const p = card.progress;
  return {
    label: labelOf(card), player: card.title,
    unlocks: card.unlocks!.map((u) => ({ name: u.name, color: u.color, icon: u.icon, tier: u.tier, group: u.group, detail: u.detail })),
    ...(p && p.max > 0 ? { progress: { text: [`${p.value}/${p.max}`, p.label, p.note].filter(Boolean).join("  ·  "), ratio: p.value / p.max } } : {}),
    ...(card.portrait ? { portrait: Buffer.from(card.portrait, "base64") } : {}), ...(card.rank ? { chip: { text: card.rank.label, color: card.rank.color } } : {}),
    art: (await cardArtPlain(card.backdrop)) ?? await painting(card.backdrop)
  };
}

async function unlockSpec(card: ScoreCard): Promise<BodyCardSpec> {
  const all = card.unlocks!, single = all.length === 1, progress = card.progress;
  const base = { label: labelOf(card), title: card.title, type: "achievement" as const, emblem: "star" as const, art: await painting(card.backdrop),
    ...(card.portrait ? { portrait: Buffer.from(card.portrait, "base64") } : {}), ...(card.rank ? { chip: { text: card.rank.label, color: card.rank.color } } : {}) };
  const tiles = progress ? [{ value: `${progress.value}/${progress.max}`, label: [progress.label, progress.note].filter(Boolean).join(" · "), color: "#ffd100" }] : [];
  if (single) {
    const u = all[0]!;
    return { ...base, hero: u.name, heroColor: u.color, heroNote: [u.tier, u.group].filter(Boolean).join(" · "), note: u.detail, badge: { icon: u.icon, color: u.color }, tiles };
  }
  const [big] = card.stats, rows: BodyRow[] = all.map((u) => ({ name: u.name, color: u.color, sub: u.group, right: u.tier, icon: u.icon }));
  const split = rows.length > 4, shown = split ? [rows.slice(0, Math.ceil(rows.length / 2)), rows.slice(Math.ceil(rows.length / 2))] : [rows];
  return { ...base, hero: big?.value ?? `+${all.length}`, heroColor: "#ffd100", heroNote: big?.label, tiles,
    sections: shown.map((part, i) => ({ ...(i === 0 && card.rowsLabel ? { title: card.rowsLabel } : {}), rows: part,
      ...(i === shown.length - 1 && (card.unlocksMore ?? 0) > 0 ? { more: card.unlocksMore, moreLabel: card.moreLabel } : {}) })) };
}

async function emptySpec(card: ScoreCard): Promise<BodyCardSpec> {
  return { type: "weekly", emblem: "bars", label: labelOf(card), title: card.title, hero: card.subtitle, note: card.ladder?.empty ?? "—", art: await painting(card.backdrop) };
}

/**
 * Any other card the banner data layout does not take (no painting, no figures, a character's picture, the achievements list): the first
 * figure is the hero, the others a strip of figures, the rows one panel, and the subtitle and trust badges the line along the bottom.
 */
export async function renderGenericCard(card: ScoreCard, fit = false): Promise<Buffer> {
  const [lead, ...rest] = card.stats, rows = (card.rows ?? []).map(toRow);
  const branded = /guildedwow\.com\s*$/i.test(card.footer ?? "");
  const parts = [card.subtitle && lead ? card.subtitle : "", ...(card.badges ?? []).map((b) => b.text)].filter(Boolean);
  // The line along the bottom: what the card is about; the card's own footer only when there is nothing else to say.
  const strip = parts.length ? [...parts, ...(branded ? ["guildedwow.com"] : [])].join("  ·  ") : card.footer;
  return (await renderBodyCard({
    fit, type: "achievement", emblem: "star", label: labelOf(card), title: card.title,
    hero: lead?.value ?? card.subtitle, heroColor: lead ? TONE[lead.accent ?? "gold"] : undefined, heroNote: lead ? [lead.label, lead.note].filter(Boolean).join(" · ") : undefined,
    tiles: rest.slice(0, 4).map((s) => ({ value: s.value, label: s.note ? `${s.label} · ${s.note}` : s.label, color: TONE[s.accent ?? "gold"] })),
    sections: rows.length ? [{ title: card.rowsLabel, rows }] : [],
    ...(strip ? { strip } : {}),
    ...(card.portrait ? { portrait: Buffer.from(card.portrait, "base64") } : {}), ...(card.rank ? { chip: { text: card.rank.label, color: card.rank.color } } : {}),
    art: await painting(card.backdrop)
  })).png;
}
