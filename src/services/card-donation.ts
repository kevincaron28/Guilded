import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { CARD_H, CARD_W, CardCanvas, INK, SUB } from "./card-kit.js";
import { lifted } from "./dungeon-backdrop.js";
import { plainArt } from "./card-layouts-recap.js";
import { circleImage, type DonationLine, type ScoreCard } from "./score-card.js";
import type { Lang } from "../i18n.js";

/**
 * The guild bank donor card (owner request, 21 Nov 2026), in the promotion card's family (card-promotion.ts): a painted scene fills the
 * card, a dark gradient on the left keeps the text legible, the gothic title face carries the header and the donor's name, a strip at the
 * foot carries the footer. The left column lists what was given (gold first, then items with their game icons and counts, then "and N
 * more"); the right side holds the donor's round portrait (Armory picture, else Discord avatar) or a chest emblem. No product branding.
 * The painting is site/card-art/bank/donation.jpg when the owner adds one, else the promotion card's neutral scene (supplies and crates).
 */
const ACCENT = "#d4af37", TINT = "#ffd98a";
const QUALITY = ["#b8b8b8", INK, "#1eff00", "#4aa3ff", "#c77dff", "#ff9a3c", "#e6cc80", "#e6cc80"];
export const DONATION_ROWS = 5;

async function painting(): Promise<Buffer> {
  for (const path of ["../../site/card-art/bank/donation.jpg", "../../site/card-art/promotion/neutral.jpg"]) {
    try {
      const art = await sharp(await readFile(fileURLToPath(new URL(path, import.meta.url)))).resize(CARD_W, CARD_H, { fit: "cover" }).removeAlpha().jpeg({ quality: 88 }).toBuffer();
      return await lifted(art);
    } catch { /* next painting */ }
  }
  return sharp(await plainArt()).resize(CARD_W, CARD_H, { fit: "cover" }).removeAlpha().png().toBuffer();
}

