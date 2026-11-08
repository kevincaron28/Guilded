import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { EmbedBuilder, escapeMarkdown } from "discord.js";
import type { Lang } from "../i18n.js";
import { dungeonArt, type DungeonArtTheme } from "./dungeon-art.js";
import type { DungeonImportResult } from "./dungeon-import.js";
import type { DungeonHighlightItem } from "./dungeon-records.js";
import { formatDuration } from "./dungeon-rules.js";
import { dungeonRunCard, dungeonTheme } from "./dungeon-card.js";
import { drawable, roleGlyph, type DungeonCardMember, type ScoreCard } from "./score-card.js";

// The "new guild record" card (owner, 7 November 2026: records were missable among the run cards in the completed-dungeons
// channel). A run that sets a guild record (or the first guild clear of a dungeon) gets this card as its own message right after
// the run's card: the dungeon's painted scene, a gold "NEW RECORD" ribbon, the new time large, the old time and the difference,
// the party with roles, and who held the record before. Kept in its own file so the shared card renderer stays untouched apart
// from one dispatch line. It follows the records rules (dungeon-records.ts) and the officer switch (dungeonHighlightsEnabled).

/** `previousSec` is absent for a first guild clear; equal to `newSec` for a tie. */
export interface RecordVisual { theme: DungeonArtTheme; ribbon: string; newSec: number; previousSec?: number | undefined; diffLabel: string; oldLabel: string;
  party: Pick<DungeonCardMember, "name" | "color" | "role" | "roleLabel" | "guild">[]; partyLabel: string; previousHolders: string[]; previousLabel: string }

/** Pure: "−4:03", "+0:12" or "=" for a tie (seconds, formatted like every run time). */
export function recordDiff(newSec: number, previousSec: number): string {
  const delta = previousSec - newSec;
  return delta === 0 ? "=" : `${delta > 0 ? "−" : "+"}${formatDuration(Math.abs(delta))}`;
}

/** The record items that earn a card: a new fastest clear, or the guild's first clear of a dungeon (its first record). */
export function recordItems(highlights: readonly DungeonHighlightItem[] | undefined): DungeonHighlightItem[] {
  const items = (highlights ?? []).filter(item => item.kind === "clear" || item.kind === "first");
  // A first clear of a route cannot also beat an earlier clear; keep the clear record when both somehow appear.
  return items.some(item => item.kind === "clear") ? items.filter(item => item.kind === "clear") : items.slice(0, 1);
}

/** Pure: the record card for one run and its record item. */
export function recordCard(run: DungeonImportResult, item: DungeonHighlightItem, lang: Lang): ScoreCard {
  const fr = lang === "fr", runCard = dungeonRunCard(run, lang);
  const newSec = item.valueSec ?? run.durationSec ?? 0, previousSec = item.kind === "clear" ? item.previousSec : undefined;
  const tie = previousSec !== undefined && previousSec === newSec;
  const ribbon = item.kind === "first" ? (fr ? "Premier record de la guilde" : "First guild record")
    : tie ? (fr ? "Record de guilde égalé" : "Guild record tied") : (fr ? "Nouveau record de guilde" : "New guild record");
  const party = (runCard.dungeon?.party ?? []).slice(0, 5).map(member => ({ name: member.name, color: member.color, role: member.role, roleLabel: member.roleLabel, guild: member.guild }));
  return {
    eyebrow: fr ? "Guilded · Record de donjon" : "Guilded · Dungeon record", title: runCard.title, subtitle: runCard.subtitle,
    stats: [], footer: fr ? "Le chrono démarre au premier combat · records de la guilde : /dungeon records" : "Times start at the first pull · guild records: /dungeon records",
    record: {
      theme: runCard.dungeon?.theme ?? dungeonTheme(run.dungeonName), ribbon, newSec, previousSec,
      diffLabel: previousSec === undefined ? (fr ? "Premier temps" : "First time") : recordDiff(newSec, previousSec),
      oldLabel: previousSec === undefined ? (fr ? "Aucun temps avant celui-ci" : "No time before this one") : `${fr ? "Ancien record" : "Previous record"} ${formatDuration(previousSec)}`,
      party, partyLabel: fr ? "Le groupe" : "The party",
      previousHolders: previousSec === undefined ? [] : (item.previousPlayers ?? []).slice(0, 5),
      previousLabel: fr ? "Détenu avant par :" : "Held before by:"
    }
  };
}

