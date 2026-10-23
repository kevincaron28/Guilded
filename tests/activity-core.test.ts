import { describe, expect, it, vi } from "vitest";
import type { PrismaClient, RaidRole } from "@prisma/client";
import { allocateLineup, archiveTeam, composition, createTeam, fillTeamSessions, manageSession, recordTeamAttendance, respondToSession, runTeamSchedules, scheduleData, selectTeamLineup, setTeamMember, updateTeamSchedule } from "../src/services/activity-core.js";

const now = new Date("2026-10-09T12:00:00Z");
const candidate = (memberId: string, role: RaidRole = "DPS", status = "CONFIRMED", offset = 0, lineupOverride: string | null = null) => ({ memberId, role, status, respondedAt: new Date(now.getTime() + offset), lineupOverride });

describe("team composition and scheduling", () => {
  it("defaults dungeons to five and supports explicit PvP formats", () => {
    expect(composition("DUNGEON")).toEqual({ tanks: 1, healers: 1, dps: 3 });
    expect(composition("PVP", 1, 2, 7)).toEqual({ tanks: 1, healers: 2, dps: 7 });
    expect(() => composition("DUNGEON", 2, 1, 2)).toThrow();
    for (const counts of [[0, 0, 1], [-1, 1, 3], [1, 1, 39], [0, 1.5, 3]]) expect(() => composition("PVP", ...counts as [number, number, number])).toThrow();
    expect(() => composition("RAID")).toThrow();
  });
  it("normalizes weekly schedules, supports pause, rejects invalid zones and duration", () => {
    expect(scheduleData("thu 20h", "America/Toronto", 120)).toEqual({ weeklySchedule: "jeudi 20h00", timezone: "America/Toronto", durationMinutes: 120 });
    expect(scheduleData("off", "America/Toronto", 120).weeklySchedule).toBeNull();
    expect(() => scheduleData("thu 20h", "broken", 120)).toThrow();
    expect(() => scheduleData("thu 20h", "UTC", 0)).toThrow();
  });
});

describe("lineup allocation", () => {
  const core = { tanks: 1, healers: 1, dps: 1 };
  it("prioritizes regulars then substitutes over earlier outside confirmations", () => {
    const roster = [{ memberId: "regular", bench: false }, { memberId: "backup", bench: true }];
    const result = allocateLineup(core, roster, [candidate("outside"), candidate("backup", "DPS", "CONFIRMED", 1), candidate("regular", "DPS", "CONFIRMED", 2)]);
    expect(result).toEqual([{ memberId: "regular", status: "CONFIRMED" }, { memberId: "backup", status: "WAITLISTED" }, { memberId: "outside", status: "WAITLISTED" }]);
  });
  it("promotes a waiting replacement when a regular declines without allocating absent/tentative players", () => {
    expect(allocateLineup(core, [], [candidate("a", "TANK", "ABSENT"), candidate("b", "TANK", "WAITLISTED"), candidate("c", "HEALER", "TENTATIVE")]))
      .toEqual([{ memberId: "b", status: "CONFIRMED" }]);
  });
  it("honors selected and benched players, and zero role slots", () => {
    const result = allocateLineup(core, [{ memberId: "regular", bench: false }], [candidate("regular"), candidate("picked", "DPS", "WAITLISTED", 1, "SELECTED"), candidate("benched", "TANK", "CONFIRMED", 0, "BENCHED"), candidate("tank", "TANK")]);
    expect(result).toContainEqual({ memberId: "picked", status: "CONFIRMED" });
    expect(result).toContainEqual({ memberId: "regular", status: "WAITLISTED" });
    expect(result).toContainEqual({ memberId: "benched", status: "WAITLISTED" });
    expect(result).toContainEqual({ memberId: "tank", status: "CONFIRMED" });
    expect(allocateLineup({ tanks: 0, healers: 1, dps: 1 }, [], [candidate("tank", "TANK")])[0]?.status).toBe("WAITLISTED");
  });
  it("never overfills any role for a large roster", () => {
    const input = Array.from({ length: 120 }, (_, n) => candidate(String(n), (["TANK", "HEALER", "DPS"] as const)[n % 3]!));
    const assigned = allocateLineup(core, [], input).filter(r => r.status === "CONFIRMED");
    expect(assigned).toHaveLength(3);
    expect(new Set(assigned.map(r => input.find(x => x.memberId === r.memberId)?.role)).size).toBe(3);
  });
});

