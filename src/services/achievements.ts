import type { PrismaClient } from "../generated/prisma/client.js";
import { ACHIEVEMENTS, RETIRED_ACHIEVEMENT_IDS, wowLevelCap, type AchievementDef, type AchievementMetric } from "./achievements-catalogue.js";
import { earnedGameAchievements } from "./game-achievements.js";
import { anniversariesAttended, serverCreatedAt } from "./server-anniversary.js";

// Evaluates the catalogue against recorded data and stores what a member newly earned. Viewing is the only
// trigger: nothing here posts a Discord message, sends a DM or awards points. (A guild-opt-in announcement
// would be a separate switch; see docs/ACHIEVEMENTS.md.)

/** Everything the catalogue measures, for one member in one guild. Dates are ascending. */
export interface AchievementFacts {
  highestWowLevel: number;
  /** Per synced character: the level and the cap of its edition. */
  charactersAtCap: number;
  /** Per WoW edition: from the characters of that edition only. */
  editions: Record<string, { highestLevel: number; atCap: number; profession: number; mastered?: number }>;
  dungeonRuns: Date[];
  /** First completion of each distinct dungeon. */
  dungeonVariety: Date[];
  highestProfessionSkill: number;
  raidsAttended: Date[];
  raidClears: Date[];
  activeDays: Date[];
  poeLevels: { level: number; reachedAt: Date }[];
  poeMaps: Date[];
  /** When each MVP-of-the-week award was recorded. */
  mvpWeeks: Date[];
  /** Server anniversaries that fell while the member was on the server (the dates of those anniversaries). */
  serverAnniversaries: Date[];
  /** Discord activity and scoring totals (no history, so these earn on first sight). */
  messagesSent: number;
  reactionsGiven: number;
  reactionsReceived: number;
  voiceHours: number;
  communityPoints: number;
  epEarned: number;
  /** Lifetime honorable kills the member's own addon reported, and duels won against guildmates. */
  honorableKills: number;
  duelWins: number;
  duelStreak: number;
  beatTopDuelist: number;
  /** Professions where the member was the guild's first to 300, recipes only the member knows, and crafts done for others (dated). */
  professionFirsts: number;
  rareRecipes: number;
  craftsDone: Date[];
}

export interface AchievementResult { def: AchievementDef; value: number; earned: boolean; earnedAt: Date | null }

export const emptyFacts = (): AchievementFacts => ({ highestWowLevel: 0, charactersAtCap: 0, editions: {}, dungeonRuns: [], dungeonVariety: [], highestProfessionSkill: 0, raidsAttended: [], raidClears: [], activeDays: [], poeLevels: [], poeMaps: [], mvpWeeks: [], serverAnniversaries: [], messagesSent: 0, reactionsGiven: 0, reactionsReceived: 0, voiceHours: 0, communityPoints: 0, epEarned: 0, honorableKills: 0, duelWins: 0, duelStreak: 0, beatTopDuelist: 0, professionFirsts: 0, rareRecipes: 0, craftsDone: [] });

function measure(def: AchievementDef, facts: AchievementFacts): { value: number; at: Date | null } {
  const { metric, threshold } = def;
  const edition = facts.editions[def.edition ?? ""];
  const counted = (dates: Date[]) => ({ value: dates.length, at: dates[threshold - 1] ?? null });
  switch (metric) {
    // Levels and the level cap keep no history, so the date is when the sync was first seen at it (null = now).
    case "wowLevel": return { value: facts.highestWowLevel, at: null };
    case "wowMaxLevel": return { value: facts.charactersAtCap, at: null };
    case "wowEditionLevel": return { value: edition?.highestLevel ?? 0, at: null };
    case "wowEditionCap": return { value: edition?.atCap ?? 0, at: null };
    case "wowEditionProfession": return { value: edition?.profession ?? 0, at: null };
    case "professionsMastered": return { value: edition?.mastered ?? 0, at: null };
    case "professionFirsts": return { value: facts.professionFirsts, at: null };
    case "rareRecipes": return { value: facts.rareRecipes, at: null };
    case "craftsDone": return counted(facts.craftsDone);
    case "dungeonRuns": return counted(facts.dungeonRuns);
    case "dungeonVariety": return counted(facts.dungeonVariety);
    case "professionSkill": return { value: facts.highestProfessionSkill, at: null };
    case "raidsAttended": return counted(facts.raidsAttended);
    case "raidClears": return counted(facts.raidClears);
    case "activeDays": return counted(facts.activeDays);
    case "poeMaps": return counted(facts.poeMaps);
    case "mvpWeeks": return counted(facts.mvpWeeks);
    case "serverAnniversaries": return counted(facts.serverAnniversaries);
    // Totals keep no per-event history here, so the date is when the total was first seen at the threshold (null = now).
    case "messagesSent": return { value: facts.messagesSent, at: null };
    case "reactionsGiven": return { value: facts.reactionsGiven, at: null };
    case "reactionsReceived": return { value: facts.reactionsReceived, at: null };
    case "voiceHours": return { value: facts.voiceHours, at: null };
    case "communityPoints": return { value: facts.communityPoints, at: null };
    case "epEarned": return { value: facts.epEarned, at: null };
    case "honorableKills": return { value: facts.honorableKills, at: null };
    case "duelWins": return { value: facts.duelWins, at: null };
    case "duelStreak": return { value: facts.duelStreak, at: null };
    case "beatTopDuelist": return { value: facts.beatTopDuelist, at: null };
    case "gameAchievement": return { value: 0, at: null }; // generated rows are stored from the addon's record, never evaluated
    case "poeLevel": {
      const reached = facts.poeLevels.filter(row => row.level >= threshold).sort((a, b) => a.reachedAt.getTime() - b.reachedAt.getTime())[0];
      return { value: facts.poeLevels.reduce((best, row) => Math.max(best, row.level), 0), at: reached?.reachedAt ?? null };
    }
  }
}

