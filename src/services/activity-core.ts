import type { ActivityCore, ActivityResponse, Prisma, PrismaClient, RaidAttendanceStatus, RaidRole } from "@prisma/client";
import { enqueueDiscordJob } from "./discord-jobs.js";
import { parseWeeklySchedule, weeklyOccurrences, weeklyScheduleText } from "./core-weekly-time.js";
import { isValidTimeZone } from "./raid-time.js";
import { ownedSignupCharacter } from "./signup-character.js";

export const TEAM_ROLES: RaidRole[] = ["TANK", "HEALER", "DPS"];
export const RESPONSE_STATES = ["CONFIRMED", "ABSENT", "TENTATIVE"] as const;
export type TeamResponse = typeof RESPONSE_STATES[number];
type Tx = Prisma.TransactionClient;
export const teamInclude = { members: { include: { member: true, character: true } } } as const;
export const sessionInclude = { core: { include: teamInclude }, responses: { include: { member: true, character: true }, orderBy: { respondedAt: "asc" as const } } } as const;

export function composition(kind: string, tanks?: number | null, healers?: number | null, dps?: number | null) {
  if (kind !== "DUNGEON" && kind !== "PVP") throw new Error("Choose Dungeon or PvP.");
  const result = { tanks: tanks ?? (kind === "DUNGEON" ? 1 : 0), healers: healers ?? (kind === "DUNGEON" ? 1 : 3), dps: dps ?? (kind === "DUNGEON" ? 3 : 7) };
  const size = result.tanks + result.healers + result.dps;
  if (Object.values(result).some(n => !Number.isInteger(n) || n < 0) || size < 2 || size > 40) throw new Error("Choose 2–40 slots in total, with no negative role counts.");
  if (kind === "DUNGEON" && (result.tanks !== 1 || result.healers !== 1 || result.dps !== 3)) throw new Error("Dungeon teams use 1 tank, 1 healer and 3 DPS.");
  return result;
}

export function scheduleData(input: string, timezone: string, durationMinutes: number) {
  if (!isValidTimeZone(timezone)) throw new Error("Use an IANA timezone, for example America/Toronto.");
  if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 480) throw new Error("Duration must be 15–480 minutes.");
  const slots = parseWeeklySchedule(input);
  return { weeklySchedule: slots.length ? weeklyScheduleText(slots) : null, timezone, durationMinutes };
}

export async function findTeam(db: Pick<PrismaClient, "activityCore">, guildId: string, value: string) {
  const team = await db.activityCore.findFirst({ where: { guildId, OR: [{ id: value }, { nameKey: value.trim().toLowerCase() }] }, include: teamInclude });
  if (!team) throw new Error("Team not found in this server. Use /team list.");
  return team;
}

