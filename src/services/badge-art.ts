import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp, { type OverlayOptions } from "sharp";
import type { AchievementDef, AchievementTier } from "./achievements-catalogue.js";

// Painted badge art (9.3): a badge is a tier frame plus an emblem, both owner-approved paintings (style A, painted metal medallion) prepared by
// scripts/build-badge-art.mjs into site/badge-art/. This module maps every achievement to a family (and, when its picture exists, a finer
// emblem), composes the badge once with sharp and caches it, and makes the "locked" look by code. Where an asset is missing the caller keeps
// the old SVG badge (achievement-badges.ts), so nothing can break and emblems can be dropped into site/badge-art/emblems/ one by one.

export type BadgeFamily = "dungeons" | "raids" | "duels" | "pvp" | "professions" | "levelling" | "guild" | "seasons" | "ingame";
/** The family emblem (file name without size) every badge of a family falls back to. */
export const FAMILY_EMBLEM: Record<BadgeFamily, string> = {
  dungeons: "dungeons-gate", raids: "raids-banner", duels: "duels-blades", pvp: "pvp-helm", professions: "professions-anvil",
  levelling: "levelling-axe", guild: "guild-horn", seasons: "seasons-laurel", ingame: "ingame-star"
};
const FAMILY_BY_METRIC: Record<string, BadgeFamily> = {
  dungeonRuns: "dungeons", dungeonVariety: "dungeons", poeMaps: "dungeons",
  raidsAttended: "raids", raidClears: "raids", epEarned: "raids",
  duelWins: "duels", duelStreak: "duels", beatTopDuelist: "duels",
  honorableKills: "pvp",
  wowEditionProfession: "professions", professionsMastered: "professions", professionFirsts: "professions", rareRecipes: "professions", craftsDone: "professions", professionSkill: "professions",
  wowEditionLevel: "levelling", wowEditionCap: "levelling", wowLevel: "levelling", wowMaxLevel: "levelling", poeLevel: "levelling",
  messagesSent: "guild", voiceHours: "guild", reactionsGiven: "guild", reactionsReceived: "guild", communityPoints: "guild", mvpWeeks: "guild", serverAnniversaries: "guild", activeDays: "guild",
  gameAchievement: "ingame"
};
/** The in-game (generated) achievements pick their family from their text, like the old glyph keywords; anything else is "ingame". */
const GENERATED_FAMILY: [RegExp, BadgeFamily][] = [
  [/dungeon|instance|spelunk|deadmines|stockade|caverns|depths/i, "dungeons"], [/raid|boss|hyjal|onyxia|barrow/i, "raids"], [/duel/i, "duels"],
  [/honor|rank|pvp|battleground|warsong|arathi|alterac|kill/i, "pvp"],
  [/alchemy|potion|blacksmith|engineer|forge|smith|enchant|tailor|leather|skinning|herb|mining|cooking|fishing|first aid|profession|skill/i, "professions"],
  [/level|class|druid|hunter|mage|paladin|priest|rogue|shaman|warlock|warrior/i, "levelling"]
];
export function badgeFamily(def: Pick<AchievementDef, "metric" | "en">): BadgeFamily {
  if (def.metric === "gameAchievement") {
    const text = `${def.en.name} ${def.en.description}`;
    for (const [pattern, family] of GENERATED_FAMILY) if (pattern.test(text)) return family;
    return "ingame";
  }
  return FAMILY_BY_METRIC[def.metric] ?? "guild";
}

/**
 * Finer emblems the owner has not approved yet, by achievement id (the brief's items A2-I3). A file named here that does not exist in
 * site/badge-art/emblems/ is simply ignored and the badge keeps its family emblem; adding the file is all it takes.
 */
export const ITEM_EMBLEMS: Record<string, string> = {
  "dungeon-runs-10": "dungeons-key", "dungeon-runs-25": "dungeons-torch", "dungeon-variety-1": "dungeons-map", "dungeon-variety-5": "dungeons-map", "dungeon-variety-10": "dungeons-map",
  "raids-10": "raids-horn", "raids-25": "raids-siege", "raid-clears-1": "raids-skull", "raid-clears-5": "raids-skull", "raid-clears-10": "raids-skull",
  "duel-streak-5": "duels-flame", "duel-beat-top": "duels-throne"
};

const ART_DIR = fileURLToPath(new URL("../../site/badge-art/", import.meta.url));
let known: Set<string> | null = null;
/** The emblems present on disk (read once; a deploy restarts the process). */
export function availableEmblems(): Set<string> {
  if (!known) { try { known = new Set(readdirSync(`${ART_DIR}emblems`).filter(name => name.endsWith("-256.webp")).map(name => name.slice(0, -9))); } catch { known = new Set(); } }
  return known;
}
export const hasFrame = (tier: AchievementTier) => existsSync(`${ART_DIR}frames/${tier}-256.webp`);