/** Pure: the record post's embed. The title carries the dungeon, the time and the difference; no one is pinged. */
export function recordEmbed(run: DungeonImportResult, item: DungeonHighlightItem, lang: Lang): EmbedBuilder {
  const fr = lang === "fr", card = recordCard(run, item, lang), visual = card.record!;
  const time = formatDuration(visual.newSec), diff = visual.previousSec === undefined ? "" : ` (${visual.diffLabel})`;
  const colon = fr ? " : " : ": ", where = `${card.title} ${time}`;
  const title = item.kind === "first" ? `🚩 ${fr ? "Premier record de guilde" : "First guild record"}${colon}${where}` : `🏆 ${visual.ribbon}${colon}${where}${diff}`;
  const lines = [`${fr ? "Le groupe" : "The party"}${colon}${visual.party.map(member => `**${escapeMarkdown(member.name)}**${member.roleLabel ? ` (${member.roleLabel})` : ""}`).join(", ")}`];
  if (visual.previousSec !== undefined) lines.push(`${visual.oldLabel}${visual.previousHolders.length ? ` · ${visual.previousLabel} ${visual.previousHolders.map(name => escapeMarkdown(name)).join(", ")}` : ""}`);
  return new EmbedBuilder().setColor(0xffd100).setTitle(title.slice(0, 256)).setDescription(lines.join("\n").slice(0, 2000));
}

// ---- Drawing (1200 x 630, the same WoW tooltip palette and font as score-card.ts) ----

const fontfile = fileURLToPath(new URL("../../site/fonts/source-serif-latin.ttf", import.meta.url));
const C = { bg: "#120d08", ink: "#f5e6c0", muted: "#b9a77f", gold: "#ffd100", deep: "#a67c1a", edge: "#6b5322", green: "#6fdc4f", red: "#ff6a52" };
const esc = (value: string) => drawable(value).replace(/\p{Cc}/gu, " ").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
const clip = (value: string, max: number) => { const chars = [...drawable(value)]; return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : chars.join(""); };
const span = (color: string, body: string, extra = "") => `<span foreground="${color}"${extra}>${esc(body || " ")}</span>`;
const caps = (color: string, body: string, spacing = 1800) => span(color, body.toUpperCase(), ` letter_spacing="${spacing}"`);
async function text(markup: string, size: number, maxWidth: number) {
  const { data, info } = await sharp({ text: { text: markup, font: `Source Serif 4 ${size}`, fontfile, width: maxWidth, rgba: true, wrap: "none" } }).png().toBuffer({ resolveWithObject: true });
  return { input: data, width: info.width, height: info.height };
}

