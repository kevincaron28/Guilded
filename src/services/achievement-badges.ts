import type { AchievementDef, AchievementGame, AchievementMetric, AchievementTier, WowEdition } from "./achievements-catalogue.js";
import { ACHIEVEMENTS, TIER_LABEL, achievementGameVisible } from "./achievements-catalogue.js";

// Badge artwork for the achievements, generated as SVG from this one module (original shapes, no game
// or publisher artwork). Tier picks the frame shape and metal, the game picks the colours of the centre
// plate and glyph, and each achievement id picks a glyph. Locked badges are dark greyscale silhouettes.
// The same markup is drawn on the share card (via sharp/librsvg) and inlined on the website, so it uses
// only plain attributes: no scripts, fonts, external references or CSS.

type Lines = (n: number) => string;
const star = (cx: number, cy: number, r: number) => {
  const pts = Array.from({ length: 10 }, (_, i) => { const a = -Math.PI / 2 + (i * Math.PI) / 5, d = i % 2 ? r * 0.45 : r; return `${(cx + d * Math.cos(a)).toFixed(1)},${(cy + d * Math.sin(a)).toFixed(1)}`; });
  return `<polygon points="${pts.join(" ")}" fill="currentColor"/>`;
};
const chevrons: Lines = n => Array.from({ length: n }, (_, i) => `<path d="M5 ${19 - i * 5}l7-5 7 5"/>`).join("");

