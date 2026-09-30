import type { PrismaClient } from "@prisma/client";
import { leaderboard } from "./dungeon-stats.js";
import { finalRows } from "./season-snapshot.js";
export { finalRows } from "./season-snapshot.js";

export async function seasonRows(database: PrismaClient, guildId: string, season: { id: string; finalStandings: unknown }, limit = 10) {
  const final = finalRows(season.finalStandings);
  return final ? final.slice(0, limit) : leaderboard(database, guildId, "season", null, limit, new Date(), season.id);
}

export async function seasonArchive(database: PrismaClient, guildId: string, page = 1, hall = false) {
  const where = { guildId, ...(hall ? { status: "ENDED" } : {}) };
  const count = await database.dungeonSeason.count({ where });
  const pages = Math.max(1, Math.ceil(count / 10));
  const current = Math.max(1, Math.min(page, pages));
  const seasons = await database.dungeonSeason.findMany({ where, orderBy: [{ startsAt: "desc" }, { id: "desc" }], skip: (current - 1) * 10, take: 10 });
  const entries = [];
  for (const season of seasons) {
    if (!hall) {
      entries.push(`**${season.name}** · ${season.status === "ACTIVE" ? "Current / Actuelle" : "Archived / Passée"} · <t:${Math.floor(season.startsAt.getTime() / 1000)}:d>\n\`/dungeon leaderboard season:${season.id}\``);
      continue;
    }
    const final = finalRows(season.finalStandings);
    // Older seasons have existing awarded champions, never invent a published result.
    const awards = final === null ? await database.dungeonAchievement.findMany({ where: { guildId, seasonId: season.id, key: `seasonChampion:${season.id}` }, include: { member: { select: { displayName: true } } } }) : [];
    const winners = final ? final.filter(row => row.points > 0 && row.points === final[0]?.points).map(row => `${row.name} (${row.points})`) : awards.map(row => row.member.displayName);
    entries.push(`**${season.name}**\n${(winners.join(", ") || "No awarded champion / Aucun champion").slice(0, 280)}${final === null ? " · legacy awards / anciens prix" : ""}`);
  }
  return { current, pages, text: entries.join("\n\n") || "No seasons yet / Aucune saison." };
}
