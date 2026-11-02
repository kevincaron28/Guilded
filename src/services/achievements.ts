import type { PrismaClient } from "../generated/prisma/client.js";
import { ACHIEVEMENTS, wowLevelCap, type AchievementDef, type AchievementMetric } from "./achievements-catalogue.js";

// Evaluates the catalogue against recorded data and stores what a member newly earned. Viewing is the only
// trigger: nothing here posts a Discord message, sends a DM or awards points. (A guild-opt-in announcement
// would be a separate switch; see docs/ACHIEVEMENTS.md.)

/** Everything the catalogue measures, for one member in one guild. Dates are ascending. */
export interface AchievementFacts {
  highestWowLevel: number;
  /** Per synced character: the level and the cap of its edition. */
  charactersAtCap: number;
  dungeonRuns: Date[];
  /** First completion of each distinct dungeon. */
  dungeonVariety: Date[];
  highestProfessionSkill: number;
  raidsAttended: Date[];
  raidClears: Date[];
  activeDays: Date[];
  poeLevels: { level: number; reachedAt: Date }[];
  poeMaps: Date[];
  /** Discord activity and scoring totals (no history, so these earn on first sight). */
  messagesSent: number;
  reactionsGiven: number;
  reactionsReceived: number;
  voiceHours: number;
  communityPoints: number;
  epEarned: number;
}

export interface AchievementResult { def: AchievementDef; value: number; earned: boolean; earnedAt: Date | null }

export const emptyFacts = (): AchievementFacts => ({ highestWowLevel: 0, charactersAtCap: 0, dungeonRuns: [], dungeonVariety: [], highestProfessionSkill: 0, raidsAttended: [], raidClears: [], activeDays: [], poeLevels: [], poeMaps: [], messagesSent: 0, reactionsGiven: 0, reactionsReceived: 0, voiceHours: 0, communityPoints: 0, epEarned: 0 });

function measure(metric: AchievementMetric, threshold: number, facts: AchievementFacts): { value: number; at: Date | null } {
  const counted = (dates: Date[]) => ({ value: dates.length, at: dates[threshold - 1] ?? null });
  switch (metric) {
    // Levels and the level cap keep no history, so the date is when the sync was first seen at it (null = now).
    case "wowLevel": return { value: facts.highestWowLevel, at: null };
    case "wowMaxLevel": return { value: facts.charactersAtCap, at: null };
    case "dungeonRuns": return counted(facts.dungeonRuns);
    case "dungeonVariety": return counted(facts.dungeonVariety);
    case "professionSkill": return { value: facts.highestProfessionSkill, at: null };
    case "raidsAttended": return counted(facts.raidsAttended);
    case "raidClears": return counted(facts.raidClears);
    case "activeDays": return counted(facts.activeDays);
    case "poeMaps": return counted(facts.poeMaps);
    // Totals keep no per-event history here, so the date is when the total was first seen at the threshold (null = now).
    case "messagesSent": return { value: facts.messagesSent, at: null };
    case "reactionsGiven": return { value: facts.reactionsGiven, at: null };
    case "reactionsReceived": return { value: facts.reactionsReceived, at: null };
    case "voiceHours": return { value: facts.voiceHours, at: null };
    case "communityPoints": return { value: facts.communityPoints, at: null };
    case "epEarned": return { value: facts.epEarned, at: null };
    case "poeLevel": {
      const reached = facts.poeLevels.filter(row => row.level >= threshold).sort((a, b) => a.reachedAt.getTime() - b.reachedAt.getTime())[0];
      return { value: facts.poeLevels.reduce((best, row) => Math.max(best, row.level), 0), at: reached?.reachedAt ?? null };
    }
  }
}

/** Pure: which achievements these facts earn, with the date the data gives. */
export function evaluateAchievements(facts: AchievementFacts, now: Date): AchievementResult[] {
  return ACHIEVEMENTS.map(def => {
    const { value, at } = measure(def.metric, def.threshold, facts);
    const earned = value >= def.threshold;
    // A date from the future (a skewed clock) is clamped; no history means "first seen now".
    const earnedAt = earned ? (at && at.getTime() <= now.getTime() ? at : now) : null;
    return { def, value, earned, earnedAt };
  });
}

type Db = Pick<PrismaClient, "character" | "professionSkill" | "dungeonRunPlayer" | "raidAttendance" | "communityParticipationDay" | "poeLevelReached" | "poeMapVisit" | "communityPoint" | "epgpTransaction" | "memberActivityTotal" | "member" | "memberAchievement">;