// Glyphs on a 24x24 grid, drawn with the badge's glyph colour (currentColor).
export const GLYPHS = {
  chevron1: chevrons(1), chevron2: chevrons(2), chevron3: chevrons(3), chevron4: chevrons(4),
  star: star(12, 12.5, 10), stars: star(12, 8, 6.5) + star(6, 17, 5) + star(18, 17, 5),
  hammer: `<path d="M13 4l7 7M9 8l7 7-2.500 2.500-7-7zM11 12L4 20"/>`,
  anvil: `<path d="M3 6h17v3h-6l-2 2.500V15h3v4H8v-4h3v-3.500L8.500 9H3z"/>`,
  door: `<path d="M6 21V9a6 6 0 0 1 12 0v12zM4 21h16"/><circle cx="14.500" cy="14.500" r="1" fill="currentColor"/>`,
  key: `<circle cx="8" cy="8" r="4"/><path d="M11 11l9 9M17 17l2.500-2.500M14 14l2-2"/>`,
  torch: `<path d="M12 2c1 3.500 5 5.500 5 9a5 5 0 0 1-10 0c0-1.800 1-3 2-4 0 1.500 1 2.500 2 2.500-.5-2.500-1-4.500 1-7.500zM10 16l-1 6h6l-1-6"/>`,
  swords: `<path d="M4 4l11 11M20 4L9 15M13 17l-3 3 2 2M11 17l3 3-2 2M6 15l-3 3M18 15l3 3"/>`,
  skull: `<path d="M12 3a8 8 0 0 0-5 14.200V20h10v-2.800A8 8 0 0 0 12 3z"/><circle cx="9" cy="11" r="1.700" fill="currentColor"/><circle cx="15" cy="11" r="1.700" fill="currentColor"/><path d="M10 20v-2.500M14 20v-2.500"/>`,
  compass: `<circle cx="12" cy="12" r="9"/><path d="M16 8l-2.500 5.500L8 16l2.500-5.500z" fill="currentColor"/>`,
  banner: `<path d="M6 3v18M6 4h12l-3 4 3 4H6"/>`,
  shield: `<path d="M12 3l8 3v6c0 5-3.500 8-8 9-4.500-1-8-4-8-9V6z"/>`,
  horn: `<path d="M3 10v4h4l10 5V5L7 10zM20 9a4 4 0 0 1 0 6"/>`,
  tower: `<path d="M5 9V4h2v2h2V4h6v2h2V4h2v5zM7 9v12h10V9M10 21v-4a2 2 0 0 1 4 0v4"/>`,
  crown: `<path d="M3 18l1.500-11 5 5L12 5l2.500 7 5-5L21 18zM4 21h16"/>`,
  trophy: `<path d="M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3M12 14v4M8 21h8M10 18h4"/>`,
  sword: `<path d="M20 4L9 15M7 13l4 4M9 15l-5 5"/><path d="M20 4l-2 .5L19.500 6z" fill="currentColor"/>`,
  flame: `<path d="M12 3c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3.500 2-4.500 0 1.500 1 2.500 2 2.500-.5-3-.5-5 1-9z"/>`,
  speech: `<path d="M4 5h16v11h-9l-5 4v-4H4z"/>`,
  calendar: `<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/>`,
  heart: `<path d="M12 20S4 15 4 9.500A4.500 4.500 0 0 1 12 7a4.500 4.500 0 0 1 8 2.500C20 15 12 20 12 20z"/>`,
  gem: `<path d="M6 4h12l4 6-10 11L2 10zM2 10h20M9 4l-2 6 5 11 5-11-2-6"/>`,
  orb: `<circle cx="12" cy="12" r="8.500"/><path d="M8 10a5 5 0 0 1 4-3"/><circle cx="12" cy="12" r="2.500" fill="currentColor"/>`,
  ascend: `<path d="M12 21V5M5 12l7-7 7 7M7 21h10"/>`,
  sun: `<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>`,
  map: `<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14"/>`,
  pin: `<path d="M12 21s-6-5.500-6-11a6 6 0 0 1 12 0c0 5.500-6 11-6 11z"/><circle cx="12" cy="10" r="2" fill="currentColor"/>`,
  bubble: `<path d="M4 5h16v11h-9l-5 4v-4H4z"/><circle cx="8.500" cy="10.500" r="1" fill="currentColor"/><circle cx="12" cy="10.500" r="1" fill="currentColor"/><circle cx="15.500" cy="10.500" r="1" fill="currentColor"/>`,
  mic: `<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8"/>`,
  smile: `<circle cx="12" cy="12" r="9"/><path d="M8 14a5 5 0 0 0 8 0"/><circle cx="9" cy="9.500" r="1" fill="currentColor"/><circle cx="15" cy="9.500" r="1" fill="currentColor"/>`,
  sparkle: `<path d="M12 2c1 5 3 8 8 10-5 2-7 5-8 10-1-5-3-8-8-10 5-2 7-5 8-10z"/>`,
  coin: `<circle cx="12" cy="12" r="9"/><path d="M12 6.500v11M9.500 9.500c0-2 5-2 5 0s-5 2-5 4.500 5 2.500 5 .5"/>`,
  bolt: `<path d="M13 2L5 14h6l-1 8 8-12h-6z"/>`,
  duel: `<path d="M4 4l9 9M20 4l-9 9M11 15l-2 2 1.500 1.500M13 15l2 2-1.500 1.500M12 21v-3"/><path d="M3 20l3-3M21 20l-3-3"/><circle cx="12" cy="10" r="1.200" fill="currentColor"/>`,
  medal: `<circle cx="12" cy="15" r="6"/><path d="M8 3l4 7 4-7M12 12l1 2h2l-1.500 1.300.5 2-2-1.200-2 1.200.5-2L9 14h2z"/>`,
  cake: `<path d="M4 20h16v-6H4zM4 14c2 2 4 2 4 0 0 2 4 2 4 0 0 2 4 2 4 0 0 2 4 2 4 0M12 11V8M12 3c1 1.500 1 2.500 0 3.500-1-1-1-2 0-3.500z"/>`
} as const;
export type GlyphName = keyof typeof GLYPHS;