// Every mutation for a team uses the same database lock, including weekly generation.
export async function withTeam<T>(db: PrismaClient, guildId: string, id: string, work: (tx: Tx, core: Awaited<ReturnType<typeof findTeam>>) => Promise<T>) {
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`activity-core:${id}`}, 0))`;
    return work(tx, await findTeam(tx, guildId, id));
  }, { timeout: 15_000, maxWait: 15_000 });
}

export async function queueTeam(db: Pick<PrismaClient, "discordJob">, core: Pick<ActivityCore, "id" | "guildId">) {
  await enqueueDiscordJob(db, core.guildId, `team-roster:${core.id}`, "TEAM_ROSTER", { coreId: core.id });
}
export async function queueSession(db: Pick<PrismaClient, "discordJob">, guildId: string, sessionId: string) {
  await enqueueDiscordJob(db, guildId, `team-session:${sessionId}`, "TEAM_SESSION", { sessionId });
}

export async function createTeam(db: PrismaClient, guildId: string, input: {
  name: string; kind: string; channelId: string; goal?: string | null; schedule: string; timezone: string;
  durationMinutes: number; tanks?: number | null; healers?: number | null; dps?: number | null;
}) {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 50) throw new Error("Team names must be 2–50 characters.");
  const data = { guildId, name, nameKey: name.toLowerCase(), kind: input.kind, channelId: input.channelId,
    goal: input.goal?.trim().slice(0, 300) || null, ...composition(input.kind, input.tanks, input.healers, input.dps),
    ...scheduleData(input.schedule, input.timezone, input.durationMinutes) };
  return db.$transaction(async tx => {
    const core = await tx.activityCore.create({ data });
    await queueTeam(tx, core);
    return core;
  });
}

export async function setTeamMember(db: PrismaClient, guildId: string, coreId: string, memberId: string, role: RaidRole, bench: boolean, character?: string | null) {
  return withTeam(db, guildId, coreId, async (tx, core) => {
    if (core.archived) throw new Error("This team is archived.");
    if (!TEAM_ROLES.includes(role)) throw new Error("Invalid role.");
    const member = await tx.member.findFirst({ where: { id: memberId, guildId } });
    if (!member) throw new Error("Member not found in this server.");
    const previous = core.members.find(m => m.memberId === memberId);
    const chosen = await ownedSignupCharacter(tx, guildId, memberId, character ?? previous?.characterId);
    await tx.activityCoreMember.upsert({ where: { coreId_memberId: { coreId, memberId } },
      create: { coreId, memberId, role, bench, characterId: chosen.id }, update: { role, bench, characterId: chosen.id } });
    await queueTeam(tx, core);
    // Roster changes affect priority at future sessions, never attendance or an active lineup.
    await refreshPlanned(tx, core);
  });
}

export async function removeTeamMember(db: PrismaClient, guildId: string, coreId: string, memberId: string) {
  return withTeam(db, guildId, coreId, async (tx, core) => {
    await tx.activityCoreMember.deleteMany({ where: { coreId, memberId } });
    const upcoming = await tx.activitySession.findMany({ where: { coreId, status: "PLANNED" } });
    for (const session of upcoming) {
      await tx.activityResponse.updateMany({ where: { sessionId: session.id, memberId }, data: { status: "ABSENT" } });
    }
    await refreshPlanned(tx, core);
    await queueTeam(tx, core);
  });
}

// Regular roster first, substitutes next, guild recruits last. Never count an RSVP as attendance.
export function allocateLineup(core: Pick<ActivityCore, "tanks" | "healers" | "dps">,
  roster: { memberId: string; bench: boolean }[], responses: (Pick<ActivityResponse, "memberId" | "role" | "status" | "respondedAt"> & { lineupOverride?: string | null })[]) {
  const tier = (id: string) => { const spot = roster.find(m => m.memberId === id); return !spot ? 2 : spot.bench ? 1 : 0; };
  const available = { TANK: core.tanks, HEALER: core.healers, DPS: core.dps };
  return responses.filter(r => r.status === "CONFIRMED" || r.status === "WAITLISTED")
    .sort((a, b) => (a.lineupOverride === "SELECTED" ? -1 : tier(a.memberId)) - (b.lineupOverride === "SELECTED" ? -1 : tier(b.memberId))
      || a.respondedAt.getTime() - b.respondedAt.getTime() || a.memberId.localeCompare(b.memberId))
    .map(r => ({ memberId: r.memberId, status: r.lineupOverride !== "BENCHED" && available[r.role]-- > 0 ? "CONFIRMED" : "WAITLISTED" }));
}

async function rebalance(tx: Tx, sessionId: string) {
  const session = await tx.activitySession.findUniqueOrThrow({ where: { id: sessionId }, include: sessionInclude });
  for (const spot of allocateLineup(session.core, session.core.members, session.responses)) {
    if (session.responses.find(r => r.memberId === spot.memberId)?.status !== spot.status) {
      await tx.activityResponse.update({ where: { sessionId_memberId: { sessionId, memberId: spot.memberId } }, data: { status: spot.status } });
    }
  }
}

async function refreshPlanned(tx: Tx, core: ActivityCore) {
  for (const session of await tx.activitySession.findMany({ where: { coreId: core.id, status: "PLANNED" } })) {
    await rebalance(tx, session.id);
    await queueSession(tx, core.guildId, session.id);
  }
}

export async function respondToSession(db: PrismaClient, guildId: string, sessionId: string, memberId: string,
  status: TeamResponse, role?: RaidRole | null, character?: string | null, now = new Date()) {
  if (!RESPONSE_STATES.includes(status)) throw new Error("Invalid response.");
  const source = await db.activitySession.findFirst({ where: { id: sessionId, core: { guildId } } });
  if (!source) throw new Error("Session not found in this server.");
  return withTeam(db, guildId, source.coreId, async (tx, core) => {
    const session = await tx.activitySession.findUniqueOrThrow({ where: { id: sessionId }, include: { responses: true } });
    if (core.archived || session.status !== "PLANNED" || session.endsAt <= now) throw new Error("Signups for this session are closed.");
    if (!await tx.member.findFirst({ where: { id: memberId, guildId } })) throw new Error("Member not found in this server.");
    const roster = core.members.find(m => m.memberId === memberId);
    const previous = session.responses.find(r => r.memberId === memberId);
    if (!roster && !session.openRecruitment && status !== "ABSENT") throw new Error("This session is reserved for the team. A leader can open recruitment.");
    const selectedRole = role ?? previous?.role ?? roster?.role ?? "DPS";
    if (!TEAM_ROLES.includes(selectedRole)) throw new Error("Invalid role.");
    // Absence/tentative still works if a player deleted their linked character.
    const chosen = status === "CONFIRMED" || character
      ? await ownedSignupCharacter(tx, guildId, memberId, character ?? previous?.characterId ?? roster?.characterId) : null;
    const data = { status, role: selectedRole, ...(chosen ? { characterId: chosen.id } : {}),
      ...(previous?.lineupOverride === "SELECTED" && (status !== "CONFIRMED" || previous.role !== selectedRole) ? { lineupOverride: null } : {}),
      ...(!previous || previous.status === "ABSENT" || previous.status === "TENTATIVE" ? { respondedAt: now } : {}) };
    await tx.activityResponse.upsert({ where: { sessionId_memberId: { sessionId, memberId } },
      create: { sessionId, memberId, ...data }, update: data });
    await rebalance(tx, sessionId);
    await queueSession(tx, guildId, sessionId);
    const response = await tx.activityResponse.findUniqueOrThrow({ where: { sessionId_memberId: { sessionId, memberId } } });
    const conflicts = status === "CONFIRMED" ? await tx.activityResponse.findMany({ where: {
      memberId, status: "CONFIRMED", sessionId: { not: sessionId }, session: { core: { guildId },
        status: { in: ["PLANNED", "ACTIVE"] }, scheduledAt: { lt: session.endsAt }, endsAt: { gt: session.scheduledAt } }
    }, include: { session: { include: { core: true } } } }) : [];
    return { response, conflicts: conflicts.map(r => r.session.core.name) };
  });
}

export async function fillTeamSessions(db: PrismaClient, guildId: string, coreId: string, now = new Date()) {
  return withTeam(db, guildId, coreId, async (tx, core) => {
    if (core.archived || !core.weeklySchedule) return [];
    const created: string[] = [];
    for (const slot of weeklyOccurrences(parseWeeklySchedule(core.weeklySchedule), core.timezone, now)) {
      if (await tx.activitySession.findUnique({ where: { coreId_occurrence: { coreId, occurrence: slot.key } } })) continue;
      const session = await tx.activitySession.create({ data: { coreId, occurrence: slot.key, scheduledAt: slot.scheduledAt,
        endsAt: new Date(slot.scheduledAt.getTime() + core.durationMinutes * 60_000) } });
      await queueSession(tx, guildId, session.id);
      created.push(session.id);
    }
    return created;
  });
}

export async function updateTeamSchedule(db: PrismaClient, guildId: string, coreId: string, schedule: string, timezone: string, duration: number) {
  return withTeam(db, guildId, coreId, async (tx, core) => {
    if (core.archived) throw new Error("This team is archived.");
    await tx.activityCore.update({ where: { id: coreId }, data: scheduleData(schedule, timezone, duration) });
    await queueTeam(tx, core);
    // Published occurrences keep their time, identity and responses. Cancel them individually.
  });
}

export async function manageSession(db: PrismaClient, guildId: string, sessionId: string,
  action: "open" | "close" | "start" | "complete" | "cancel", result?: string | null, now = new Date()) {
  if (!["open", "close", "start", "complete", "cancel"].includes(action)) throw new Error("Invalid session action.");
  const source = await db.activitySession.findFirst({ where: { id: sessionId, core: { guildId } } });
  if (!source) throw new Error("Session not found in this server.");
  return withTeam(db, guildId, source.coreId, async (tx, core) => {
    const session = await tx.activitySession.findUniqueOrThrow({ where: { id: sessionId } });
    if (core.archived || session.status === "COMPLETED" || session.status === "CANCELLED") throw new Error("This session is closed.");
    if ((action === "open" || action === "close" || action === "start") && session.status !== "PLANNED") throw new Error("This session has already started.");
    if (action === "start" && session.endsAt <= now) throw new Error("This session has already ended; cancel it or record its result.");
    if (action === "complete" && session.scheduledAt > now) throw new Error("A future session cannot be completed.");
    const data: Prisma.ActivitySessionUpdateInput = action === "open" || action === "close"
      ? { openRecruitment: action === "open" }
      : { status: action === "start" ? "ACTIVE" : action === "complete" ? "COMPLETED" : "CANCELLED", ...(result ? { result: result.slice(0, 500) } : {}) };
    await tx.activitySession.update({ where: { id: sessionId }, data });
    await queueSession(tx, guildId, sessionId);
  });
}

export async function selectTeamLineup(db: PrismaClient, guildId: string, sessionId: string, memberId: string, selection: "SELECTED" | "BENCHED" | "AUTO") {
  if (!["SELECTED", "BENCHED", "AUTO"].includes(selection)) throw new Error("Invalid lineup selection.");
  const source = await db.activitySession.findFirst({ where: { id: sessionId, core: { guildId } } });
  if (!source) throw new Error("Session not found in this server.");
  return withTeam(db, guildId, source.coreId, async (tx, core) => {
    const session = await tx.activitySession.findUniqueOrThrow({ where: { id: sessionId }, include: { responses: true } });
    if (core.archived || session.status !== "PLANNED") throw new Error("Choose the lineup before starting the session.");
    const response = session.responses.find(r => r.memberId === memberId);
    if (!response || !["CONFIRMED", "WAITLISTED"].includes(response.status)) throw new Error("The player must confirm availability first.");
    const caps = { TANK: core.tanks, HEALER: core.healers, DPS: core.dps };
    if (selection === "SELECTED" && session.responses.filter(r => r.memberId !== memberId && r.role === response.role && r.lineupOverride === "SELECTED" && ["CONFIRMED", "WAITLISTED"].includes(r.status)).length >= caps[response.role]) {
      throw new Error("All slots for this role are selected. Bench a selected player first.");
    }
    await tx.activityResponse.update({ where: { sessionId_memberId: { sessionId, memberId } }, data: { lineupOverride: selection === "AUTO" ? null : selection } });
    await rebalance(tx, sessionId);
    await queueSession(tx, guildId, sessionId);
  });
}

export async function recordTeamAttendance(db: PrismaClient, guildId: string, sessionId: string, memberId: string, attendance: RaidAttendanceStatus) {
  if (!["PRESENT", "LATE", "ABSENT", "BENCHED"].includes(attendance)) throw new Error("Invalid attendance.");
  const source = await db.activitySession.findFirst({ where: { id: sessionId, core: { guildId } } });
  if (!source) throw new Error("Session not found in this server.");
  return withTeam(db, guildId, source.coreId, async (tx, core) => {
    const session = await tx.activitySession.findUniqueOrThrow({ where: { id: sessionId } });
    if (session.status !== "ACTIVE" && session.status !== "COMPLETED") throw new Error("Start the session before recording actual attendance.");
    const updated = await tx.activityResponse.updateMany({ where: { sessionId, memberId, member: { guildId } }, data: { attendance } });
    if (!updated.count) {
      const spot = core.members.find(m => m.memberId === memberId);
      if (!spot) throw new Error("That player must be on the roster or have responded to this session.");
      // A leader can record an actual no-show or late arrival without inventing an RSVP.
      await tx.activityResponse.create({ data: { sessionId, memberId, role: spot.role, characterId: spot.characterId, status: "UNANSWERED", attendance } });
    }
    await queueSession(tx, guildId, sessionId);
  });
}

export async function archiveTeam(db: PrismaClient, guildId: string, coreId: string) {
  return withTeam(db, guildId, coreId, async (tx, core) => {
    const future = await tx.activitySession.findMany({ where: { coreId, status: { in: ["PLANNED", "ACTIVE"] } } });
    await tx.activitySession.updateMany({ where: { id: { in: future.map(s => s.id) } }, data: { status: "CANCELLED" } });
    await tx.activityCore.update({ where: { id: coreId }, data: { archived: true, weeklySchedule: null } });
    for (const session of future) await queueSession(tx, guildId, session.id);
    await queueTeam(tx, core);
  });
}

export async function runTeamSchedules(db: PrismaClient, guildId: string, onError: (error: unknown) => void, now = new Date()) {
  const cores = await db.activityCore.findMany({ where: { guildId, archived: false } });
  for (const core of cores) {
    try {
      await fillTeamSessions(db, guildId, core.id, now);
      await withTeam(db, guildId, core.id, async tx => {
        const due = await tx.activitySession.findMany({ where: { coreId: core.id, status: "PLANNED", reminderQueued: false,
          scheduledAt: { gt: now, lte: new Date(now.getTime() + 60 * 60_000) } } });
        for (const session of due) {
          await enqueueDiscordJob(tx, guildId, `team-reminder:${session.id}`, "TEAM_REMINDER", { sessionId: session.id });
          await tx.activitySession.update({ where: { id: session.id }, data: { reminderQueued: true } });
        }
      });
    } catch (error) { onError(error); }
  }
}
