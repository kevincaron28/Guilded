// GET /api/v1/companion/achievements (phone app badge album, APP_TCG option 1). The signed-in member's own
// badge cards: one per achievement in the catalogue, with the date it was earned or null while it is still
// locked. Read-only: it shows only what Guilded already stored (the website's /me/ page is what evaluates and
// records new ones), it grants nothing, and it never returns another member's data. Own data, behind the
// existing companion credential.

import type { PrismaClient } from "../generated/prisma/client.js";
import { ACHIEVEMENTS, EDITION_LABEL, GAME_LABEL, TIER_COLOR, TIER_LABEL, achievementGameVisible, isHiddenSecret, maskedText, SECRET_TAG, type AchievementDef } from "./achievements-catalogue.js";
import { storedAchievements } from "./achievements.js";
import { emblemFor } from "./badge-art.js";

type Db = Pick<PrismaClient, "member" | "guildSettings" | "memberAchievement">;
export type AlbumLang = "en" | "fr";
export interface AlbumCard {
  id: string; name: string; description: string; tier: AchievementDef["tier"]; tierLabel: string; tierColor: string;
  /** The set it belongs to: a WoW edition or the guild set. */
  set: string; rank: number | null; threshold: number; earnedAt: string | null;
  /** The painted emblem (a file name in the site's /badge-art/emblems/, without size): the app layers it over /badge-art/frames/<tier>-128.webp. Null: draw the plain medal. */
  emblem: string | null;
  /** True for a secret achievement. While it is unearned the card is a mystery: name "???", the optional hint, tier "Secret", no emblem. */
  secret?: boolean;
}
/** `total` leaves unearned secrets out; `hiddenSecrets` counts them (shown as "+N secret"). */
export interface Album { cards: AlbumCard[]; earned: number; total: number; hiddenSecrets: number }

/** Cards the app lists: PoE2 and inactive editions follow the same switches as the website, and a legacy row only shows once earned. */
export function albumCards(earned: Map<string, Date>, lang: AlbumLang): AlbumCard[] {
  return ACHIEVEMENTS
    .filter(def => achievementGameVisible(def) && (def.edition ? def.edition === "forever" : def.game === "guild") && (!def.legacy || earned.has(def.id)))
    .map((def): AlbumCard => {
      const hidden = isHiddenSecret(def, earned.has(def.id)), text = hidden ? maskedText(def, lang) : def[lang];
      return {
      id: def.id, name: text.name, description: text.description, tier: def.tier, tierLabel: hidden ? SECRET_TAG[lang] : def.secret ? `${SECRET_TAG[lang]} · ${TIER_LABEL[def.tier][lang]}` : TIER_LABEL[def.tier][lang], tierColor: TIER_COLOR[def.tier],
      set: def.edition ? `${GAME_LABEL.wow[lang]} · ${EDITION_LABEL[def.edition][lang]}` : GAME_LABEL[def.game][lang],
      rank: def.rank ?? null, threshold: def.threshold, earnedAt: earned.get(def.id)?.toISOString() ?? null, emblem: hidden ? null : emblemFor(def),
      ...(def.secret ? { secret: true } : {})
      };
    });
}

/** The album for one Discord account, merged across its Guilded servers (earliest date wins), skipping servers the website does not serve or that turned achievements off. */
export async function albumFor(db: Db, discordUserId: string, lang: AlbumLang, allows: (discordGuildId: string) => boolean): Promise<Album> {
  const rows = await db.member.findMany({ where: { discordUserId, status: "ACTIVE", isTest: false }, select: { id: true, guildId: true, guild: { select: { discordId: true } } }, take: 25 });
  const served = rows.filter(row => allows(row.guild.discordId));
  const off = new Set((await db.guildSettings.findMany({ where: { guildId: { in: served.map(row => row.guildId) }, achievementsEnabled: false }, select: { guildId: true } })).map(row => row.guildId));
  const memberIds = served.filter(row => !off.has(row.guildId)).map(row => row.id);
  const earned = memberIds.length ? await storedAchievements(db, { memberIds }) : new Map<string, Date>();
  const cards = albumCards(earned, lang);
  const hiddenSecrets = cards.filter(card => card.secret && !card.earnedAt).length;
  return { cards, earned: cards.filter(card => card.earnedAt).length, total: cards.length - hiddenSecrets, hiddenSecrets };
}
