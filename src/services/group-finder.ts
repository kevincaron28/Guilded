import type { Lang } from "../i18n.js";
import type { GroupKind } from "./dungeon-group.js";

// One group finder for dungeons and PvP (9.1). The pinned "post a group" button asks the activity first; every post lands in
// the one finder channel with the activity on its card. A server with no finder channel (or whose officers switched the
// merge off) keeps posting PvP groups in its pvp-groups channel. Pure rules; the Discord side is commands/dungeon-group.ts.

export type FinderActivity = "DUNGEON" | "BATTLEGROUND" | "ARENA" | "WORLDPVP";
export interface ActivityInfo { id: FinderActivity; kind: GroupKind; /** Stored on the group (kind PVP only). */ activity: "battleground" | "arena" | null; emoji: string; size: number; en: string; fr: string; hintEn: string; hintFr: string }

export const FINDER_ACTIVITIES: Record<FinderActivity, ActivityInfo> = {
  DUNGEON: { id: "DUNGEON", kind: "DUNGEON", activity: null, emoji: "🏰", size: 5, en: "Dungeon", fr: "Donjon", hintEn: "Tank, healer and 3 DPS", hintFr: "Tank, soigneur et 3 DPS" },
  BATTLEGROUND: { id: "BATTLEGROUND", kind: "PVP", activity: "battleground", emoji: "⚔️", size: 10, en: "Battleground", fr: "Champ de bataille", hintEn: "Any role, up to 40 players", hintFr: "Tout rôle, jusqu'à 40 joueurs" },
  ARENA: { id: "ARENA", kind: "PVP", activity: "arena", emoji: "🥊", size: 5, en: "Arena", fr: "Arène", hintEn: "Any role, 2 to 40 players (default 5)", hintFr: "Tout rôle, 2 à 40 joueurs (5 par défaut)" },
  WORLDPVP: { id: "WORLDPVP", kind: "WORLDPVP", activity: null, emoji: "🏴", size: 20, en: "World PvP", fr: "JcJ en monde ouvert", hintEn: "Any role, up to 40 players", hintFr: "Tout rôle, jusqu'à 40 joueurs" }
};
export const FINDER_ORDER: readonly FinderActivity[] = ["DUNGEON", "BATTLEGROUND", "ARENA", "WORLDPVP"];

/** Pure: a form id suffix (an activity, or an old kind such as "PVP") to its activity; unknown values mean a dungeon. */
export function activityFromId(value: string | null | undefined): FinderActivity {
  const key = (value ?? "").toUpperCase();
  if (key in FINDER_ACTIVITIES) return key as FinderActivity;
  return key === "PVP" ? "BATTLEGROUND" : "DUNGEON";
}

/** Pure: the activity of a stored group. */
export function activityOfGroup(kind: string, activity: string | null | undefined): FinderActivity | null {
  if (kind === "DUNGEON") return "DUNGEON";
  if (kind === "WORLDPVP") return "WORLDPVP";
  if (kind === "PVP") return activity === "arena" ? "ARENA" : "BATTLEGROUND";
  return null;
}

export const isPvpKind = (kind: string) => kind === "PVP" || kind === "WORLDPVP";

export const activityLabel = (id: FinderActivity, lang: Lang) => lang === "fr" ? FINDER_ACTIVITIES[id].fr : FINDER_ACTIVITIES[id].en;

/**
 * Pure: where a new group of this activity is posted. With the merge on (the default) and a finder channel, everything goes
 * to the finder. Otherwise dungeons use the finder channel (if any) and PvP groups the pvp-groups channel (if any).
 */
export function finderChannelFor(settings: { unifiedGroupFinder?: boolean | null; dungeonSignupChannelId?: string | null; bgGroupsChannelId?: string | null } | null, activity: FinderActivity): string | null {
  if (!settings) return null;
  const finder = settings.dungeonSignupChannelId ?? null, pvp = settings.bgGroupsChannelId ?? null;
  if (activity === "DUNGEON") return finder;
  return settings.unifiedGroupFinder !== false && finder ? finder : pvp;
}

/** Pure: the merge applies to this server (on, with a finder channel): `/setup` then stops creating pvp-groups. */
export const finderIsMerged = (settings: { unifiedGroupFinder?: boolean | null; dungeonSignupChannelId?: string | null } | null) =>
  Boolean(settings && settings.unifiedGroupFinder !== false && settings.dungeonSignupChannelId);

/** The activities the pinned flow offers: all four when merged, else dungeons only (today's one-click flow). */
export const offeredActivities = (merged: boolean): readonly FinderActivity[] => merged ? FINDER_ORDER : ["DUNGEON"];