// Long progressions share one glyph per metric; the tier frame and the rank pips tell the steps apart.
// Every ladder metric is listed here on purpose: a new ladder without a glyph fails to compile (and the test below).
type LadderMetric = "messagesSent" | "voiceHours" | "reactionsGiven" | "reactionsReceived" | "communityPoints" | "epEarned" | "mvpWeeks" | "serverAnniversaries" | "honorableKills" | "duelWins" | "craftsDone";
const LADDER_GLYPH: Record<LadderMetric, GlyphName> = { messagesSent: "bubble", voiceHours: "mic", reactionsGiven: "smile", reactionsReceived: "sparkle", communityPoints: "coin", epEarned: "bolt", mvpWeeks: "trophy", serverAnniversaries: "cake", honorableKills: "medal", duelWins: "duel", craftsDone: "hammer" };
const SINGLE_GLYPH: Record<string, GlyphName> = {
  "dungeon-runs-1": "door", "dungeon-runs-10": "key", "dungeon-runs-25": "torch", "dungeon-runs-50": "swords", "dungeon-runs-100": "crown",
  "dungeon-variety-1": "map", "dungeon-variety-5": "compass", "dungeon-variety-10": "gem", "duel-streak-5": "ascend", "duel-beat-top": "orb",
  "raids-1": "banner", "raids-5": "shield", "raids-10": "horn", "raids-25": "tower", "raids-50": "trophy",
  "raid-clears-1": "sword", "raid-clears-5": "skull", "raid-clears-10": "flame",
  "active-days-7": "speech", "active-days-30": "calendar", "active-days-100": "heart"
};
/** One glyph per achievement id. The test suite requires every catalogue id to appear here. */
const EDITION_LEVEL_GLYPH: Record<WowEdition, GlyphName> = { forever: "flame" };
const editionGlyph = (def: AchievementDef): GlyphName => def.metric === "wowEditionCap" ? "stars" : def.metric === "professionsMastered" ? "crown" : def.metric === "professionFirsts" ? "trophy" : def.metric === "rareRecipes" ? "gem" : def.metric === "wowEditionProfession" ? (def.threshold >= 300 ? "anvil" : "hammer") : EDITION_LEVEL_GLYPH[def.edition!];
const ladderGlyph = (def: AchievementDef): GlyphName => {
  const glyph = (LADDER_GLYPH as Partial<Record<AchievementMetric, GlyphName>>)[def.metric];
  if (!glyph) throw new Error(`Achievement ${def.id} has no badge glyph: add its metric to LADDER_GLYPH or its id to SINGLE_GLYPH`);
  return glyph;
};
export const GLYPH_BY_ID: Record<string, GlyphName> = {
  ...SINGLE_GLYPH,
  ...Object.fromEntries(ACHIEVEMENTS.filter(def => def.edition).map(def => [def.id, editionGlyph(def)])),
  ...Object.fromEntries(ACHIEVEMENTS.filter(def => def.rank && !def.edition && !(def.id in SINGLE_GLYPH)).map(def => [def.id, ladderGlyph(def)]))
};

/**
 * Generated rows (in-game Forever achievements, no fixed list) pick a glyph from their text: a keyword in the name or description first
 * (dungeon, raid, honor ...), else one of a fixed set chosen by the id, so the same achievement always draws the same badge.
 */
const GENERATED_KEYWORDS: [RegExp, GlyphName][] = [
  [/dungeon|instance|spelunk|deadmines|stockade|caverns|depths/i, "door"], [/raid|boss|hyjal|onyxia|barrow/i, "banner"], [/duel/i, "duel"],
  [/honor|rank|pvp|battleground|warsong|arathi|alterac|kill/i, "swords"], [/explor|zone|discover|journey/i, "compass"], [/quest/i, "map"],
  [/alchemy|potion/i, "orb"], [/blacksmith|engineer|forge|smith/i, "anvil"], [/enchant|tailor|leather|skinning|herb|mining|cooking|fishing|first aid|profession|skill/i, "hammer"],
  [/reputation|exalted|renown|faction/i, "banner"], [/gold|coin|money|wealth/i, "coin"], [/level|class|druid|hunter|mage|paladin|priest|rogue|shaman|warlock|warrior/i, "star"]
];
const GENERATED_POOL: GlyphName[] = ["star", "gem", "compass", "banner", "shield", "torch", "map", "key", "crown", "orb", "horn", "tower", "sword", "flame", "medal", "sparkle"];
export function generatedGlyph(def: Pick<AchievementDef, "id" | "en">): GlyphName {
  const text = `${def.en.name} ${def.en.description}`;
  for (const [pattern, glyph] of GENERATED_KEYWORDS) if (pattern.test(text)) return glyph;
  const n = Number(/(\d+)$/.exec(def.id)?.[1] ?? 0);
  return GENERATED_POOL[n % GENERATED_POOL.length]!;
}

