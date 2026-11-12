import { beforeEach, describe, expect, it, vi } from "vitest";
import { CLEANUP_DELAY_MS, MAX_ATTEMPTS, MAX_CYCLES, RETRY_LATER_MS, resetCleanupWarnings, runInviteCleanupJob, scheduleInviteCleanups } from "../src/services/invite-cleanup.js";
import { markInvitedByName } from "../src/services/invite-queue.js";
import { updateRecruit } from "../src/services/recruiting-kit.js";

const now = new Date("2026-11-12T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
type Row = { id: string; guildId: string; status: string; cleanedAt: Date | null; cleanupAt: Date | null; channelId: string; messageId: string; discordUserId: string; notifyMessageId: string | null; doneNoteMessageId: string | null; cleanTries: number; nameKey: string; displayName: string };
const row = (over: Partial<Row> = {}): Row => ({ id: "r1", guildId: "g1", status: "INVITED", cleanedAt: null, cleanupAt: ago(1000), channelId: "chan", messageId: "100", discordUserId: "u1", notifyMessageId: "101", doneNoteMessageId: "102", cleanTries: 0, nameKey: "amy archer", displayName: "Amy Archer", ...over });

// A small in-memory table that really evaluates the filters the code uses (no mock that ignores `where`).
function matches(r: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, cond]) => {
    const value = (r as unknown as Record<string, unknown>)[key];
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as { in?: unknown[]; lte?: Date };
      if (c.in) return c.in.includes(value);
      if (c.lte) return value instanceof Date && value <= c.lte;
      return false;
    }
    return cond === null ? value === null : value === cond;
  });
}
function table(rows: Row[], settings: { inviteCleanupEnabled?: boolean } = {}) {
  const jobs: { key: string; kind: string; payload: unknown }[] = [];
  const database = {
    guildSettings: {
      findMany: vi.fn(async ({ where }: { where: { inviteCleanupEnabled: boolean } }) => (settings.inviteCleanupEnabled ?? true) === where.inviteCleanupEnabled ? [{ guildId: "g1" }] : []),
      findUnique: vi.fn(async () => ({ inviteCleanupEnabled: settings.inviteCleanupEnabled ?? true, inviteChannelId: "chan" }))
    },
    inviteRequest: {
      findMany: vi.fn(async ({ where, take }: { where: Record<string, unknown>; take?: number }) => rows.filter((r) => matches(r, where)).slice(0, take)),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => rows.find((r) => matches(r, where)) ?? null),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const hit = rows.filter((r) => matches(r, where));
        for (const r of hit) for (const [k, v] of Object.entries(data)) (r as unknown as Record<string, unknown>)[k] = v && typeof v === "object" && "increment" in v ? (r as unknown as Record<string, number>)[k]! + (v as { increment: number }).increment : v;
        return { count: hit.length };
      })
    },
    discordJob: { upsert: vi.fn(async ({ create }: { create: { key: string; kind: string; payload: unknown } }) => { jobs.push(create); return create; }) }
  };
  return { database, jobs, rows };
}

type Msg = { author: string; pinned?: boolean; deleteError?: number; fetchError?: number };
function guild(messages: Record<string, Msg>) {
  const deleted: string[] = [];
  const fetched: unknown[] = [];
  const live = new Map(Object.entries(messages).map(([id, m]) => [id, { id, pinned: Boolean(m.pinned), author: { id: m.author }, delete: vi.fn(async () => { if (m.deleteError) throw Object.assign(new Error("x"), { code: m.deleteError }); deleted.push(id); live.delete(id); }) }]));
  const channel = { isTextBased: () => true, messages: { fetch: vi.fn(async (id: unknown) => {
    fetched.push(id);
    const m = messages[String(id)];
    if (m?.fetchError) throw Object.assign(new Error("net"), { code: m.fetchError });
    const found = live.get(String(id));
    if (!found) throw Object.assign(new Error("gone"), { code: 10008 });
    return found;
  }) } };
  return { g: { channels: { fetch: vi.fn(async () => channel) }, client: { user: { id: "bot" } } }, deleted, fetched };
}
const job = (attempts = 1) => ({ guildId: "g1", attempts, payload: { requestId: "r1" } as never });

beforeEach(() => { resetCleanupWarnings(); vi.spyOn(console, "warn").mockImplementation(() => undefined); });

