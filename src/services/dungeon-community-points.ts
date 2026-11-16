import type { PrismaClient } from "../generated/prisma/client.js";
import type { Lang } from "../i18n.js";
import { t } from "../i18n.js";
import { weekStart } from "./dungeon-rules.js";
import { dungeonShare, loadInGamePoints, mergeStandings, scoring, scoringForSeason, seasonInGamePoints } from "./community-ingame.js";
import { standings } from "./community-rules.js";

type Db = Pick<PrismaClient, "communitySeason" | "communityPoint" | "dungeonPointTransaction" | "duelResult" | "battlegroundReport" | "worldPvpWeek" | "member" | "guild">;

/**
 * `/dungeon player`: the member's community points (the merged board's total) with the dungeon share, this week and this season.
 * The raw dungeon ledger is not shown as separate "points": it is only the dungeon part of community points.
 */
export async function communityPointsLine(db: Db, guildId: string, member: { discordUserId: string }, lang: Lang, now = new Date()): Promise<string> {
  const season = await db.communitySeason.findFirst({ where: { guildId, game: "DISCORD", status: "ACTIVE" }, orderBy: { createdAt: "desc" } });
  // The same scoring the community leaderboard uses for this season (legacy seasons keep their old divisor and no weekly bound).
  const week = (await loadInGamePoints(db, guildId, weekStart(now), now, scoringForSeason(season))).get(member.discordUserId)?.dungeons ?? 0;
  if (!season) return t(lang, "dungeon.player.pointsWeekOnly", { week });
  const base = standings(await db.communityPoint.findMany({ where: { seasonId: season.id } }));
  const row = mergeStandings(base, await seasonInGamePoints(db, guildId, season, now)).find(r => r.userId === member.discordUserId);
  return t(lang, "dungeon.player.pointsValue", { week, total: row?.points ?? 0, season: row?.dungeons ?? 0 });
}

/**
 * What an officer's dungeon-point award really does to community points: the member's dungeon week points (the same rows the board
 * reads) before and after, each turned into its community share with the board's own scoring and weekly bound.
 */
export async function awardEffect(db: Db, guildId: string, memberId: string, amount: number, now = new Date()): Promise<{ before: number; after: number; delta: number }> {
  const season = await db.communitySeason.findFirst({ where: { guildId, game: "DISCORD", status: "ACTIVE" }, orderBy: { createdAt: "desc" } });
  const config = season ? scoringForSeason(season) : scoring();
  const range = { gte: weekStart(now), lte: now };
  const rows = await db.dungeonPointTransaction.findMany({ where: { guildId, memberId, OR: [{ run: { endedAt: range } }, { runId: null, createdAt: range }] }, select: { amount: true }, take: 100_000 });
  const raw = rows.reduce((sum, row) => sum + row.amount, 0);
  const before = dungeonShare(raw, config), after = dungeonShare(raw + amount, config);
  return { before, after, delta: after - before };
}
