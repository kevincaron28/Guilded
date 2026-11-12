import { describe, expect, it, vi } from "vitest";
import { MISSING_PERMISSIONS, sweepInviteChannel, sweepSummary } from "../src/services/invite-cleanup.js";

// /mod invites tidy sweeps the invite channel's history: the bot's own old messages (even with no database row), and with
// members:true members' posts older than 24 hours. Pinned, the guide and messages of requests still in play are never touched.

const NOW = new Date("2026-11-12T12:00:00Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ME = "bot";

type Spec = { id: string; author: string; age: number; pinned?: boolean; deleteError?: number };

function setup(specs: Spec[], rows: Array<{ messageId: string; notifyMessageId?: string | null; doneNoteMessageId?: string | null }> = [], opts: { fetchError?: number; bulkError?: number } = {}) {
  const gone: string[] = [];
  const bulk: string[][] = [];
  const single: string[] = [];
  const messages = specs.map((spec) => ({
    id: spec.id, pinned: Boolean(spec.pinned), createdTimestamp: NOW.getTime() - spec.age, author: { id: spec.author },
    delete: vi.fn(async () => {
      if (spec.deleteError) throw Object.assign(new Error("x"), { code: spec.deleteError });
      single.push(spec.id); gone.push(spec.id);
    })
  }));
  const fetchCalls: unknown[] = [];
  const channel = {
    isTextBased: () => true,
    messages: {
      fetch: vi.fn(async (options: { limit: number; before?: string }) => {
        fetchCalls.push(options);
        if (opts.fetchError) throw Object.assign(new Error("no"), { code: opts.fetchError });
        const start = options.before ? messages.findIndex((m) => m.id === options.before) + 1 : 0;
        const slice = messages.slice(start, start + options.limit);
        return { size: slice.length, values: () => slice, last: () => slice[slice.length - 1] };
      })
    },
    bulkDelete: vi.fn(async (ids: string[]) => {
      if (opts.bulkError) throw Object.assign(new Error("no"), { code: opts.bulkError });
      bulk.push(ids); gone.push(...ids);
      return { size: ids.length };
    })
  };
  const guild = { channels: { fetch: vi.fn(async () => channel) }, client: { user: { id: ME } } };
  const database = { inviteRequest: { findMany: vi.fn(async () => rows.map((r) => ({ notifyMessageId: null, doneNoteMessageId: null, ...r }))) } };
  return { guild: guild as never, database: database as never, channel, gone, bulk, single, fetchCalls, messages };
}

const run = (env: ReturnType<typeof setup>, options: Parameters<typeof sweepInviteChannel>[5] = {}) =>
  sweepInviteChannel(env.guild, env.database, "g1", "chan", "guide", { now: NOW, confirm: true, sleep: async () => undefined, ...options });

describe("the invite channel sweep", () => {
  it("deletes the bot's own old clutter even with no database row, and keeps protected and fresh messages", async () => {
    const env = setup([
      { id: "fresh-bot", author: ME, age: 30 * 60_000 },        // newer than 2 h: kept
      { id: "guide", author: ME, age: 5 * DAY },                 // the pinned guide: kept
      { id: "pinned-bot", author: ME, age: 5 * DAY, pinned: true },
      { id: "pending-post", author: "u1", age: 3 * DAY },        // a PENDING row's post: kept
      { id: "pending-tag", author: ME, age: 3 * DAY },           // its tag message: kept
      { id: "handled-note", author: ME, age: 3 * DAY },          // a handled row not cleaned yet: kept
      { id: "old-thanks", author: ME, age: 3 * DAY },            // no row: deleted
      { id: "old-hint", author: ME, age: 5 * HOUR },             // no row: deleted
      { id: "old-member", author: "u2", age: 3 * DAY }           // a member's: kept by default
    ], [{ messageId: "pending-post", notifyMessageId: "pending-tag" }, { messageId: "x", doneNoteMessageId: "handled-note" }]);
    const result = await run(env);
    expect(env.gone.sort()).toEqual(["old-hint", "old-thanks"]);
    expect(result).toMatchObject({ status: "ok", mine: 2, memberOld: 1, memberFresh: 0, protectedCount: 5, deleted: 2, capped: false });
  });

  it("previews without deleting", async () => {
    const env = setup([{ id: "a", author: ME, age: 5 * HOUR }, { id: "b", author: "u2", age: 2 * DAY }]);
    const result = await run(env, { confirm: false });
    expect(env.gone).toEqual([]);
    expect(result).toMatchObject({ mine: 1, memberOld: 1, deleted: 0 });
    expect(sweepSummary("chan", result, false, false)).toContain("1 of mine older than 2 hours can be removed");
    expect(sweepSummary("chan", result, false, false)).toContain("members:true");
  });

  it("keeps members' posts by default, and deletes them with the option only when older than 24 hours", async () => {
    const specs = [
      { id: "m-new", author: "u2", age: 23 * HOUR },
      { id: "m-old", author: "u2", age: 25 * HOUR },
      { id: "m-pin", author: "u3", age: 9 * DAY, pinned: true },
      { id: "m-ancient", author: "u4", age: 30 * DAY }
    ];
    const without = setup(specs);
    await run(without);
    expect(without.gone).toEqual([]);
    const withOption = setup(specs);
    const result = await run(withOption, { members: true });
    expect(withOption.gone.sort()).toEqual(["m-ancient", "m-old"]);
    expect(result).toMatchObject({ memberOld: 2, memberFresh: 1, protectedCount: 1, deleted: 2 });
  });

  it("stops at the cap and says so, so the officer can run it again", async () => {
    const specs = Array.from({ length: 250 }, (_, i) => ({ id: `b${String(i).padStart(3, "0")}`, author: ME, age: 3 * DAY + i }));
    const env = setup(specs);
    const result = await run(env, { cap: 120 });
    expect(result).toMatchObject({ scanned: 120, capped: true, mine: 120, deleted: 120 });
    expect(env.fetchCalls).toHaveLength(2);
    expect(sweepSummary("chan", result, false, true)).toContain("run it again");
    // The default cap is 1000 messages.
    const big = setup(Array.from({ length: 1100 }, (_, i) => ({ id: `c${i}`, author: "u2", age: 3 * DAY + i })));
    expect(await run(big, { confirm: false })).toMatchObject({ scanned: 1000, capped: true });
  });

  it("bulk deletes under 14 days (in chunks of 100) and deletes older messages one by one, throttled", async () => {
    const young = Array.from({ length: 150 }, (_, i) => ({ id: `y${i}`, author: ME, age: 2 * DAY + i }));
    const old = [{ id: "o1", author: ME, age: 20 * DAY }, { id: "o2", author: ME, age: 40 * DAY }];
    const env = setup([...young, ...old]);
    const sleep = vi.fn(async () => undefined);
    const result = await run(env, { sleep });
    expect(env.bulk.map((ids) => ids.length)).toEqual([100, 50]);
    expect(env.single).toEqual(["o1", "o2"]);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(result.deleted).toBe(152);
    // A lone young message is a single delete (Discord needs two for a bulk delete).
    const one = setup([{ id: "solo", author: ME, age: 3 * DAY }]);
    await run(one);
    expect(one.bulk).toEqual([]);
    expect(one.single).toEqual(["solo"]);
  });

  it("tolerates a message that is already gone, and falls back to single deletes when a bulk delete fails", async () => {
    const env = setup([{ id: "a", author: ME, age: 3 * DAY, deleteError: 10008 }, { id: "b", author: ME, age: 3 * DAY }], [], { bulkError: 50035 });
    const result = await run(env);
    expect(result.status).toBe("ok");
    expect(env.single).toEqual(["b"]);
    expect(result.deleted).toBe(1);
  });

  it("says plainly which permission is missing", async () => {
    const readable = setup([{ id: "a", author: ME, age: 3 * DAY }], [], { fetchError: 50013 });
    const denied = await run(readable);
    expect(denied.status).toBe("permission");
    expect(sweepSummary("chan", denied, false, true)).toContain(MISSING_PERMISSIONS);
    const deleting = setup([{ id: "a", author: ME, age: 3 * DAY, deleteError: 50013 }, { id: "b", author: ME, age: 40 * DAY, deleteError: 50013 }]);
    const refused = await run(deleting, { cap: 10 });
    expect(refused.status).toBe("permission");
    expect(sweepSummary("chan", refused, false, true)).toContain("Manage Messages");
    const bulkRefused = setup([{ id: "a", author: ME, age: 3 * DAY }, { id: "b", author: ME, age: 3 * DAY }], [], { bulkError: 50013 });
    expect((await run(bulkRefused)).status).toBe("permission");
  });

  it("reports an unreadable channel", async () => {
    const env = setup([]);
    (env.guild as unknown as { channels: { fetch: () => Promise<unknown> } }).channels.fetch = async () => { throw Object.assign(new Error("gone"), { code: 10003 }); };
    const result = await run(env);
    expect(result.status).toBe("unreadable");
    expect(sweepSummary("chan", result, false, false)).toContain("cannot read");
  });

  it("stops deleting when the time budget is used up and says so", async () => {
    const env = setup(Array.from({ length: 3 }, (_, i) => ({ id: `o${i}`, author: ME, age: (20 + i) * DAY })));
    const result = await run(env, { budgetMs: -1 });
    expect(result).toMatchObject({ capped: true, deleted: 0 });
  });
});