// Frame outlines on a 64x64 grid, one per tier: circle, hexagon, shield, octagon, spiked star, sunburst.
const spiked = Array.from({ length: 16 }, (_, i) => { const a = -Math.PI / 2 + (i * Math.PI) / 8, d = i % 2 ? 24.500 : 30.500; return `${(32 + d * Math.cos(a)).toFixed(1)},${(32 + d * Math.sin(a)).toFixed(1)}`; }).join(" ");
const hex = Array.from({ length: 6 }, (_, i) => { const a = -Math.PI / 2 + (i * Math.PI) / 3; return `${(32 + 29.500 * Math.cos(a)).toFixed(1)},${(32 + 29.500 * Math.sin(a)).toFixed(1)}`; }).join(" ");
const octagon = Array.from({ length: 8 }, (_, i) => { const a = -Math.PI / 2 + Math.PI / 8 + (i * Math.PI) / 4; return `${(32 + 30.500 * Math.cos(a)).toFixed(1)},${(32 + 30.500 * Math.sin(a)).toFixed(1)}`; }).join(" ");
const sunburst = Array.from({ length: 24 }, (_, i) => { const a = -Math.PI / 2 + (i * Math.PI) / 12, d = i % 2 ? 26.500 : 31; return `${(32 + d * Math.cos(a)).toFixed(1)},${(32 + d * Math.sin(a)).toFixed(1)}`; }).join(" ");
const FRAME: Record<AchievementTier, string> = {
  bronze: `<circle cx="32" cy="32" r="29"/>`,
  silver: `<polygon points="${hex}" stroke-linejoin="round"/>`,
  gold: `<path d="M32 3l25 8v23c0 13-11 23-25 27C18 57 7 47 7 34V11z" stroke-linejoin="round"/>`,
  platinum: `<polygon points="${octagon}" stroke-linejoin="round"/>`,
  epic: `<polygon points="${spiked}" stroke-linejoin="round"/>`,
  legendary: `<polygon points="${sunburst}" stroke-linejoin="round"/><circle cx="32" cy="32" r="25" fill="none" stroke-width="1.200"/>`
};
// Metal gradients (top, middle, bottom) and edge colour per tier.
const METAL: Record<AchievementTier, [string, string, string, string]> = {
  bronze: ["#f0b27a", "#c0763a", "#7a4218", "#4d2810"], silver: ["#f4f7fa", "#b4bdc8", "#707b88", "#454d58"],
  gold: ["#fff3a6", "#e3ae1c", "#8a6508", "#5a4204"], platinum: ["#f4ffff", "#8fd6e8", "#3c8aa6", "#1f4a5c"],
  epic: ["#efc0ff", "#a54be0", "#52207f", "#2e1048"], legendary: ["#ffe2a8", "#ff7a2e", "#b02410", "#5a0d05"]
};
// Per game: centre plate (top, bottom) and glyph colour. WoW gold on blue, guild green, PoE2 ember on dark red.
const GAME: Record<AchievementGame, { plate: [string, string]; glyph: string }> = {
  wow: { plate: ["#24518a", "#0c1c36"], glyph: "#ffd45c" }, guild: { plate: ["#1f5a34", "#0b2214"], glyph: "#8ff0a0" }, poe2: { plate: ["#661616", "#240606"], glyph: "#ff8a4a" }
};
// WoW Forever's centre-plate colour and glyph colour.
const EDITION_ACCENT: Record<WowEdition, { plate: [string, string]; glyph: string }> = {
  forever: { plate: ["#4a2f9a", "#150b36"], glyph: "#d2c4ff" }
};
const LOCKED = { metal: ["#4a4f58", "#33373e", "#24272c", "#181a1e"], plate: ["#16181c", "#0b0c0e"], glyph: "#5e6268" };

