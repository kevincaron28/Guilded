import { describe, expect, it, vi } from "vitest";
import { actOnWeeklyQuestion, questionWeek, reviewWeeklyQuestion, saveWeeklyQuestion } from "../src/services/weekly-question-store.js";
import { deliverGroupWatch, saveGroupWatch, type WatchEvent } from "../src/services/group-watch.js";

// This models serialized transaction callbacks for behavior tests. The companion
// PostgreSQL rehearsal exercises actual advisory locks and unique constraints.
function serialTransactions() {
  let tail = Promise.resolve();
  return (work: () => Promise<unknown>) => {
    const pending = tail.then(work); tail = pending.then(() => {}, () => {}); return pending;
  };
}
const now = new Date("2026-10-30T22:00:00Z");
const settings = { question: "Which dungeon next?", options: ["Dungeon", "Raid"], mode: "button-poll", timezone: "America/Toronto", weekday: 5, minute: 19 * 60, channelId: "123456789012345678" };

function questionDb() {
  let plan = { guildId: "guild", settings, revision: 1, paused: false, createdBy: "officer" };
  const reviews = new Map<string, { id: string; guildId: string; actorId: string; revision: number; weekKey: string; expiresAt: Date }>();
  const occurrences: { id: string; guildId: string; weekKey: string; status: string; channelId: string; pollId: string | null; createdAt: Date; messageId?: string }[] = [];
  const serial = serialTransactions();
  const database = {
    $executeRaw: vi.fn(),
    weeklyQuestionPlan: {
      findUnique: vi.fn(async ({ where }) => where.guildId === plan.guildId ? { ...plan } : null),
      upsert: vi.fn(async ({ update }) => { plan = { ...plan, ...update, revision: plan.revision + 1 }; return { ...plan }; }),
      update: vi.fn(async ({ data }) => { plan = { ...plan, paused: data.paused, revision: plan.revision + 1 }; return { ...plan }; })
    },
    weeklyQuestionReview: {
      deleteMany: vi.fn(),
      create: vi.fn(async ({ data }) => { const row = { id: String(reviews.size), ...data }; reviews.set(row.id, row); return row; }),
      findFirst: vi.fn(async ({ where }) => {
        const row = reviews.get(where.id);
        return row && row.guildId === where.guildId && row.actorId === where.actorId && row.expiresAt > where.expiresAt.gt ? row : null;
      })
    },
    weeklyQuestionOccurrence: {
      findUnique: vi.fn(async ({ where }) => occurrences.find(row => row.guildId === where.guildId_weekKey.guildId && row.weekKey === where.guildId_weekKey.weekKey) ?? null),
      findFirst: vi.fn(async ({ where }) => occurrences.find(row => row.guildId === where.guildId && where.status.in.includes(row.status) && row.createdAt > where.createdAt.gt) ?? null),
      create: vi.fn(async ({ data }) => { const row = { id: String(occurrences.length), ...data, createdAt: now }; occurrences.push(row); return { ...row }; }),
      update: vi.fn(async ({ where, data }) => { const row = occurrences.find(row => row.id === where.id)!; Object.assign(row, data); return row; })
    },
    poll: { create: vi.fn(async ({ data }) => ({ id: "poll", ...data })), update: vi.fn() },
    $transaction: (work: (tx: unknown) => Promise<unknown>) => serial(() => work(database))
  };
  return { database, occurrences, getPlan: () => plan };
}