/** Pure: which achievements these facts earn, with the date the data gives. */
export function evaluateAchievements(facts: AchievementFacts, now: Date): AchievementResult[] {
  return ACHIEVEMENTS.map(def => {
    const { value, at } = measure(def, facts);
    // Legacy rows are never awarded again; an earned one is kept by syncMemberAchievements from what is stored.
    const earned = !def.legacy && value >= def.threshold;
    // A date from the future (a skewed clock) is clamped; no history means "first seen now".
    const earnedAt = earned ? (at && at.getTime() <= now.getTime() ? at : now) : null;
    return { def, value, earned, earnedAt };
  });
}

type Db = Partial<Pick<PrismaClient, "gameAchievement">> & Pick<PrismaClient, "character" | "professionSkill" | "dungeonRunPlayer" | "raidAttendance" | "communityParticipationDay" | "poeLevelReached" | "poeMapVisit" | "communityPoint" | "communityHonorAward" | "epgpTransaction" | "memberActivityTotal" | "member" | "memberAchievement" | "memberMilestone" | "duelResult" | "craftRequest" | "recipeKnown">;

const dedupe = <T>(rows: T[], key: (row: T) => string) => { const seen = new Set<string>(); return rows.filter(row => { const k = key(row); if (seen.has(k)) return false; seen.add(k); return true; }); };

/**
 * Professions in which this member's addon saw them reach 300 (`profnew:<key>`) before any other member's 300 was recorded
 * (that member's own `profnew:` or a step-300 record). A skill that was already 300 when an addon first ran is not "live",
 * so it can never win this; a tie goes to nobody (strictly earlier is required of the others, not of the member).
 */
export function guildFirsts(rows: readonly { memberId: string; ref: string; reachedAt: Date }[], memberId: string): number {
  const key = (ref: string) => ref.replace(/^profnew:/, "").replace(/^prof:/, "").replace(/-300$/, "");
  const earliestOther = new Map<string, number>();
  for (const row of rows) if (row.memberId !== memberId) { const k = key(row.ref), t = row.reachedAt.getTime(); earliestOther.set(k, Math.min(earliestOther.get(k) ?? Infinity, t)); }
  const mine = new Set<string>();
  for (const row of rows) if (row.memberId === memberId && row.ref.startsWith("profnew:") && row.reachedAt.getTime() < (earliestOther.get(key(row.ref)) ?? Infinity)) mine.add(key(row.ref));
  return mine.size;
}

/** Recipes only this member's characters have learned in the guild. Needs recipe data from at least two other crafters, or "rare" means nothing. */
async function countRareRecipes(db: Pick<PrismaClient, "recipeKnown">, guildId: string, names: string[]): Promise<number> {
  if (!names.length) return 0;
  const [mine, others] = await Promise.all([
    db.recipeKnown.findMany({ where: { guildId, character: { in: names } }, select: { itemKey: true }, distinct: ["itemKey"], take: 3000 }),
    db.recipeKnown.findMany({ where: { guildId, character: { notIn: names } }, select: { character: true, realm: true }, distinct: ["character", "realm"], take: 3 })
  ]);
  if (others.length < 2 || !mine.length) return 0;
  const shared = await db.recipeKnown.findMany({ where: { guildId, character: { notIn: names }, itemKey: { in: mine.map(row => row.itemKey) } }, select: { itemKey: true }, distinct: ["itemKey"], take: 3000 });
  return mine.length - shared.length;
}