// Small storage fixture exercises service transitions. Real lock/rollback coverage lives
// in verify-activity-cores-postgres.ts, invoked by the existing PostgreSQL CI gate.
function fixture() {
  const core = { id: "core", guildId: "guild", name: "Weekly", nameKey: "weekly", kind: "DUNGEON", channelId: "channel", timezone: "America/Toronto", weeklySchedule: "vendredi 20h00", durationMinutes: 120,
    tanks: 1, healers: 1, dps: 3, archived: false, members: [{ memberId: "member", bench: false, role: "TANK", characterId: "char" }] };
  const responses: Array<ReturnType<typeof candidate> & { sessionId: string; characterId: string | null; attendance: string | null }> = [];
  const sessions = [{ id: "session", coreId: "core", occurrence: "2026-10-09:20:0", scheduledAt: new Date("2026-10-10T00:00:00Z"), endsAt: new Date("2026-10-10T02:00:00Z"), status: "PLANNED", openRecruitment: false, reminderQueued: false }];
  const hydrate = (s: typeof sessions[number]) => ({ ...s, core, responses });
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    activityCore: { findFirst: vi.fn(async ({ where }) => where.guildId === "guild" ? core : null),
      findMany: vi.fn(async () => [core]), create: vi.fn(async ({ data }) => ({ ...core, ...data })),
      update: vi.fn(async ({ data }) => Object.assign(core, data)) },
    activitySession: {
      findFirst: vi.fn(async ({ where }) => where.core?.guildId === "guild" ? sessions.find(s => s.id === where.id) ?? null : null),
      findUnique: vi.fn(async ({ where }) => where.coreId_occurrence ? sessions.find(s => s.occurrence === where.coreId_occurrence.occurrence) ?? null : sessions.find(s => s.id === where.id) ?? null),
      findUniqueOrThrow: vi.fn(async ({ where }) => hydrate(sessions.find(s => s.id === where.id)!)),
      findMany: vi.fn(async () => sessions),
      create: vi.fn(async ({ data }) => { const s = { ...sessions[0]!, ...data, id: `s${sessions.length}` }; sessions.push(s); return s; }),
      update: vi.fn(async ({ where, data }) => Object.assign(sessions.find(s => s.id === where.id)!, data)),
      updateMany: vi.fn(async ({ data }) => { sessions.forEach(s => Object.assign(s, data)); return { count: sessions.length }; })
    },
    activityResponse: {
      create: vi.fn(async ({ data }) => { const r = { ...candidate(data.memberId), characterId: null, attendance: null, ...data }; responses.push(r); return r; }),
      upsert: vi.fn(async ({ where, create, update }) => {
        const existing = responses.find(r => r.memberId === where.sessionId_memberId.memberId);
        if (existing) return Object.assign(existing, update);
        const r = { ...candidate(create.memberId), characterId: null, attendance: null, ...create }; responses.push(r); return r;
      }),
      update: vi.fn(async ({ where, data }) => Object.assign(responses.find(r => r.memberId === where.sessionId_memberId.memberId)!, data)),
      updateMany: vi.fn(async ({ where, data }) => { const r = responses.find(r => r.memberId === where.memberId); if (r) Object.assign(r, data); return { count: r ? 1 : 0 }; }),
      findUniqueOrThrow: vi.fn(async ({ where }) => responses.find(r => r.memberId === where.sessionId_memberId.memberId)!),
      findMany: vi.fn(async () => [])
    },
    activityCoreMember: { upsert: vi.fn(async () => ({})) },
    member: { findFirst: vi.fn(async ({ where }) => where.guildId === "guild" ? { id: where.id } : null) },
    character: { findMany: vi.fn(async ({ where }) => where.memberId === "member" ? [{ id: "char", name: "Ray", realm: "Realm" }] : []) },
    discordJob: { upsert: vi.fn(async () => ({})) },
    raid: { create: vi.fn() }, epgpTransaction: { create: vi.fn() }
  };
  const db = { ...tx, $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)) } as unknown as PrismaClient;
  return { db, tx, core, sessions, responses };
}