describe("reviewed weekly question delivery", () => {
  async function fixture() {
    const f = questionDb();
    const review = await reviewWeeklyQuestion(f.database as never, "guild", "officer", now);
    const input = { reviewId: review.review.id, guildId: "guild", actorId: "officer", action: "post" as const,
      authorize: vi.fn(async () => true), send: vi.fn(async () => "message") };
    return { ...f, input };
  }
  it("persists a draft without a poll/send, with stable local-week keys across DST", async () => {
    const f = questionDb(); await saveWeeklyQuestion(f.database as never, "guild", "officer", settings);
    expect(f.database.poll.create).not.toHaveBeenCalled();
    expect(questionWeek(new Date("2026-11-01T05:30:00Z"), settings.timezone)).toBe("2026-10-26");
    expect(questionWeek(new Date("2026-11-01T06:30:00Z"), settings.timezone)).toBe("2026-10-26");
  });
  it("allows only one manual post under concurrent reviews/replays, reusing existing Poll", async () => {
    const f = await fixture();
    const review2 = await reviewWeeklyQuestion(f.database as never, "guild", "officer", now);
    const results = await Promise.all([actOnWeeklyQuestion(f.database as never, f.input, now), actOnWeeklyQuestion(f.database as never, { ...f.input, reviewId: review2.review.id }, now)]);
    expect(results.sort()).toEqual(["already-handled", "sent"]);
    expect(f.input.send).toHaveBeenCalledTimes(1); expect(f.database.poll.create).toHaveBeenCalledTimes(1);
    expect(f.occurrences[0]).toMatchObject({ status: "SENT", messageId: "message", channelId: settings.channelId });
    expect(f.input.send).toHaveBeenCalledWith(settings, "poll");
  });
  it("rejects another actor/guild and an expired preview before creating content", async () => {
    const f = await fixture();
    for (const change of [{ actorId: "other" }, { guildId: "other" }]) expect(await actOnWeeklyQuestion(f.database as never, { ...f.input, ...change }, now)).toBe("expired");
    expect(await actOnWeeklyQuestion(f.database as never, f.input, new Date(now.getTime() + 300_000))).toBe("expired");
    expect(f.input.send).not.toHaveBeenCalled(); expect(f.database.poll.create).not.toHaveBeenCalled();
  });
  it("invalidates old previews on edits and never substitutes a changed destination", async () => {
    const f = await fixture();
    await saveWeeklyQuestion(f.database as never, "guild", "officer", { ...settings, channelId: "223456789012345678" });
    expect(await actOnWeeklyQuestion(f.database as never, f.input, now)).toBe("expired");
    expect(f.input.send).not.toHaveBeenCalled();
  });
  it("honors skip and pause without sending or creating a poll", async () => {
    for (const action of ["skip", "pause"] as const) {
      const f = await fixture();
      expect(await actOnWeeklyQuestion(f.database as never, { ...f.input, action }, now)).toBe(action === "skip" ? "skipped" : "paused");
      expect(f.input.send).not.toHaveBeenCalled(); expect(f.database.poll.create).not.toHaveBeenCalled();
      expect(await actOnWeeklyQuestion(f.database as never, f.input, now)).not.toBe("sent");
    }
  });
  it("rechecks authorization after durable claim and cancels on loss", async () => {
    const f = await fixture(); f.input.authorize.mockResolvedValueOnce(true).mockResolvedValue(false);
    expect(await actOnWeeklyQuestion(f.database as never, f.input, now)).toBe("cancelled");
    expect(f.input.send).not.toHaveBeenCalled(); expect(f.database.poll.update).toHaveBeenCalledWith({ where: { id: "poll" }, data: { closed: true } });
  });
  it("keeps uncertain sends reserved across retries, including after a crash-like rejection", async () => {
    const f = await fixture(); f.input.send.mockRejectedValue(new Error("network outcome unknown"));
    expect(await actOnWeeklyQuestion(f.database as never, f.input, now)).toBe("uncertain");
    expect(await actOnWeeklyQuestion(f.database as never, f.input, now)).toBe("already-handled");
    expect(f.input.send).toHaveBeenCalledTimes(1); expect(f.occurrences[0]!.status).toBe("UNCERTAIN");
  });
});

const subscription = { optedIn: true, timezone: "America/Toronto", createdAt: "2026-10-30T12:00:00Z", expiresAt: "2026-11-01T12:00:00Z",
  weekdays: [0, 1, 2, 3, 4, 5, 6], available: { start: 19 * 60, end: 22 * 60 }, quiet: { start: 22 * 60, end: 8 * 60 }, types: ["group", "vacancy"] };
