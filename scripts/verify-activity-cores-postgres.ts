import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { archiveTeam, createTeam, fillTeamSessions, manageSession, recordTeamAttendance, respondToSession, setTeamMember, withTeam } from "../src/services/activity-core.js";

// Invoked only after verify-postgres.ts checks its disposable localhost database URL.
export async function verifyActivityCoresPostgres(db: PrismaClient, guildId: string) {
  const now = new Date("2030-01-01T12:00:00Z");
  const core = await createTeam(db, guildId, { name: "Release dungeon team", kind: "DUNGEON", channelId: "team-channel",
    schedule: "tue 20h", timezone: "UTC", durationMinutes: 120 });
  const generated = await Promise.all(Array.from({ length: 8 }, () => fillTeamSessions(db, guildId, core.id, now)));
  assert.equal(generated.flat().length, 1, "concurrent weekly generation must create one occurrence");
  const session = await db.activitySession.findFirstOrThrow({ where: { coreId: core.id } });
  assert.equal(await db.discordJob.count({ where: { guildId, key: `team-session:${session.id}` } }), 1);
  const people = await Promise.all(Array.from({ length: 5 }, (_, i) => db.member.create({ data: { guildId, discordUserId: `team-player-${i}`, displayName: `Team ${i}`,
    characters: { create: { name: `TeamPlayer${i}`, realm: "TeamRelease", className: "Warrior" } } }, include: { characters: true } })));
  for (const member of people) await setTeamMember(db, guildId, core.id, member.id, "DPS", member === people[4], member.characters[0]!.id);
  await Promise.all(people.map(member => respondToSession(db, guildId, session.id, member.id, "CONFIRMED", "DPS", null, now)));
  assert.equal(await db.activityResponse.count({ where: { sessionId: session.id, status: "CONFIRMED" } }), 3);
  assert.equal(await db.activityResponse.count({ where: { sessionId: session.id, status: "WAITLISTED" } }), 2);
  assert.equal(await db.activityResponse.count({ where: { sessionId: session.id, attendance: { not: null } } }), 0);
  const confirmed = await db.activityResponse.findFirstOrThrow({ where: { sessionId: session.id, status: "CONFIRMED" } });
  await respondToSession(db, guildId, session.id, confirmed.memberId, "ABSENT", null, null, now);
  assert.equal(await db.activityResponse.count({ where: { sessionId: session.id, status: "CONFIRMED" } }), 3, "waiting member fills a released slot");
  await assert.rejects(respondToSession(db, "foreign-guild", session.id, people[0]!.id, "CONFIRMED", "DPS", null, now));
  await assert.rejects(respondToSession(db, guildId, session.id, people[0]!.id, "CONFIRMED", "DPS", people[1]!.characters[0]!.id, now));
  const jobBefore = await db.discordJob.findUniqueOrThrow({ where: { guildId_key: { guildId, key: `team-session:${session.id}` } } });
  await assert.rejects(withTeam(db, guildId, core.id, async tx => {
    await tx.activitySession.update({ where: { id: session.id }, data: { result: "must roll back" } });
    await tx.discordJob.update({ where: { id: jobBefore.id }, data: { revision: { increment: 1 } } });
    throw new Error("rollback fixture");
  }));
  assert.equal((await db.activitySession.findUniqueOrThrow({ where: { id: session.id } })).result, null);
  assert.equal((await db.discordJob.findUniqueOrThrow({ where: { id: jobBefore.id } })).revision, jobBefore.revision);
  await manageSession(db, guildId, session.id, "start", null, now);
  await recordTeamAttendance(db, guildId, session.id, people[0]!.id, "PRESENT");
  await manageSession(db, guildId, session.id, "complete", "Two completed runs", new Date("2030-01-01T22:00:00Z"));
  await archiveTeam(db, guildId, core.id);
  assert.equal((await db.activitySession.findUniqueOrThrow({ where: { id: session.id } })).status, "COMPLETED");
  assert.equal(await db.raid.count({ where: { guildId, title: "Release dungeon team" } }), 0);
  assert.equal(await db.epgpTransaction.count({ where: { guildId, memberId: { in: people.map(m => m.id) } } }), 0);
}

export async function verifyActivityCoresRestored(db: PrismaClient) {
  const core = await db.activityCore.findFirstOrThrow({ where: { name: "Release dungeon team" }, include: { sessions: { include: { responses: true } } } });
  assert.equal(core.archived, true);
  assert.equal(core.weeklySchedule, null);
  assert.equal(core.sessions.length, 1);
  assert.equal(core.sessions[0]!.result, "Two completed runs");
  assert.equal(core.sessions[0]!.responses.filter(r => r.attendance === "PRESENT").length, 1);
}