describe("weekly team persistence", () => {
  it("creates a roster job without creating raid or EPGP data", async () => {
    const { db, tx } = fixture();
    await createTeam(db, "guild", { name: " New ", kind: "DUNGEON", channelId: "channel", schedule: "fri 20h", timezone: "UTC", durationMinutes: 120 });
    expect(tx.activityCore.create).toHaveBeenCalledWith({ data: expect.objectContaining({ name: "New", nameKey: "new", kind: "DUNGEON" }) });
    expect(tx.discordJob.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ kind: "TEAM_ROSTER" }) }));
    expect(tx.raid.create).not.toHaveBeenCalled();
    expect(tx.epgpTransaction.create).not.toHaveBeenCalled();
  });
  it("does not duplicate or resurrect cancelled weekly occurrences", async () => {
    const { db, tx, sessions } = fixture();
    sessions[0]!.status = "CANCELLED";
    expect(await fillTeamSessions(db, "guild", "core", now)).toEqual([]);
    expect(tx.activitySession.create).not.toHaveBeenCalled();
    sessions.splice(0);
    expect(await fillTeamSessions(db, "guild", "core", now)).toHaveLength(1);
    expect(await fillTeamSessions(db, "guild", "core", now)).toEqual([]);
    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(tx.discordJob.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ kind: "TEAM_SESSION" }) }));
    expect(tx.raid.create).not.toHaveBeenCalled();
  });
  it("keeps posted sessions when pausing or changing the schedule", async () => {
    const { db, tx, sessions } = fixture();
    const original = sessions[0]!.scheduledAt;
    await updateTeamSchedule(db, "guild", "core", "off", "UTC", 90);
    expect(await fillTeamSessions(db, "guild", "core", now)).toEqual([]);
    expect(sessions[0]!.scheduledAt).toEqual(original);
    expect(tx.activitySession.update).not.toHaveBeenCalled();
  });
  it("blocks cross-server lookups before mutation", async () => {
    const { db, tx } = fixture();
    await expect(fillTeamSessions(db, "other", "core", now)).rejects.toThrow(/not found/);
    await expect(respondToSession(db, "other", "session", "member", "CONFIRMED", "TANK", null, now)).rejects.toThrow(/not found/);
    expect(tx.discordJob.upsert).not.toHaveBeenCalled();
  });
  it("requires an owned character and explicit response; never infers attendance", async () => {
    const { db, tx, responses } = fixture();
    const result = await respondToSession(db, "guild", "session", "member", "CONFIRMED", "TANK", null, now);
    expect(result.response).toMatchObject({ status: "CONFIRMED", characterId: "char", attendance: null });
    expect(responses).toHaveLength(1);
    await expect(respondToSession(db, "guild", "session", "member", "CONFIRMED", "TANK", "someone else", now)).rejects.toThrow();
    expect(tx.epgpTransaction.create).not.toHaveBeenCalled();
  });
  it("does not let an outsider confirm a closed-roster session", async () => {
    const { db, tx } = fixture();
    await expect(respondToSession(db, "guild", "session", "outsider", "CONFIRMED", "TANK", null, now)).rejects.toThrow(/reserved/);
    expect(tx.activityResponse.upsert).not.toHaveBeenCalled();
  });
  it("rejects closed, archived and expired sessions", async () => {
    const { db, sessions, core } = fixture();
    for (const status of ["ACTIVE", "COMPLETED", "CANCELLED"]) {
      sessions[0]!.status = status;
      await expect(respondToSession(db, "guild", "session", "member", "ABSENT", null, null, now)).rejects.toThrow(/closed/);
    }
    sessions[0]!.status = "PLANNED";
    await expect(respondToSession(db, "guild", "session", "member", "ABSENT", null, null, new Date("2026-10-11"))).rejects.toThrow(/closed/);
    core.archived = true;
    await expect(respondToSession(db, "guild", "session", "member", "ABSENT", null, null, now)).rejects.toThrow(/closed/);
  });
  it("allows absence even when the character link has been removed", async () => {
    const { db, tx } = fixture();
    tx.character.findMany.mockResolvedValue([]);
    expect((await respondToSession(db, "guild", "session", "member", "ABSENT", null, null, now)).response.status).toBe("ABSENT");
  });
  it("keeps leader bench decisions across member responses", async () => {
    const { db, responses } = fixture();
    responses.push({ ...candidate("member", "TANK", "WAITLISTED", 0, "BENCHED"), sessionId: "session", characterId: "char", attendance: null });
    const result = await respondToSession(db, "guild", "session", "member", "CONFIRMED", "HEALER", null, now);
    expect(result.response).toMatchObject({ status: "WAITLISTED", lineupOverride: "BENCHED" });
  });
  it("requires a response before leader lineup selection and freezes it after start", async () => {
    const { db, sessions } = fixture();
    await expect(selectTeamLineup(db, "guild", "session", "member", "SELECTED")).rejects.toThrow(/confirm/);
    await respondToSession(db, "guild", "session", "member", "CONFIRMED", "TANK", null, now);
    await selectTeamLineup(db, "guild", "session", "member", "SELECTED");
    sessions[0]!.status = "ACTIVE";
    await expect(selectTeamLineup(db, "guild", "session", "member", "BENCHED")).rejects.toThrow(/before starting/);
  });
  it("records real attendance only after a session starts, preserving it on completion", async () => {
    const { db, responses } = fixture();
    await respondToSession(db, "guild", "session", "member", "CONFIRMED", "TANK", null, now);
    await expect(recordTeamAttendance(db, "guild", "session", "member", "PRESENT")).rejects.toThrow(/Start/);
    await manageSession(db, "guild", "session", "start", null, now);
    expect(responses[0]?.attendance).toBeNull();
    await recordTeamAttendance(db, "guild", "session", "member", "PRESENT");
    await manageSession(db, "guild", "session", "complete", "Two runs", new Date("2026-10-10T02:00:00Z"));
    expect(responses[0]?.attendance).toBe("PRESENT");
  });
  it("archives without deleting history and prevents future generation", async () => {
    const { db, core, sessions } = fixture();
    await archiveTeam(db, "guild", "core");
    expect(core.archived).toBe(true);
    expect(sessions[0]?.status).toBe("CANCELLED");
    expect(await fillTeamSessions(db, "guild", "core", now)).toEqual([]);
  });
  it("records a roster no-show without inventing a signup", async () => {
    const { db, sessions, responses } = fixture();
    sessions[0]!.status = "ACTIVE";
    await recordTeamAttendance(db, "guild", "session", "member", "ABSENT");
    expect(responses[0]).toMatchObject({ status: "UNANSWERED", attendance: "ABSENT" });
  });
  it("validates linked ownership when adding a roster member", async () => {
    const { db, tx } = fixture();
    await expect(setTeamMember(db, "guild", "core", "outsider", "DPS", false, "char")).rejects.toThrow();
    expect(tx.activityCoreMember.upsert).not.toHaveBeenCalled();
  });
  it("queues the pre-session reminder transactionally", async () => {
    const { db, tx, sessions } = fixture();
    await runTeamSchedules(db, "guild", vi.fn(), now);
    expect(tx.discordJob.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ kind: "TEAM_REMINDER" }) }));
    expect(sessions[0]?.reminderQueued).toBe(true);
    expect(tx.activitySession.findMany).toHaveBeenCalledWith({ where: expect.objectContaining({ reminderQueued: false, scheduledAt: { gt: now, lte: new Date(now.getTime() + 3600_000) } }) });
  });
});
