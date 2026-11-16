import type { PrismaClient } from "../generated/prisma/client.js";
import type { Lang } from "../i18n.js";
import { t } from "../i18n.js";
import { weekStart } from "./dungeon-rules.js";
import { loadInGamePoints, mergeStandings } from "./community-ingame.js";
import { standings } from "./community-rules.js";

type Db = Pick<PrismaClient, "communitySeason" | "communityPoint" | "dungeonPointTransaction" | "duelResult" | "battlegroundReport" | "worldPvpWeek" | "member" | "guild">;

/**
 * `/dungeon player`: the member's community points (the merged board's total) with the dungeon share, this week and this season.
 * The raw dungeon ledger is not shown as separate "points": it is only the dungeon part of community points.
 */
export async function communityPointsLine(db: Db, guildId: string, member: { discordUserId: string }, lang: Lang, now = new Date()): Promise<string> {
  const week = (await loadInGamePoints(db, guildId, weekStart(now), now)).get(member.discordUserId)?.dungeons ?? 0;
  const season = await db.communitySeason.findFirst({ where: { guildId, game: "DISCORD", status: "ACTIVE" }, orderBy: { createdAt: "desc" } });
  if (!season) return t(lang, "dungeon.player.pointsWeekOnly", { week });
  const base = standings(await db.communityPoint.findMany({ where: { seasonId: season.id } }));
  const row = mergeStandings(base, await loadInGamePoints(db, guildId, season.createdAt, now)).find(r => r.userId === member.discordUserId);
  return t(lang, "dungeon.player.pointsValue", { week, total: row?.points ?? 0, season: row?.dungeons ?? 0 });
}