describe("scheduling (the clean-up is queued, not run inline)", () => {
  it("queues only handled requests that are due: not pending, not early, not backfilled, not without a deadline", async () => {
    const t = table([row(), row({ id: "p", status: "PENDING", cleanupAt: null }), row({ id: "early", cleanupAt: new Date(now.getTime() + 60_000) }),
      row({ id: "old", cleanedAt: ago(5000) }), row({ id: "guess", cleanupAt: null })]);
    expect(await scheduleInviteCleanups(t.database as never, now)).toBe(1);
    expect(t.jobs).toHaveLength(1);
    expect(t.jobs[0]).toMatchObject({ kind: "INVITE_CLEANUP", payload: { requestId: "r1" } });
    expect(t.rows.find((r) => r.id === "r1")!.cleanedAt).toEqual(now);
    // a second sweep (or a restart) does not queue it again
    expect(await scheduleInviteCleanups(t.database as never, now)).toBe(0);
  });
  it("queues nothing when the officer switch is off", async () => {
    const t = table([row()], { inviteCleanupEnabled: false });
    expect(await scheduleInviteCleanups(t.database as never, now)).toBe(0);
    expect(t.jobs).toHaveLength(0);
  });
  it("starts the clock only on a full name match or an officer action, never on a first-name-only roster guess", async () => {
    const waiting = () => table([row({ status: "PENDING", cleanupAt: null, nameKey: "amy archer" })]);
    const full = waiting();
    await markInvitedByName(full.database as never, "g1", ["Amy Archer-Realm"], "roster");
    expect(full.rows[0]).toMatchObject({ status: "INVITED" });
    expect(full.rows[0]!.cleanupAt!.getTime()).toBeGreaterThan(Date.now() + CLEANUP_DELAY_MS - 5000);
    const guess = waiting();
    await markInvitedByName(guess.database as never, "g1", ["Amy"], "roster");
    expect(guess.rows[0]).toMatchObject({ status: "INVITED", cleanupAt: null });
    const officer = waiting();
    await markInvitedByName(officer.database as never, "g1", ["Amy"], "officer-id");
    expect(officer.rows[0]!.cleanupAt).not.toBeNull();
    const record = waiting();
    await updateRecruit(record.database as never, "g1", "Amy Archer", { stage: "JOINED" });
    expect(record.rows[0]!.cleanupAt).not.toBeNull();
  });
});

describe("the queued job deletes by stored ids only", () => {
  it("removes the request post, the tag message and the thank-you, and nothing else (no history scan)", async () => {
    const t = table([row()]);
    const { g, deleted, fetched } = guild({ "100": { author: "u1" }, "101": { author: "bot" }, "102": { author: "bot" }, "103": { author: "officer" } });
    await runInviteCleanupJob(g as never, t.database as never, job(), now);
    expect(deleted.sort()).toEqual(["100", "101", "102"]);
    expect(fetched.every((id) => typeof id === "string")).toBe(true);
  });
  it("deletes the bot's own request post, and leaves a pinned post and someone else's post", async () => {
    const own = guild({ "100": { author: "bot" } });
    await runInviteCleanupJob(own.g as never, table([row({ notifyMessageId: null, doneNoteMessageId: null })]).database as never, job(), now);
    expect(own.deleted).toEqual(["100"]);
    const other = guild({ "100": { author: "u1", pinned: true }, "101": { author: "officer" } });
    await runInviteCleanupJob(other.g as never, table([row()]).database as never, job(), now);
    const foreign = guild({ "100": { author: "stranger" } });
    await runInviteCleanupJob(foreign.g as never, table([row({ notifyMessageId: null, doneNoteMessageId: null })]).database as never, job(), now);
    expect(other.deleted).toEqual([]);
    expect(foreign.deleted).toEqual([]);
  });
  it("a request from another channel, or with the switch off at delivery, is left alone", async () => {
    const moved = guild({ "100": { author: "u1" } });
    await runInviteCleanupJob(moved.g as never, table([row({ channelId: "old" })]).database as never, job(), now);
    const off = guild({ "100": { author: "u1" } });
    await runInviteCleanupJob(off.g as never, table([row()], { inviteCleanupEnabled: false }).database as never, job(), now);
    expect(moved.deleted).toEqual([]);
    expect(off.deleted).toEqual([]);
  });
  it("an already-deleted message is fine (no retry)", async () => {
    const t = table([row()]);
    await expect(runInviteCleanupJob(guild({}).g as never, t.database as never, job(), now)).resolves.toBeUndefined();
  });
});

describe("failures are retried by the queue, boundedly", () => {
  it("throws on a missing permission while attempts remain (the queue backs off), keeping the request marked for retry", async () => {
    const t = table([row()]);
    const { g, deleted } = guild({ "100": { author: "u1", deleteError: 50013 } });
    await expect(runInviteCleanupJob(g as never, t.database as never, job(1), now)).rejects.toThrow("permission");
    expect(deleted).toEqual([]);
    // later, with the permission granted, the same job succeeds
    const fixed = guild({ "100": { author: "u1" } });
    await runInviteCleanupJob(fixed.g as never, t.database as never, job(2), now);
    expect(fixed.deleted).toEqual(["100"]);
  });
  it("a transient read failure is retried too", async () => {
    const t = table([row()]);
    await expect(runInviteCleanupJob(guild({ "100": { author: "u1", fetchError: 500 } }).g as never, t.database as never, job(1), now)).rejects.toThrow("transient");
  });
  it("after the quick retries a permission refusal is queued again tomorrow, a few times, then dropped; one log line", async () => {
    const t = table([row({ cleanedAt: now })]);
    const refuse = () => guild({ "100": { author: "u1", deleteError: 50013 } }).g as never;
    await runInviteCleanupJob(refuse(), t.database as never, job(MAX_ATTEMPTS), now);
    expect(t.rows[0]).toMatchObject({ cleanedAt: null, cleanTries: 1 });
    expect(t.rows[0]!.cleanupAt).toEqual(new Date(now.getTime() + RETRY_LATER_MS));
    t.rows[0]!.cleanTries = MAX_CYCLES - 1;
    t.rows[0]!.cleanedAt = now;
    await runInviteCleanupJob(refuse(), t.database as never, job(MAX_ATTEMPTS), now);
    expect(t.rows[0]!.cleanedAt).toEqual(now); // dropped, not rescheduled
    expect(console.warn).toHaveBeenCalledTimes(2); // the permission line once, the give-up line once
  });
});