/** A square game icon with rounded corners (null when unreadable, so the frame alone shows). */
async function iconImage(base64: string | undefined, size: number): Promise<Buffer | null> {
  if (!base64) return null;
  try {
    return await sharp(Buffer.from(base64, "base64"), { limitInputPixels: 1024 * 1024 }).resize(size, size, { fit: "cover" })
      .composite([{ input: Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="7"/></svg>`), blend: "dest-in" }]).png().toBuffer();
  } catch { return null; }
}

export async function renderDonationCard(card: ScoreCard): Promise<Buffer | null> {
  const v = card.donation;
  if (!v) return null;
  const c = new CardCanvas(), x = 64, headW = 760, icon = 44;
  c.gradient(0, 0, 1000, CARD_H, "h", [[0, "#000", 0.9], [0.6, "#000", 0.62], [1, "#000", 0]]);
  c.gradient(0, 0, CARD_W, 150, "v", [[0, "#000", 0.5], [1, "#000", 0]]);
  c.rect(0, 548, CARD_W, 82, "#060504", { opacity: 0.72 });
  c.rect(0, 546, CARD_W, 3, ACCENT, { opacity: 0.9 });
  await c.text(v.kicker.toUpperCase(), x, 44, { size: 30, face: "title", color: TINT, spacing: 800, maxW: headW });
  await c.text(v.name, x, 86, { size: v.combined ? 60 : 70, face: "title", maxW: headW });
  await c.text(v.thanks, x, 184, { size: 30, color: SUB, maxW: headW });
  c.rect(x, 232, 84, 4, ACCENT, { opacity: 0.9, rx: 2 });
  let y = 254;
  for (const line of v.lines.slice(0, DONATION_ROWS)) {
    const top = y, mid = top + icon / 2;
    if (line.kind === "item") {
      const color = QUALITY[line.quality ?? 1] ?? INK;
      // The icon goes inside the shapes layer (drawn after the dark gradient, so it keeps its colours), with the quality-coloured frame over it.
      const img = await iconImage(line.icon, icon - 4);
      if (img) {
        c.raw(`<image x="${x + 2}" y="${top + 2}" width="${icon - 4}" height="${icon - 4}" href="data:image/png;base64,${img.toString("base64")}"/>`);
        c.raw(`<rect x="${x + 1}" y="${top + 1}" width="${icon - 2}" height="${icon - 2}" rx="8" fill="none" stroke="${color}" stroke-width="2"/>`);
      } else c.rect(x, top, icon, icon, "#000", { rx: 8, opacity: 0.55, stroke: color, strokeWidth: 2 });
      if (!img) c.raw(`<path d="M${x + 22} ${top + 10} L${x + 34} ${mid} L${x + 22} ${top + 34} L${x + 10} ${mid} Z" fill="${color}" fill-opacity=".8"/>`);
      await c.text(line.text, x + icon + 16, top + 2, { size: 32, face: "bold", color, maxW: headW - icon - 16, ellipsis: true });
    } else if (line.kind === "gold") {
      c.raw(`<circle cx="${x + 22}" cy="${mid}" r="19" fill="#f5c542" stroke="#7a5410" stroke-width="2.5"/><circle cx="${x + 22}" cy="${mid}" r="11" fill="none" stroke="#a87412" stroke-width="2"/>`);
      await c.text(line.text, x + icon + 16, top + 2, { size: 34, face: "bold", color: "#ffd100", maxW: headW - icon - 16 });
    } else if (line.kind === "donor") {
      c.raw(`<circle cx="${x + 22}" cy="${mid}" r="9" fill="${ACCENT}"/>`);
      await c.text(line.text, x + icon + 16, top + 4, { size: 30, face: "bold", color: INK, maxW: headW - icon - 16, ellipsis: true });
    } else await c.text(line.text, x + icon + 16, top + 6, { size: 28, color: SUB, maxW: headW - icon - 16 });
    y += 54;
  }
  const face = card.portrait ? await circleImage(card.portrait, 200) : null;
  c.raw(`<circle cx="1018" cy="236" r="104" fill="#000" fill-opacity="${face ? 0 : 0.66}" stroke="${ACCENT}" stroke-opacity=".85" stroke-width="4"/>`);
  if (!face) c.emblem(v.combined ? "people" : "chest", 954, 172, 128, TINT);
  if (card.footer) await c.text(card.footer, x, 575, { size: 26, color: SUB, maxW: CARD_W - 112 });
  return (await c.finish([{ input: await painting(), left: 0, top: 0 }, ...(face ? [{ input: face, left: 918, top: 136 }] : [])])).png;
}

// ---------------------------------------------------------------------------------------------
// Card definitions and post text (pure)
// ---------------------------------------------------------------------------------------------

export interface DonationItemTotal { itemId: number | null; name: string; count: number; quality?: number | undefined }
export interface DonorTotal { name: string; character: string; gold: string | null; items: DonationItemTotal[] }

const t = (lang: Lang, en: string, fr: string) => lang === "fr" ? fr : en;
const itemCount = (items: readonly DonationItemTotal[]) => items.reduce((sum, item) => sum + item.count, 0);

/** "Kev, Lina and Marc" / "Kev, Lina et Marc". */
export function joinNames(names: readonly string[], lang: Lang): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} ${t(lang, "and", "et")} ${names[names.length - 1]}`;
}

/** The lines of one donor's card: gold, then the largest items, then "and N more" when they do not all fit. */
export function donationLines(donor: Pick<DonorTotal, "gold" | "items">, lang: Lang): DonationLine[] {
  const lines: DonationLine[] = donor.gold ? [{ kind: "gold", text: donor.gold }] : [];
  const items = [...donor.items].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const room = DONATION_ROWS - lines.length;
  const shown = items.length > room ? items.slice(0, room - 1) : items;
  for (const item of shown) lines.push({ kind: "item", text: `${item.count} × ${item.name}`, ...(item.itemId ? { itemId: item.itemId } : {}), ...(item.quality !== undefined ? { quality: item.quality } : {}) });
  const rest = items.length - shown.length;
  if (rest > 0) lines.push({ kind: "more", text: t(lang, `and ${rest} more item${rest > 1 ? "s" : ""}`, `et ${rest} autre${rest > 1 ? "s" : ""} objet${rest > 1 ? "s" : ""}`) });
  return lines;
}

/** One donor's summary on a combined card: "12 items · 50g 0s 0c". */
export function donorSummary(donor: DonorTotal, lang: Lang): string {
  const n = itemCount(donor.items);
  return [n ? t(lang, `${n} item${n > 1 ? "s" : ""}`, `${n} objet${n > 1 ? "s" : ""}`) : "", donor.gold ?? ""].filter(Boolean).join(" · ");
}

const FOOTER = { en: "Seen in the guild bank log", fr: "Vu dans le journal de la banque de guilde" } as const;

/** The card for one donor (stored on the Discord job, drawn at delivery). */
export function donationCard(lang: Lang, donor: DonorTotal): ScoreCard {
  const kicker = t(lang, "Thank you!", "Merci !"), thanks = t(lang, "for the donation to the guild bank", "pour ton don à la banque de guilde");
  return { title: kicker, subtitle: `${donor.name} · ${thanks}`, stats: [], footer: FOOTER[lang],
    donation: { kicker, name: donor.name, character: donor.character, thanks, lines: donationLines(donor, lang) } };
}

/** One card thanking several donors (the hour's card limit was reached): a line per donor, "and N more" past five. */
export function combinedDonationCard(lang: Lang, donors: readonly DonorTotal[]): ScoreCard {
  const kicker = t(lang, "Thank you!", "Merci !"), name = t(lang, "Guild bank donors", "Donateurs de la banque");
  const thanks = t(lang, `${donors.length} members filled the guild bank`, `${donors.length} membres ont garni la banque de guilde`);
  const shown = donors.length > DONATION_ROWS ? donors.slice(0, DONATION_ROWS - 1) : donors;
  const lines: DonationLine[] = shown.map((d) => ({ kind: "donor", text: `${d.name}: ${donorSummary(d, lang)}` }));
  const rest = donors.length - shown.length;
  if (rest > 0) lines.push({ kind: "more", text: t(lang, `and ${rest} more donor${rest > 1 ? "s" : ""}`, `et ${rest} autre${rest > 1 ? "s" : ""} donateur${rest > 1 ? "s" : ""}`) });
  return { title: kicker, subtitle: `${name} · ${thanks}`, stats: [], footer: FOOTER[lang], donation: { kicker, name, thanks, lines, combined: true } };
}

/** The post's text line, server language. `who` is a mention or a bold name. */
export function donationText(who: string, lang: Lang): string {
  return t(lang, `🎁 Thank you ${who} for your donation to the guild bank!`, `🎁 Merci ${who} pour ton don à la banque de guilde !`);
}

// ---------------------------------------------------------------------------------------------
// Delivery: game icons (best effort, never stored)
// ---------------------------------------------------------------------------------------------

const ICON_HOSTS = new Set(["render.worldofwarcraft.com", "render-us.worldofwarcraft.com", "render-eu.worldofwarcraft.com", "wow.zamimg.com"]);
const MAX_ICON_BYTES = 200_000;

/** Downloads one icon from Blizzard's render host (https only, small, 3 s), or null. */
export async function downloadIcon(url: string, fetcher: typeof fetch = fetch): Promise<Buffer | null> {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !ICON_HOSTS.has(parsed.hostname)) return null;
    const response = await fetcher(parsed, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.length <= MAX_ICON_BYTES ? bytes : null;
  } catch { return null; }
}

/** Adds the game icon to each item line whose icon the lookup finds (Blizzard's item media); lines without one keep the drawn frame. */
export async function withDonationIcons(card: ScoreCard, iconUrl: (itemId: number) => Promise<string | undefined>, download: (url: string) => Promise<Buffer | null> = (url) => downloadIcon(url)): Promise<ScoreCard> {
  const v = card.donation;
  if (!v) return card;
  const lines = await Promise.all(v.lines.map(async (line) => {
    if (line.kind !== "item" || !line.itemId || line.icon) return line;
    const url = await iconUrl(line.itemId).catch(() => undefined);
    const bytes = url ? await download(url) : null;
    return bytes ? { ...line, icon: bytes.toString("base64") } : line;
  }));
  return { ...card, donation: { ...v, lines } };
}

/** The combined post's text line. */
export function combinedDonationText(names: readonly string[], lang: Lang): string {
  const shown = names.length > 8 ? [...names.slice(0, 7), t(lang, `${names.length - 7} others`, `${names.length - 7} autres`)] : names;
  return t(lang, `🎁 Thank you ${joinNames(shown, lang)} for your donations to the guild bank!`, `🎁 Merci à ${joinNames(shown, lang)} pour vos dons à la banque de guilde !`);
}