const dedupe = <T>(rows: T[], key: (row: T) => string) => { const seen = new Set<string>(); return rows.filter(row => { const k = key(row); if (seen.has(k)) return false; seen.add(k); return true; }); };

/** Reads the recorded data. Each query is bounded by the largest threshold that uses it. */
export async function gatherAchievementFacts(db: Db, guildId: string, memberId: string): Promise<AchievementFacts> {
  const member = await db.member.findFirst({ where: { id: memberId, guildId }, select: { discordUserId: true } });
  if (!member) return emptyFacts();
  const max = (metric: AchievementMetric) => Math.max(...ACHIEVEMENTS.filter(row => row.metric === metric).map(row => row.threshold));
  const [characters, skills, runs, attendance, days, levels, visits, counter, points, given, ep] = await Promise.all([
    db.character.findMany({ where: { memberId, guildId }, select: { level: true, gameEdition: true } }),
    db.professionSkill.findMany({ where: { character: { memberId, guildId } }, select: { skillLevel: true }, orderBy: { skillLevel: "desc" }, take: 1 }),
    db.dungeonRunPlayer.findMany({ where: { memberId, run: { guildId, valid: true, state: "COMPLETED" } }, select: { runId: true, run: { select: { instanceId: true, endedAt: true, startedAt: true, createdAt: true } } }, take: 1000 }),
    db.raidAttendance.findMany({ where: { memberId, status: { in: ["PRESENT", "LATE", "BENCHED"] }, raid: { guildId, status: "COMPLETED", isTest: false } },
      select: { raidId: true, raid: { select: { endedAt: true, scheduledAt: true, bosses: { select: { status: true } } } } }, take: 1000 }),
    db.communityParticipationDay.findMany({ where: { userId: member.discordUserId, season: { guildId }, OR: [{ messages: { gt: 0 } }, { reactions: { gt: 0 } }, { voiceMs: { gt: 0 } }] }, select: { day: true, messages: true, reactions: true, voiceMs: true }, orderBy: { day: "asc" }, take: 2000 }),
    db.poeLevelReached.findMany({ where: { guildId, memberId }, select: { level: true, reachedAt: true }, take: 2000 }),
    db.poeMapVisit.findMany({ where: { guildId, memberId }, select: { instanceRef: true, runRef: true, startedAt: true }, orderBy: { startedAt: "asc" }, take: Math.max(2000, max("poeMaps") * 4) }),
    db.memberActivityTotal.findUnique({ where: { guildId_userId: { guildId, userId: member.discordUserId } }, select: { messages: true, reactionsGiven: true, reactionsReceived: true, voiceSeconds: true } }),
    // Community points: awards minus reversals across the guild's seasons (the same sum the leaderboard uses).
    db.communityPoint.aggregate({ where: { userId: member.discordUserId, kind: { in: ["AWARD", "REVERSAL"] }, season: { guildId } }, _sum: { amount: true } }),
    // Reactions this member gave that the season participation record counted (the reactor is the point's actor).
    db.communityPoint.count({ where: { actorId: member.discordUserId, kind: "AWARD", reference: { startsWith: "participation:reaction:" }, season: { guildId } } }),
    db.epgpTransaction.aggregate({ where: { guildId, memberId, type: "EP_AWARD", epAmount: { gt: 0 } }, _sum: { epAmount: true } })
  ]);
  // Season participation is a lower bound (capped, only in tracked channels); the counter is the full total from
  // when counting started. Taking the larger keeps earlier tracked activity counted.
  const seasonSum = (field: "messages" | "reactions" | "voiceMs") => days.reduce((sum, row) => sum + (row[field] ?? 0), 0);
  const byDate = (a: Date, b: Date) => a.getTime() - b.getTime();
  const raidRows = attendance.map(row => ({ id: row.raidId, at: row.raid.endedAt ?? row.raid.scheduledAt, cleared: row.raid.bosses.length > 0 && row.raid.bosses.every(boss => boss.status === "KILLED") }));
  const runDated = dedupe(runs, row => row.runId).map(row => ({ ...row, at: row.run.endedAt ?? row.run.startedAt ?? row.run.createdAt })).sort((x, y) => byDate(x.at, y.at));
  const runDates = runDated.map(row => row.at);
  return {
    highestWowLevel: characters.reduce((best, row) => Math.max(best, row.level ?? 0), 0),
    charactersAtCap: characters.filter(row => (row.level ?? 0) >= wowLevelCap(row.gameEdition)).length,
    dungeonRuns: runDates,
    dungeonVariety: dedupe(runDated, row => String(row.run.instanceId)).map(row => row.at),
    highestProfessionSkill: skills[0]?.skillLevel ?? 0,
    raidsAttended: raidRows.map(row => row.at).sort(byDate),
    raidClears: raidRows.filter(row => row.cleared).map(row => row.at).sort(byDate),
    // Day strings are YYYY-MM-DD; the same day in two seasons counts once.
    activeDays: dedupe(days, row => row.day).map(row => new Date(`${row.day}T12:00:00Z`)).filter(date => Number.isFinite(date.getTime())),
    poeLevels: levels,
    // A map entered through several portals is one map; visits from older companions have no instance and count one each.
    poeMaps: dedupe(visits, row => row.instanceRef ?? row.runRef).map(row => row.startedAt).sort(byDate),
    messagesSent: Math.max(counter?.messages ?? 0, seasonSum("messages")),
    reactionsGiven: Math.max(counter?.reactionsGiven ?? 0, given),
    reactionsReceived: Math.max(counter?.reactionsReceived ?? 0, seasonSum("reactions")),
    voiceHours: Math.floor(Math.max(counter?.voiceSeconds ?? 0, seasonSum("voiceMs") / 1000) / 3600),
    communityPoints: Math.max(0, points._sum.amount ?? 0),
    epEarned: Math.max(0, ep._sum.epAmount ?? 0)
  };
}

