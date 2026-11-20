import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { ACCENTS, CARD_H, CARD_W, CardCanvas, INK, SUB } from "./card-kit.js";
import { lifted } from "./dungeon-backdrop.js";
import { plainArt } from "./card-layouts-recap.js";
import type { PromotionTier, PromotionVisual, ScoreCard } from "./score-card.js";
import type { Lang } from "../i18n.js";

/**
 * The promotion congratulations card (20 Nov 2026), in the dungeon run card's style: a painted scene fills the card (one per rank tier,
 * site/card-art/promotion/<tier>.jpg), a dark gradient on the left keeps the text legible, the gothic title face carries the header and
 * the member's name, and a strip at the foot carries the footer line. A missing or unreadable painting falls back to the plain glow.
 * No game logo, crest or brand text in the paintings.
 */
const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** Rank name to tier (English and French). Anything else is neutral. */
export function promotionTier(rankName: string): PromotionTier {
  const n = plain(rankName);
  if (/guild ?master|maitre de guilde|chef de guilde|^(co )?(gm|gl|chef|leader)\b|^co ?gm/.test(n)) return "leader";
  if (/^officers?\b|^officiers?\b|^lieutenant|^capitaine|^captain/.test(n)) return "officer";
  if (/^members?$|^membres?$|^veterans?|^core\b|^raider/.test(n)) return "member";
  if (/^initiates?$|^inities?$|^recrues?$|^recruits?$|^trial|^aspirants?|^novice|^newcomer/.test(n)) return "initiate";
  return "neutral";
}

const ACCENT: Record<PromotionTier, { accent: string; tint: string }> = {
  initiate: { accent: "#f2b84b", tint: "#ffd98a" },
  member: { accent: "#e0793a", tint: "#ffb27a" },
  officer: { accent: "#6aa8ff", tint: "#a9cbff" },
  leader: { accent: "#ffd100", tint: "#ffd100" },
  neutral: { accent: ACCENTS.roster.accent, tint: ACCENTS.roster.tint }
};
export const PROMOTION_TIERS = Object.keys(ACCENT) as PromotionTier[];

async function painting(tier: PromotionTier): Promise<Buffer> {
  try {
    const file = fileURLToPath(new URL(`../../site/card-art/promotion/${tier}.jpg`, import.meta.url));
    const art = await sharp(await readFile(file)).resize(CARD_W, CARD_H, { fit: "cover" }).removeAlpha().jpeg({ quality: 88 }).toBuffer();
    return await lifted(art);
  } catch {
    return sharp(await plainArt()).resize(CARD_W, CARD_H, { fit: "cover" }).removeAlpha().png().toBuffer();
  }
}

export async function renderPromotionCard(card: ScoreCard): Promise<Buffer | null> {
  const v: PromotionVisual | undefined = card.promotion;
  if (!v) return null;
  const tier = ACCENT[v.tier] ? v.tier : "neutral", { accent, tint } = ACCENT[tier];
  const c = new CardCanvas(), x = 56, headW = 722;
  c.gradient(0, 0, 900, CARD_H, "h", [[0, "#000", 0.82], [0.45, "#000", 0.45], [1, "#000", 0]]);
  c.rect(0, 548, CARD_W, 82, "#060504", { opacity: 0.66 });
  c.rect(0, 546, CARD_W, 3, accent, { opacity: 0.9 });
  await c.text(v.kicker.toUpperCase(), x, 28, { size: 30, face: "title", color: tint, spacing: 800, maxW: headW });
  await c.text(v.name, x, 70, { size: 84, face: "title", maxW: headW });
  if (v.character) await c.text(v.character, x, 186, { size: 36, face: "bold", color: INK, maxW: headW });
  await c.text(v.rankLabel, x, 284, { size: 28, color: SUB, maxW: headW });
  await c.text(v.rank, x, 322, { size: 80, face: "bold", color: tint, maxW: headW });
  if (card.footer) await c.text(card.footer, x, 575, { size: 26, color: SUB, maxW: CARD_W - 112 });
  return (await c.finish([{ input: await painting(tier), left: 0, top: 0 }])).png;
}

/** The card definition for one promotion (stored on the Discord job, drawn at delivery). */
export function promotionCard(lang: Lang, input: { name: string; character: string; rank: string }): ScoreCard {
  const fr = lang === "fr", kicker = fr ? "Félicitations !" : "Congratulations!", rankLabel = fr ? "Nouveau rang :" : "New rank:";
  return { title: kicker, subtitle: `${input.name} · ${input.rank}`, stats: [], footer: fr ? "Promotion vue dans le jeu" : "Promotion seen in game",
    promotion: { tier: promotionTier(input.rank), kicker, name: input.name, character: input.character, rankLabel, rank: input.rank } };
}
