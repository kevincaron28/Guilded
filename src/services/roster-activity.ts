import type { PrismaClient } from "../generated/prisma/client.js";
import type { RosterCharacter, RosterSnapshot } from "./roster-dashboard-store.js";

const DAY = 86_400_000;
// Uses existing participation evidence only. Import timestamps are not activity.
// Each member is counted once even if several characters attended a run.
export async function attachRosterActivity(database: PrismaClient, snapshot: RosterSnapshot, now = new Date()): Promise<RosterSnapshot> {
  const ids = [...new Set(snapshot.characters.flatMap(row => row.memberId ? [row.memberId] : []))];
  const membersIn = async (days: number) => {
    if (!ids.length) return new Set<string>();
    const range = { gte: new Date(now.getTime() - days * DAY), lte: now };
    const member = { guildId: snapshot.guild.id, status: "ACTIVE" as const, isTest: false };
    const [raids, dungeons] = await Promise.all([
      database.raidAttendance.groupBy({ by: ["memberId"], where: { memberId: { in: ids }, member,
        status: { in: ["PRESENT", "LATE"] }, raid: { guildId: snapshot.guild.id, isTest: false, status: "COMPLETED", startedAt: range, endedAt: { lte: now } } } }),
      database.dungeonRunPlayer.groupBy({ by: ["memberId"], where: { memberId: { in: ids }, member, inGuild: true,
        run: { guildId: snapshot.guild.id, state: "COMPLETED", valid: true, endedAt: range } } })
    ]);
    return new Set([...raids, ...dungeons].flatMap(row => row.memberId ? [row.memberId] : []));
  };
  const [seven, thirty] = await Promise.all([membersIn(7), membersIn(30)]);
  return { ...snapshot, activityAsOf: now, characters: snapshot.characters.map(row => ({ ...row,
    participation: row.memberId ? { seven: seven.has(row.memberId), thirty: thirty.has(row.memberId) } : null
  })) };
}

export function participationCounts(rows: RosterCharacter[]) {
  const linked = new Set<string>(), seven = new Set<string>(), thirty = new Set<string>();
  for (const row of rows) {
    if (!row.memberId || !row.participation) continue;
    linked.add(row.memberId);
    if (row.participation.seven) seven.add(row.memberId);
    if (row.participation.thirty) thirty.add(row.memberId);
  }
  return { linked: linked.size, seven: seven.size, thirty: thirty.size };
}