export interface MemberAchievementView {
  results: AchievementResult[];
  /** Ids stored by this call, for "new!" marks. */
  newlyEarned: string[];
}

/**
 * Evaluates one member and stores what they newly earned. Idempotent: the unique key and skipDuplicates
 * make repeats, races and concurrent views safe, and an earned row is never changed or removed.
 */
export async function syncMemberAchievements(db: Db, guildId: string, memberId: string, now = new Date()): Promise<MemberAchievementView> {
  const results = evaluateAchievements(await gatherAchievementFacts(db, guildId, memberId), now);
  const stored = await db.memberAchievement.findMany({ where: { guildId, memberId }, select: { key: true, earnedAt: true, value: true } });
  const have = new Map(stored.map(row => [row.key, row]));
  const fresh = results.filter(row => row.earned && !have.has(row.def.id));
  if (fresh.length) {
    const created = await db.memberAchievement.createMany({ data: fresh.map(row => ({ guildId, memberId, key: row.def.id, earnedAt: row.earnedAt!, value: row.value })), skipDuplicates: true });
    if (created.count !== fresh.length) {
      // Another view stored some of them first; re-read so earnedAt is what is actually stored.
      for (const row of await db.memberAchievement.findMany({ where: { guildId, memberId }, select: { key: true, earnedAt: true, value: true } })) have.set(row.key, row);
    } else for (const row of fresh) have.set(row.def.id, { key: row.def.id, earnedAt: row.earnedAt!, value: row.value });
  }
  // What is stored wins over a fresh evaluation: an achievement stays earned even if the data later shrinks.
  const merged = results.map(row => {
    const kept = have.get(row.def.id);
    return kept ? { ...row, earned: true, earnedAt: kept.earnedAt, value: Math.max(row.value, kept.value) } : row;
  });
  return { results: merged, newlyEarned: fresh.map(row => row.def.id) };
}

/** Stored rows only (no evaluation), for the public website. Earliest date wins across a member's guilds. */
export async function storedAchievements(db: Pick<PrismaClient, "memberAchievement">, where: { memberId?: string; memberIds?: string[]; guildIds?: string[] }): Promise<Map<string, Date>> {
  const rows = await db.memberAchievement.findMany({
    where: { ...(where.memberId ? { memberId: where.memberId } : {}), ...(where.memberIds ? { memberId: { in: where.memberIds } } : {}), ...(where.guildIds ? { guildId: { in: where.guildIds } } : {}) },
    select: { key: true, earnedAt: true }, take: 2000
  });
  const earned = new Map<string, Date>();
  for (const row of rows) { const prev = earned.get(row.key); if (!prev || row.earnedAt < prev) earned.set(row.key, row.earnedAt); }
  return earned;
}