/** Draws a card with a `record` visual. Called by score-card.ts's renderer (and its cache), never directly by callers. */
export async function renderRecordCard(card: ScoreCard): Promise<Buffer> {
  const visual = card.record!, layers: { input: Buffer; left: number; top: number }[] = [];
  const art = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">${dungeonArt(visual.theme)}</svg>`)).png().toBuffer();
  const put = async (markup: string, size: number, left: number, top: number, maxWidth = 1080, align: "left" | "center" | "right" = "left") => {
    const t = await text(markup, size, maxWidth);
    const x = align === "center" ? left - t.width / 2 : align === "right" ? left - t.width : left;
    layers.push({ input: t.input, left: Math.round(x), top: Math.round(top) });
    return t;
  };
  const tie = visual.previousSec !== undefined && visual.previousSec === visual.newSec;
  const diffColor = visual.previousSec === undefined || tie ? C.gold : visual.newSec < visual.previousSec ? C.green : C.red;
  const shapes = [
    `<defs><linearGradient id="shade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".72"/><stop offset=".55" stop-color="#000" stop-opacity=".45"/><stop offset="1" stop-color="#000" stop-opacity=".7"/></linearGradient>`
      + `<radialGradient id="glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${C.gold}" stop-opacity=".34"/><stop offset=".6" stop-color="${C.gold}" stop-opacity=".08"/><stop offset="1" stop-color="${C.gold}" stop-opacity="0"/></radialGradient>`
      + `<linearGradient id="ribbon" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${C.deep}"/><stop offset=".5" stop-color="${C.gold}"/><stop offset="1" stop-color="${C.deep}"/></linearGradient></defs>`,
    `<rect width="1200" height="630" fill="url(#shade)"/>`,
    `<ellipse cx="340" cy="330" rx="330" ry="190" fill="url(#glow)"/>`,
    // A heavier gold frame than the run card: two gold rules with a bronze line between them.
    `<rect x="14" y="14" width="1172" height="602" rx="8" fill="none" stroke="${C.gold}" stroke-width="4"/>`,
    `<rect x="24" y="24" width="1152" height="582" rx="5" fill="none" stroke="${C.deep}" stroke-width="1.5"/>`,
    `<rect x="30" y="30" width="1140" height="570" rx="4" fill="none" stroke="${C.gold}" stroke-opacity=".5" stroke-width="1"/>`,
    // The ribbon across the top left, with notched ends.
    `<path d="M40 52H660L640 80L660 108H40L60 80Z" fill="url(#ribbon)"/>`,
    `<path d="M40 52H660L640 80L660 108H40L60 80Z" fill="none" stroke="#5a3d08" stroke-width="1.5"/>`
  ];
  await put(caps("#2a1a02", clip(visual.ribbon, 30), 2600), 26, 350, 63, 580, "center");
  await put(caps(C.gold, clip(card.eyebrow ?? "Guilded", 44)), 16, 64, 130, 600);
  await put(span(C.ink, clip(card.title, 30)), [...drawable(card.title)].length <= 22 ? 46 : 36, 62, 152, 640);
  if (card.subtitle) await put(span(C.muted, clip(card.subtitle, 50)), 20, 64, 212, 640);

  // The time, large and gold, then the difference and the previous record under it.
  await put(span(C.gold, formatDuration(visual.newSec), ' font_weight="bold"'), 120, 340, 250, 640, "center");
  const pillW = 220, pillX = 340 - pillW / 2;
  shapes.push(`<rect x="${pillX}" y="420" width="${pillW}" height="52" rx="26" fill="${C.bg}" fill-opacity=".8" stroke="${diffColor}" stroke-width="2"/>`);
  await put(span(diffColor, clip(visual.diffLabel, 16)), 30, 340, 433, pillW - 20, "center");
  await put(span(C.ink, clip(visual.oldLabel, 40)), 22, 340, 488, 600, "center");

  // The party panel on the right.
  const px = 720, py = 130, pw = 420, ph = 360;
  shapes.push(`<rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="14" fill="${C.bg}" fill-opacity=".72" stroke="${C.deep}" stroke-width="1.5"/>`,
    `<rect x="${px + 20}" y="${py + 46}" width="${pw - 40}" height="1" fill="${C.edge}"/>`);
  await put(caps(C.gold, clip(visual.partyLabel, 30)), 15, px + 20, py + 18, pw - 40);
  for (const [i, member] of visual.party.slice(0, 5).entries()) {
    const ry = py + 66 + i * 56;
    shapes.push(roleGlyph(member.role, px + 40, ry + 20, 17));
    await put(span(member.color, clip(member.name, 24)), 22, px + 70, ry + 2, pw - 90);
    if (member.roleLabel) await put(span(C.muted, clip(member.roleLabel, 34)), 14, px + 70, ry + 30, pw - 90);
  }

  // Who held the record before (a first record has nobody to name).
  shapes.push(`<rect x="60" y="540" width="1080" height="1" fill="${C.edge}"/>`);
  const before = visual.previousHolders.length ? `${visual.previousLabel} ${visual.previousHolders.join(", ")}` : card.footer;
  await put(span(visual.previousHolders.length ? C.ink : C.muted, clip(before, 110)), 18, 64, 556, 1070);
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">${shapes.join("")}</svg>`);
  return sharp(art).composite([{ input: overlay, left: 0, top: 0 }, ...layers]).png().toBuffer();
}