function watchFixture() {
  const alert = { guildId: "guild", memberId: "member", kinds: ["DUNGEON"], roles: ["HEALER"], subscription };
  const gate = { targetedAlertsEnabled: true, targetedAlertsChannelId: "channel" };
  const attempts: { id: string; eventKey: string; attemptedAt: Date; status: string }[] = [];
  const serial = serialTransactions();
  const database = {
    $executeRaw: vi.fn(), member: { findFirst: vi.fn(async () => ({ discordUserId: "actor", characters: [{ level: 60 }] })) },
    guildSettings: { findUnique: vi.fn(async () => ({ ...gate })) },
    groupAlert: { findFirst: vi.fn(async () => structuredClone(alert)), upsert: vi.fn(async ({ update }) => { Object.assign(alert, update); return alert; }) },
    targetedAlertAttempt: { findMany: vi.fn(async () => attempts), create: vi.fn(async ({ data }) => { const row = { id: String(attempts.length), status: "ATTEMPTED", ...data }; attempts.push(row); return row; }),
      update: vi.fn(async ({ where, data }) => Object.assign(attempts.find(row => row.id === where.id)!, data)) },
    $transaction: (work: (tx: unknown) => Promise<unknown>) => serial(() => work(database))
  };
  const event: WatchEvent = { key: "vacancy:raid", type: "vacancy", startsAt: new Date("2026-10-30T23:00:00Z"), expiresAt: new Date("2026-10-30T23:00:00Z"), open: true, hasVacancy: true,
    channelId: "channel", messageId: "post", title: "Raid", excludedMemberIds: [], group: { kind: "DUNGEON", minLevel: null, maxLevel: null, rolesNeeded: ["HEALER"], leaderDiscordId: "leader" } };
  const input = { guildId: "guild", memberId: "member", eventKey: event.key, loadEvent: vi.fn(async () => structuredClone(event)), access: vi.fn(async () => true), send: vi.fn(async () => "message") };
  return { database, input, alert, gate, attempts, event };
}

describe("atomic targeted alert attempts", () => {
  it("requires the approval gate and exact target channel", async () => {
    const f = watchFixture(); f.gate.targetedAlertsEnabled = false;
    expect(await deliverGroupWatch(f.database as never, f.input, now)).toBe("suppressed");
    f.gate.targetedAlertsEnabled = true; f.gate.targetedAlertsChannelId = "other";
    expect(await deliverGroupWatch(f.database as never, f.input, now)).toBe("suppressed");
    expect(f.input.send).not.toHaveBeenCalled(); expect(f.attempts).toHaveLength(0);
  });
  it("reserves once under concurrent scans and enforces cooldown across different events", async () => {
    const f = watchFixture();
    expect((await Promise.all([deliverGroupWatch(f.database as never, f.input, now), deliverGroupWatch(f.database as never, f.input, now)])).sort()).toEqual(["sent", "suppressed"]);
    f.event.key = "vacancy:second"; f.input.eventKey = f.event.key;
    expect(await deliverGroupWatch(f.database as never, f.input, now)).toBe("suppressed");
    expect(f.input.send).toHaveBeenCalledTimes(1);
  });
  it("persists opt-out without resetting attempt history", async () => {
    const f = watchFixture(); await deliverGroupWatch(f.database as never, f.input, now);
    await saveGroupWatch(f.database as never, "guild", "member", { ...subscription, optedIn: false }, ["HEALER"]);
    expect(f.attempts).toHaveLength(1);
    f.event.key = "vacancy:second"; f.input.eventKey = f.event.key;
    expect(await deliverGroupWatch(f.database as never, f.input, now)).toBe("suppressed");
  });
  it("revalidates access, vacancies and opt-out before dispatch", async () => {
    for (const change of ["access", "vacancy", "optout"] as const) {
      const f = watchFixture();
      if (change === "access") f.input.access.mockResolvedValueOnce(true).mockResolvedValue(false);
      if (change === "vacancy") f.input.loadEvent.mockResolvedValueOnce(f.event).mockResolvedValue({ ...f.event, hasVacancy: false });
      if (change === "optout") f.database.groupAlert.findFirst.mockResolvedValueOnce(structuredClone(f.alert)).mockResolvedValue({ ...f.alert, subscription: { ...subscription, optedIn: false } });
      expect(await deliverGroupWatch(f.database as never, f.input, now)).toBe("cancelled");
      expect(f.input.send).not.toHaveBeenCalled(); expect(f.attempts[0]!.status).toBe("CANCELLED");
    }
  });
  it("never retries an uncertain network outcome or alerts an already signed-up member", async () => {
    const f = watchFixture(); f.input.send.mockRejectedValue(new Error("timeout"));
    expect(await deliverGroupWatch(f.database as never, f.input, now)).toBe("uncertain");
    expect(await deliverGroupWatch(f.database as never, f.input, now)).toBe("suppressed");
    expect(f.input.send).toHaveBeenCalledTimes(1);
    f.event.excludedMemberIds = ["member"];
    expect(await deliverGroupWatch(f.database as never, f.input, now)).toBe("unavailable");
  });
});