/** The badge's elements on a 64x64 grid (no outer svg), with ids unique to this def and state. */
export function badgeInner(def: AchievementDef, earned: boolean, tracking?: boolean): string {
  if (!achievementGameVisible(def, tracking)) return ""; // PoE2 badges follow the tracking switch (data is kept)
  const id = `ab-${def.id}-${earned ? "e" : "l"}`;
  const [m0, m1, m2, edge] = earned ? METAL[def.tier] : (LOCKED.metal as [string, string, string, string]);
  const accent = def.edition ? EDITION_ACCENT[def.edition] : GAME[def.game];
  const [p0, p1] = earned ? accent.plate : (LOCKED.plate as [string, string]);
  const glyph = earned ? accent.glyph : LOCKED.glyph;
  const frame = FRAME[def.tier];
  const gloss = earned ? `<ellipse cx="25" cy="17" rx="13" ry="6" fill="#fff" opacity=".18" transform="rotate(-20 25 17)"/>` : "";
  const gem = def.tier === "epic" || def.tier === "legendary" ? `<circle cx="32" cy="6.500" r="3.200" fill="${earned ? (def.tier === "epic" ? "#ff5ad0" : "#5ae6ff") : "#2a2d33"}" stroke="${edge}" stroke-width="1"/>` : "";
  // Rank pips (one per step of a long progression) under the glyph, so steps in the same tier look different.
  const pips = def.rank ? Array.from({ length: Math.min(def.rank, 10) }, (_, i) => `<circle cx="${(32 + (i - (Math.min(def.rank!, 10) - 1) / 2) * 3.200).toFixed(1)}" cy="49.500" r="1.100" fill="${glyph}"${earned ? "" : ` opacity=".7"`}/>`).join("") : "";
  const glyphName = GLYPH_BY_ID[def.id] ?? (def.metric === "gameAchievement" ? generatedGlyph(def) : undefined);
  if (!glyphName) throw new Error(`Achievement ${def.id} has no badge glyph`);
  const body = GLYPHS[glyphName];
  return `<defs><linearGradient id="${id}-m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${m0}"/><stop offset=".5" stop-color="${m1}"/><stop offset="1" stop-color="${m2}"/></linearGradient>`
    + `<linearGradient id="${id}-p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p0}"/><stop offset="1" stop-color="${p1}"/></linearGradient></defs>`
    + `<g fill="url(#${id}-m)" stroke="${edge}" stroke-width="2">${frame}</g>`
    + `<g transform="translate(32 32) scale(.74) translate(-32 -32)" fill="url(#${id}-p)" stroke="${edge}" stroke-width="2.500" stroke-opacity=".8">${frame}</g>`
    + gloss + gem + pips
    + `<g transform="translate(${def.rank ? "20 16.500" : "18.200 18.800"}) scale(${def.rank ? "1" : "1.150"})" color="${glyph}" fill="none" stroke="currentColor" stroke-width="1.900" stroke-linecap="round" stroke-linejoin="round"${earned ? "" : ` opacity=".7"`}>${body}</g>`;
}

/**
 * A standalone badge. With `label` it is an image with that accessible name; without, it is decorative
 * (aria-hidden), for lists that already carry the name and status in text.
 */
export function badgeSvg(def: AchievementDef, earned: boolean, options: { size?: number; label?: string; tracking?: boolean } = {}): string {
  if (!achievementGameVisible(def, options.tracking)) return "";
  const size = options.size ?? 64;
  const name = options.label === undefined ? ` aria-hidden="true" focusable="false"` : ` role="img" aria-label="${escapeAttr(options.label)}"`;
  const title = options.label === undefined ? "" : `<title>${escapeAttr(options.label)}</title>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}"${name}>${title}${badgeInner(def, earned, options.tracking)}</svg>`;
}

/** Accessible name in both languages, e.g. "Dungeon Regular: Bronze, unlocked". */
export function badgeLabel(def: AchievementDef, earned: boolean, lang: "en" | "fr"): string {
  return `${def[lang].name}: ${TIER_LABEL[def.tier][lang]}, ${earned ? (lang === "fr" ? "débloqué" : "unlocked") : (lang === "fr" ? "verrouillé" : "locked")}`;
}

function escapeAttr(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
