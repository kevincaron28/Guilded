import type { PrismaClient } from "../generated/prisma/client.js";
import { GENERATED_ACHIEVEMENT_PREFIX, achievementById, setGeneratedAchievements, type AchievementDef } from "./achievements-catalogue.js";

// WoW Forever's in-game achievements as generated badges (docs/plans/FOREVER_ACHIEVEMENTS.md). Members' addons report the ones their
// characters earned (milestone kind "ach", ref `ach:<game id>`); the names come with the report and are kept in GameAchievement, so
// there is no hand-written list. This module loads those names into the catalogue's registry and finds what a member earned.
// Nothing here posts or awards anything; the Discord announcement of a new one follows the guild's achievement-announcement switch.

const REFRESH_MS = 60_000;
let loadedAt = 0;
/** Forgets the loaded names (tests, and after an import that added some). */
export const forgetGeneratedAchievements = () => { loadedAt = 0; };

/** Loads the generated catalogue (at most once a minute; a database without the table leaves the registry as it was). */
export async function loadGeneratedAchievements(source: object, now = Date.now()): Promise<void> {
  const db = source as Partial<Pick<PrismaClient, "gameAchievement">>;
  if (typeof db.gameAchievement?.findMany !== "function") return;
  if (loadedAt && now - loadedAt < REFRESH_MS) return;
  const rows = await db.gameAchievement.findMany({ where: { gameEdition: "forever" }, select: { achievementId: true, name: true, description: true, categoryName: true, points: true }, orderBy: { achievementId: "asc" }, take: 5000 });
  setGeneratedAchievements(rows);
  loadedAt = now;
}

/** The generated achievements this member's addon recorded (earliest date per id), with the catalogue row each one resolves to. */
export async function earnedGameAchievements(source: object, guildId: string, memberId: string): Promise<{ def: AchievementDef; earnedAt: Date }[]> {
  await loadGeneratedAchievements(source);
  const db = source as Partial<Pick<PrismaClient, "memberMilestone">>;
  if (typeof db.memberMilestone?.findMany !== "function") return [];
  const rows = await db.memberMilestone.findMany({ where: { guildId, memberId, kind: "ach" }, select: { ref: true, reachedAt: true }, orderBy: { reachedAt: "asc" }, take: 3000 });
  const found = new Map<string, { def: AchievementDef; earnedAt: Date }>();
  for (const row of rows) {
    const id = /^ach:(\d{1,9})$/.exec(row.ref)?.[1];
    const def = id ? achievementById(`${GENERATED_ACHIEVEMENT_PREFIX}${id}`) : undefined;
    if (def && !found.has(def.id)) found.set(def.id, { def, earnedAt: row.reachedAt });
  }
  return [...found.values()];
}