/** The emblem a badge draws: its own picture when it exists, else its family's, else null (the SVG badge is drawn). */
export function emblemFor(def: Pick<AchievementDef, "id" | "metric" | "en">): string | null {
  const present = availableEmblems(), own = ITEM_EMBLEMS[def.id];
  if (own && present.has(own)) return own;
  const family = FAMILY_EMBLEM[badgeFamily(def)];
  return present.has(family) ? family : null;
}

/** Where the emblem sits inside the frame, as a fraction of the badge's side (the painted frames have an empty dark disc in the middle). */
export const EMBLEM_BOX = 0.6;
const EMBLEM_CENTER_Y = 0.5;
const pipsSvg = (rank: number, size: number, earned: boolean) => {
  const count = Math.min(rank, 10), r = size * 0.014, gap = size * 0.04;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${Array.from({ length: count }, (_, i) => `<circle cx="${(size / 2 + (i - (count - 1) / 2) * gap).toFixed(1)}" cy="${(size * 0.81).toFixed(1)}" r="${r.toFixed(2)}" fill="${earned ? "#ffd45c" : "#9a9a9a"}" stroke="#2a1a05" stroke-width="${(size * 0.004).toFixed(2)}"/>`).join("")}</svg>`;
};

const budget = 2 * 1024 * 1024;
const cache = new Map<string, Buffer>();
let cacheBytes = 0;
export function badgeCacheEntries(): number { return cache.size; }
export function resetBadgeCache(): void { cache.clear(); cacheBytes = 0; }
function remember(key: string, png: Buffer): void {
  cache.set(key, png); cacheBytes += png.length;
  while (cacheBytes > budget && cache.size > 1) { const oldest = cache.keys().next().value as string; cacheBytes -= cache.get(oldest)!.length; cache.delete(oldest); }
}

/**
 * The composed badge as a PNG (size 128 or 256): the tier frame, the emblem in its centre and, for a step of a long progression, rank pips.
 * A locked badge is the same picture desaturated and darkened. Composed once per (emblem, tier, state, rank, size) and cached; null when an asset is missing.
 */
export async function composeBadge(emblem: string, tier: AchievementTier, earned: boolean, rank: number | undefined, size: 128 | 256): Promise<Buffer | null> {
  const key = `${emblem}|${tier}|${earned ? 1 : 0}|${rank ?? 0}|${size}`, hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit; }
  try {
    const box = Math.round(size * EMBLEM_BOX);
    const emblemImage = await sharp(`${ART_DIR}emblems/${emblem}-${size}.webp`).resize(box, box, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    const layers: OverlayOptions[] = [{ input: emblemImage, left: Math.round((size - box) / 2), top: Math.round(size * EMBLEM_CENTER_Y - box / 2) }];
    if (rank) layers.push({ input: Buffer.from(pipsSvg(rank, size, earned)), left: 0, top: 0 });
    let image = sharp(`${ART_DIR}frames/${tier}-${size}.webp`).composite(layers);
    if (!earned) image = sharp(await image.png().toBuffer()).modulate({ saturation: 0.08, brightness: 0.5 });
    const png = await image.png({ compressionLevel: 9, palette: false }).toBuffer();
    remember(key, png);
    return png;
  } catch { return null; }
}

// A card definition stores a small token, not the picture, so queued cards stay small; the picture is composed when the card is drawn.
const TOKEN = /<badge-art emblem="([a-z0-9-]+)" tier="(bronze|silver|gold|platinum|epic|legendary)" earned="([01])" rank="(\d+)"\/>/g;
export const badgeToken = (emblem: string, tier: AchievementTier, earned: boolean, rank?: number) => `<badge-art emblem="${emblem}" tier="${tier}" earned="${earned ? 1 : 0}" rank="${rank ?? 0}"/>`;
export const hasBadgeToken = (text: string) => text.includes("<badge-art ");

/** Replaces every badge token in a card definition with the composed picture (a data URI image on the 64-unit icon grid). The first unlock (the hero badge) uses the 256 px picture. */
export async function withBadgeImages<T extends object>(card: T): Promise<T> {
  const json = JSON.stringify(card);
  if (!hasBadgeToken(json)) return card;
  const copy = JSON.parse(json) as Record<string, unknown>;
  const walk = async (node: unknown, size: 128 | 256): Promise<unknown> => {
    if (typeof node === "string") return hasBadgeToken(node) ? replaceTokens(node, size) : node;
    if (Array.isArray(node)) return Promise.all(node.map(item => walk(item, size)));
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(node)) out[key] = key === "unlocks" && Array.isArray(value) ? await Promise.all(value.map((item, i) => walk(item, i === 0 ? 256 : 128))) : await walk(value, size);
      return out;
    }
    return node;
  };
  return await walk(copy, 128) as T;
}
async function replaceTokens(text: string, size: 128 | 256): Promise<string> {
  const found = [...text.matchAll(TOKEN)];
  let out = text;
  for (const match of found) {
    const png = await composeBadge(match[1]!, match[2] as AchievementTier, match[3] === "1", Number(match[4]) || undefined, size);
    out = out.replace(match[0], png ? `<image x="0" y="0" width="64" height="64" href="data:image/png;base64,${png.toString("base64")}"/>` : "");
  }
  return out;
}
