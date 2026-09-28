import type { PrismaClient } from "@prisma/client";
import { guildStats, type GuildStats } from "./guild-stats.js";
import { weekStart } from "./dungeon-rules.js";

// The weekly report (posted right after the weekly reset, Tuesday 15:00 UTC, the same week the
// dungeon challenge uses): the guild's week against the one before, each raid core, the dungeon
// week, and the players of the week. Counts from data the bot already has; nothing is guessed.

export interface CoreWeek {
  name: string;
  raids: number;
  // Share of the core's main-roster places filled over its raids (present or late), or null.
  attendancePct: number | null;
  bossKills: number;
  loot: number;
  gp: number;
  // Main-roster players who were at every one of the core's raids this week.
  perfect: string[];
}

export interface DungeonWeek {
  runs: number;
  completed: number;
  // Fastest completed run per dungeon this week.
  fastest: { dungeon: string; durationSec: number; players: string[] }[];
  firsts: string[];
  records: string[];
  topPoints: { name: string; points: number }[];
}

export interface WeeklyReport {
  weekStart: Date;
  weekEnd: Date;
  guild: GuildStats;
  previous: GuildStats;
  cores: CoreWeek[];
  dungeons: DungeonWeek;
  // Most EP earned (EP awards only, not decay or corrections); ties: more raids, then the name.
  raiderOfWeek: { name: string; ep: number; raids: number } | null;
  // Most dungeon points.
  dungeonHero: { name: string; points: number } | null;
}

type Db = Pick<PrismaClient, "raid" | "lootAward" | "epgpTransaction" | "member" | "application" | "dungeonRun" | "dungeonPointTransaction">;

const PRESENT = new Set(["PRESENT", "LATE"]);

// The week that just ended when `now` is past a reset: [previous reset, last reset).
export function reportWeek(now: Date): { start: Date; end: Date } {
  const end = weekStart(now);
  return { start: new Date(end.getTime() - 7 * 86_400_000), end };
}

// Due once per weekly reset: when the last report was posted before the most recent reset.
export function isWeeklyReportDueAfterReset(input: { enabled: boolean; lastAt: Date | null; now: Date }): boolean {
  if (!input.enabled) return false;
  return !input.lastAt || input.lastAt.getTime() < weekStart(input.now).getTime();
}