/** Reads the recorded data. Each query is bounded by the largest threshold that uses it. */
export async function gatherAchievementFacts(db: Db, guildId: string, memberId: string): Promise<AchievementFacts> {
  const member = await db.member.findFirst({ where: { id: memberId, guildId }, select: { discordUserId: true, createdAt: true, guild: { select: { discordId: true } } } });
  if (!member) return emptyFacts();
  const founded = member.guild?.discordId ? serverCreatedAt(member.guild.discordId) : null;
  const max = (metric: AchievementMetric) => Math.max(...ACHIEVEMENTS.filter(row => row.metric === metric).map(row => row.threshold));
  const [characters, skills, runs, attendance, days, levels, visits, counter, points, given, ep, mvps, killMilestones, duels, topDuelist, crafts, profMilestones] = await Promise.all([
    db.character.findMany({ where: { memberId, guildId }, select: { name: true, realm: true, level: true, gameEdition: true } }),
    db.professionSkill.findMany({ where: { character: { memberId, guildId } }, select: { skillLevel: true, profession: true, character: { select: { gameEdition: true } } }, take: 500 }),
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
    db.epgpTransaction.aggregate({ where: { guildId, memberId, type: "EP_AWARD", epAmount: { gt: 0 } }, _sum: { epAmount: true } }),
    db.communityHonorAward.findMany({ where: { guildId, kind: "WEEK", userId: member.discordUserId }, select: { createdAt: true }, orderBy: { createdAt: "asc" }, take: 200 }),
    // Lifetime honorable kills as the member's own addon reported them (the highest step it has recorded).
    db.memberMilestone.aggregate({ where: { guildId, memberId, kind: "hk" }, _max: { value: true } }),
    db.duelResult.findMany({ where: { guildId, counted: true, OR: [{ winnerId: memberId }, { loserId: memberId }] }, orderBy: { endedAt: "asc" }, take: 5000, select: { winnerId: true, loserId: true } }),
    db.duelResult.groupBy({ by: ["winnerId"], where: { guildId, counted: true }, _count: { _all: true }, orderBy: { _count: { winnerId: "desc" } }, take: 1 }),
    // Craft-board requests this member finished for someone else.
    db.craftRequest.findMany({ where: { guildId, crafterId: memberId, status: "DONE", requesterId: { not: memberId } }, select: { doneAt: true, updatedAt: true }, orderBy: { updatedAt: "asc" }, take: Math.max(1000, max("craftsDone") * 4) }),
    // Guild-wide: who reached skill 300 and when (live reaches are `profnew:<key>`, steps `prof:<key>-300`).
    db.memberMilestone.findMany({ where: { guildId, kind: "prof", OR: [{ ref: { startsWith: "profnew:" } }, { ref: { endsWith: "-300" } }] }, select: { memberId: true, ref: true, reachedAt: true }, take: 2000 })
  ]);
  const rareRecipes = await countRareRecipes(db, guildId, characters.map(row => row.name));
  // Season participation is a lower bound (capped, only in tracked channels); the counter is the full total from
  // when counting started. Taking the larger keeps earlier tracked activity counted.
  const seasonSum = (field: "messages" | "reactions" | "voiceMs") => days.reduce((sum, row) => sum + (row[field] ?? 0), 0);
  const byDate = (a: Date, b: Date) => a.getTime() - b.getTime();
  const raidRows = attendance.map(row => ({ id: row.raidId, at: row.raid.endedAt ?? row.raid.scheduledAt, cleared: row.raid.bosses.length > 0 && row.raid.bosses.every(boss => boss.status === "KILLED") }));
  const runDated = dedupe(runs, row => row.runId).map(row => ({ ...row, at: row.run.endedAt ?? row.run.startedAt ?? row.run.createdAt })).sort((x, y) => byDate(x.at, y.at));
  const runDates = runDated.map(row => row.at);
  const editions: AchievementFacts["editions"] = {};
  const forEdition = (key: string | null | undefined) => (editions[key ?? "forever"] ??= { highestLevel: 0, atCap: 0, profession: 0 });
  for (const row of characters) {
    const entry = forEdition(row.gameEdition), level = row.level ?? 0;
    entry.highestLevel = Math.max(entry.highestLevel, level);
    if (level >= wowLevelCap(row.gameEdition)) entry.atCap++;
  }
  const masteredBy = new Map<string, Set<string>>();
  for (const row of skills) {
    const entry = forEdition(row.character?.gameEdition);
    entry.profession = Math.max(entry.profession, row.skillLevel);
    if (row.skillLevel >= 300) { const key = row.character?.gameEdition ?? "forever"; (masteredBy.get(key) ?? masteredBy.set(key, new Set()).get(key)!).add(row.profession.toLowerCase()); }
  }
  for (const [key, set] of masteredBy) forEdition(key).mastered = set.size;
  const duelStats = { wins: 0, best: 0, beaten: new Set<string>() };
  for (let run = 0, i = 0; i < duels.length; i++) {
    const won = duels[i]!.winnerId === memberId;
    if (won) { duelStats.wins++; run++; duelStats.best = Math.max(duelStats.best, run); duelStats.beaten.add(duels[i]!.loserId); } else run = 0;
  }
  return {
    highestWowLevel: characters.reduce((best, row) => Math.max(best, row.level ?? 0), 0),
    charactersAtCap: characters.filter(row => (row.level ?? 0) >= wowLevelCap(row.gameEdition)).length,
    dungeonRuns: runDates,
    dungeonVariety: dedupe(runDated, row => String(row.run.instanceId)).map(row => row.at),
    highestProfessionSkill: skills.reduce((best, row) => Math.max(best, row.skillLevel), 0),
    editions,
    raidsAttended: raidRows.map(row => row.at).sort(byDate),
    raidClears: raidRows.filter(row => row.cleared).map(row => row.at).sort(byDate),
    // Day strings are YYYY-MM-DD; the same day in two seasons counts once.
    activeDays: dedupe(days, row => row.day).map(row => new Date(`${row.day}T12:00:00Z`)).filter(date => Number.isFinite(date.getTime())),
    poeLevels: levels,
    // A map entered through several portals is one map; visits from older companions have no instance and count one each.
    poeMaps: dedupe(visits, row => row.instanceRef ?? row.runRef).map(row => row.startedAt).sort(byDate),
    mvpWeeks: mvps.map(row => row.createdAt),
    serverAnniversaries: founded && member.createdAt ? anniversariesAttended(founded, member.createdAt, new Date()) : [],
    messagesSent: Math.max(counter?.messages ?? 0, seasonSum("messages")),
    reactionsGiven: Math.max(counter?.reactionsGiven ?? 0, given),
    reactionsReceived: Math.max(counter?.reactionsReceived ?? 0, seasonSum("reactions")),
    voiceHours: Math.floor(Math.max(counter?.voiceSeconds ?? 0, seasonSum("voiceMs") / 1000) / 3600),
    communityPoints: Math.max(0, points._sum.amount ?? 0),
    epEarned: Math.max(0, ep._sum.epAmount ?? 0),
    honorableKills: killMilestones._max.value ?? 0,
    duelWins: duelStats.wins,
    duelStreak: duelStats.best,
    craftsDone: crafts.map(row => row.doneAt ?? row.updatedAt).sort(byDate),
    professionFirsts: guildFirsts(profMilestones, memberId),
    rareRecipes,
    beatTopDuelist: topDuelist[0] && topDuelist[0]._count._all >= 3 && topDuelist[0].winnerId !== memberId && duelStats.beaten.has(topDuelist[0].winnerId) ? 1 : 0
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
  const evaluated = evaluateAchievements(await gatherAchievementFacts(db, guildId, memberId), now);
  // WoW Forever's own achievements, as the member's addon recorded them (kept as stored; the date is the client's).
  const generated = await earnedGameAchievements(db, guildId, memberId);
  const results: AchievementResult[] = [...evaluated, ...generated.map(row => ({ def: row.def, value: 1, earned: true, earnedAt: row.earnedAt <= now ? row.earnedAt : now }))];
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
    where: { key: { notIn: [...RETIRED_ACHIEVEMENT_IDS] }, ...(where.memberId ? { memberId: where.memberId } : {}), ...(where.memberIds ? { memberId: { in: where.memberIds } } : {}), ...(where.guildIds ? { guildId: { in: where.guildIds } } : {}) },
    select: { key: true, earnedAt: true }, take: 2000
  });
  const earned = new Map<string, Date>();
  for (const row of rows) { const prev = earned.get(row.key); if (!prev || row.earnedAt < prev) earned.set(row.key, row.earnedAt); }
  return earned;
}
