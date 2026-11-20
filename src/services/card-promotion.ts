import { ACCENTS, CARD_H, CARD_W, CardCanvas, INK, SUB } from "./card-kit.js";
import { artImage, hasArt, preloadPodiumArt, type PodiumArt } from "./podium-art.js";
import type { PromotionTier, PromotionVisual, ScoreCard } from "./score-card.js";
import type { Lang } from "../i18n.js";

/**
 * The promotion congratulations card (20 Nov 2026): the member, the character and the new rank, one design per rank tier (colour,
 * emblem, background). Painted emblems come from site/podium-art/ (sprout banner, bronze medal, shield, crown); a code-drawn shape
 * stands in when a file is missing. No game logo, crest or brand text.
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

interface Look { accent: string; tint: string; wash: string; art: PodiumArt | null; shape: "sprout" | "medal" | "shield" | "crown" | "star"; backdrop: "lines" | "glow" | "chevrons" | "rays" | "plain" }
const LOOKS: Record<PromotionTier, Look> = {
  initiate: { accent: "#2ecc71", tint: "#7fe0a2", wash: "#1c3a27", art: "rookie-banner", shape: "sprout", backdrop: "lines" },
  member: { accent: "#cd8a4b", tint: "#f0b07a", wash: "#3a2616", art: "medal-bronze", shape: "medal", backdrop: "glow" },
  officer: { accent: "#6aa8ff", tint: "#9cc4ff", wash: "#16294a", art: "mvp-shield", shape: "shield", backdrop: "chevrons" },
  leader: { accent: "#ffd100", tint: "#ffd100", wash: "#463510", art: "crown", shape: "crown", backdrop: "rays" },
  neutral: { accent: ACCENTS.achievement.accent, tint: ACCENTS.achievement.tint, wash: "#2c1c40", art: null, shape: "star", backdrop: "plain" }
};
export const PROMOTION_TIERS = Object.keys(LOOKS) as PromotionTier[];

const SHAPES: Record<Look["shape"], string> = {
  sprout: '<path d="M32 58 V30"/><path d="M32 34 C32 20 22 14 10 14 C10 28 18 34 32 34 Z"/><path d="M32 28 C32 16 42 8 56 8 C56 22 48 28 32 28 Z"/>',
  medal: '<circle cx="32" cy="38" r="16"/><path d="M22 24 L16 6 M42 24 L48 6"/>',
  shield: '<path d="M32 6 L54 14 V32 Q54 50 32 60 Q10 50 10 32 V14 Z"/><path d="M32 18 V46 M20 30 H44"/>',
  crown: '<path d="M8 48 L12 20 L24 34 L32 14 L40 34 L52 20 L56 48 Z"/><path d="M8 56 H56"/>',
  star: '<path d="M32 6 L39 24 L58 25 L43 37 L48 56 L32 45 L16 56 L21 37 L6 25 L25 24 Z"/>'
};

function background(c: CardCanvas, look: Look, h: number): void {
  c.rect(0, 0, CARD_W, h, "#15110d");
  c.raw(`<defs><radialGradient id="pg" cx="0.24" cy="0.5" r="0.75"><stop offset="0" stop-color="${look.wash}" stop-opacity="1"/><stop offset="1" stop-color="#15110d" stop-opacity="0"/></radialGradient></defs><rect width="${CARD_W}" height="${h}" fill="url(#pg)"/>`);
  const cx = 270, cy = h / 2;
  if (look.backdrop === "rays") for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2, b = a + 0.1;
    c.raw(`<path d="M${cx} ${cy} L${cx + Math.cos(a) * 900} ${cy + Math.sin(a) * 900} L${cx + Math.cos(b) * 900} ${cy + Math.sin(b) * 900} Z" fill="${look.accent}" fill-opacity="0.09"/>`);
  } else if (look.backdrop === "lines") for (let x = -h; x < CARD_W; x += 46) c.raw(`<path d="M${x} ${h} L${x + h} 0" stroke="${look.accent}" stroke-opacity="0.10" stroke-width="10"/>`);
  else if (look.backdrop === "chevrons") for (let i = 0; i < 7; i++) c.raw(`<path d="M${620 + i * 90} 0 L${700 + i * 90} ${h / 2} L${620 + i * 90} ${h}" fill="none" stroke="${look.accent}" stroke-opacity="${0.16 - i * 0.015}" stroke-width="14"/>`);
  else if (look.backdrop === "glow") for (const r of [150, 230, 310]) c.raw(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${look.accent}" stroke-opacity="0.14" stroke-width="6"/>`);
  c.rect(0, 0, CARD_W, 8, look.accent);
  c.rect(0, h - 8, CARD_W, 8, look.accent);
}

export async function renderPromotionCard(card: ScoreCard): Promise<Buffer | null> {
  const v: PromotionVisual | undefined = card.promotion;
  if (!v) return null;
  const look = LOOKS[v.tier] ?? LOOKS.neutral, H = CARD_H;
  await preloadPodiumArt();
  const c = new CardCanvas(H);
  background(c, look, H);
  // The emblem, large on the left: painted when its file loads, else the drawn shape.
  c.raw(`<circle cx="270" cy="${H / 2}" r="190" fill="#000" fill-opacity="0.35" stroke="${look.accent}" stroke-width="5"/>`);
  if (look.art && hasArt(look.art)) {
    const w = look.art === "medal-bronze" ? 190 : look.art === "rookie-banner" ? 230 : 260;
    const ratio = look.art === "medal-bronze" ? 192 / 130 : look.art === "rookie-banner" ? 192 / 190 : look.art === "mvp-shield" ? 179 / 192 : 150 / 192;
    c.raw(artImage(look.art, 270 - w / 2, H / 2 - (w * ratio) / 2, w));
  } else c.raw(`<g transform="translate(${270 - 120} ${H / 2 - 120}) scale(${240 / 64})" fill="none" stroke="${look.tint}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round">${SHAPES[look.shape]}</g>`);
  const X = 540, W = CARD_W - X - 56;
  await c.text(v.kicker.toUpperCase(), X, 92, { size: 46, face: "title", color: look.tint, spacing: 800, maxW: W });
  await c.text(v.name, X, 176, { size: 68, face: "bold", color: INK, maxW: W });
  if (v.character) await c.text(v.character, X, 262, { size: 36, color: SUB, maxW: W });
  c.rect(X, 336, 120, 5, look.accent, { rx: 2 });
  await c.text(v.rankLabel.toUpperCase(), X, 372, { size: 28, face: "title", color: SUB, spacing: 600, maxW: W });
  await c.text(v.rank, X, 418, { size: 84, face: "bold", color: look.tint, maxW: W });
  return (await c.finish([])).png;
}

/** The card definition for one promotion (stored on the Discord job, drawn at delivery). */
export function promotionCard(lang: Lang, input: { name: string; character: string; rank: string }): ScoreCard {
  const fr = lang === "fr", kicker = fr ? "Félicitations !" : "Congratulations!", rankLabel = fr ? "Nouveau rang" : "New rank";
  return { title: kicker, subtitle: `${input.name} · ${input.rank}`, stats: [], footer: "", promotion: { tier: promotionTier(input.rank), kicker, name: input.name, character: input.character, rankLabel, rank: input.rank } };
}