export async function weeklyReport(database: Db, guildId: string, now = new Date()): Promise<WeeklyReport> {
  const { start, end } = reportWeek(now);
  const before = new Date(start.getTime() - 7 * 86_400_000);
  const window = { gte: start, lt: end };
  const [guild, previous, coreRaids, epRows, runs, pointRows] = await Promise.all([
    guildStats(database, guildId, start, end),
    guildStats(database, guildId, before, start),
    database.raid.findMany({
      where: { guildId, status: "COMPLETED", endedAt: window, coreId: { not: null }, isTest: false },
      include: {
        bosses: true, attendance: { include: { member: true } },
        core: { select: { id: true, name: true, members: { select: { memberId: true, bench: true, trial: true, member: { select: { displayName: true } } } } } }
      }
    }),
    database.epgpTransaction.findMany({ where: { guildId, type: "EP_AWARD", createdAt: window }, select: { memberId: true, epAmount: true, member: { select: { displayName: true } } } }),
    database.dungeonRun.findMany({ where: { guildId, valid: true, endedAt: window }, include: { players: true } }),
    database.dungeonPointTransaction.findMany({ where: { guildId, createdAt: window }, select: { memberId: true, amount: true, source: true, reason: true, member: { select: { displayName: true } } } })
  ]);

  // Each raid core.
  const cores = new Map<string, CoreWeek & { raidIds: string[]; places: number; filled: number; seen: Map<string, number>; mains: Map<string, string> }>();
  for (const raid of coreRaids) {
    if (!raid.core) continue;
    const entry = cores.get(raid.core.id) ?? {
      name: raid.core.name, raids: 0, attendancePct: null, bossKills: 0, loot: 0, gp: 0, perfect: [],
      raidIds: [], places: 0, filled: 0, seen: new Map<string, number>(),
      mains: new Map(raid.core.members.filter((m) => !m.bench && !m.trial).map((m) => [m.memberId, m.member.displayName]))
    };
    entry.raids++;
    entry.raidIds.push(raid.id);
    entry.bossKills += raid.bosses.filter((boss) => boss.status === "KILLED").length;
    entry.places += entry.mains.size;
    for (const row of raid.attendance) {
      if (!PRESENT.has(row.status)) continue;
      if (entry.mains.has(row.memberId)) entry.filled++;
      entry.seen.set(row.memberId, (entry.seen.get(row.memberId) ?? 0) + 1);
    }
    cores.set(raid.core.id, entry);
  }
  const coreRaidIds = [...cores.values()].flatMap((core) => core.raidIds);
  const coreLoot = coreRaidIds.length
    ? await database.lootAward.findMany({ where: { guildId, raidId: { in: coreRaidIds } }, select: { raidId: true, amount: true } })
    : [];
  const coreWeeks: CoreWeek[] = [...cores.values()].map((core) => {
    const loot = coreLoot.filter((row) => row.raidId && core.raidIds.includes(row.raidId));
    return {
      name: core.name, raids: core.raids, bossKills: core.bossKills,
      attendancePct: core.places > 0 ? Math.round((core.filled / core.places) * 100) : null,
      loot: loot.length, gp: loot.reduce((sum, row) => sum + row.amount, 0),
      perfect: [...core.mains.entries()].filter(([id]) => (core.seen.get(id) ?? 0) >= core.raids).map(([, name]) => name).sort((a, b) => a.localeCompare(b))
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  // Raider of the week: most EP earned.
  const raidsOf = new Map<string, number>();
  for (const name of guild.topAttendance) raidsOf.set(name.name, name.raids);
  const ep = new Map<string, { name: string; ep: number }>();
  for (const row of epRows) {
    const entry = ep.get(row.memberId) ?? { name: row.member.displayName, ep: 0 };
    entry.ep += row.epAmount;
    ep.set(row.memberId, entry);
  }
  const bestEp = [...ep.values()].filter((row) => row.ep > 0)
    .map((row) => ({ ...row, raids: guild.attendanceByName?.get(row.name) ?? raidsOf.get(row.name) ?? 0 }))
    .sort((a, b) => b.ep - a.ep || b.raids - a.raids || a.name.localeCompare(b.name))[0] ?? null;

  // The dungeon week.
  const completed = runs.filter((run) => run.state === "COMPLETED" && run.durationSec);
  const fastest = new Map<string, { dungeon: string; durationSec: number; players: string[] }>();
  for (const run of completed) {
    const best = fastest.get(run.dungeonName);
    if (!best || (run.durationSec ?? 0) < best.durationSec) {
      fastest.set(run.dungeonName, { dungeon: run.dungeonName, durationSec: run.durationSec ?? 0, players: run.players.map((p) => p.character).sort() });
    }
  }
  const points = new Map<string, { name: string; points: number }>();
  const firsts: string[] = [];
  const records: string[] = [];
  const dungeonOf = (reason: string) => reason.split(" — ").pop() ?? "";
  for (const row of pointRows) {
    const entry = points.get(row.memberId) ?? { name: row.member.displayName, points: 0 };
    entry.points += row.amount;
    points.set(row.memberId, entry);
    if (row.source === "rule:firstCompletion") firsts.push(`${row.member.displayName} (${dungeonOf(row.reason)})`);
    if (row.source === "rule:personalRecord") records.push(`${row.member.displayName} (${dungeonOf(row.reason)})`);
    if (row.source === "rule:guildRecord") records.push(`🏅 ${row.member.displayName} (${dungeonOf(row.reason)}, guild record)`);
  }
  const topPoints = [...points.values()].filter((row) => row.points > 0).sort((a, b) => b.points - a.points || a.name.localeCompare(b.name)).slice(0, 3);

  return {
    weekStart: start, weekEnd: end, guild, previous, cores: coreWeeks,
    dungeons: {
      runs: runs.length, completed: completed.length,
      fastest: [...fastest.values()].sort((a, b) => a.dungeon.localeCompare(b.dungeon)),
      firsts: [...new Set(firsts)], records: [...new Set(records)], topPoints
    },
    raiderOfWeek: bestEp,
    dungeonHero: topPoints[0] ?? null
  };
}
