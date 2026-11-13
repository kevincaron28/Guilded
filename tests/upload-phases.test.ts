import { describe, expect, it, vi } from "vitest";

// 12 Nov 2026: uploads passed the Worker's 20 s limit while the database was idle: the handler awaited Discord side
// effects (cards, notices, directory refreshes). The response must never wait on them, and each upload logs its phases.
const mocks = vi.hoisted(() => ({
  apply: vi.fn(async () => ({ epgpTransactions: [{}], readinessSnapshots: [], discovery: { discovered: 2 }, held: { rows: [] }, voided: 0, rejected: [] })),
  followUp: vi.fn(() => new Promise<void>(() => { /* Discord never answers */ })),
  fetchGuild: vi.fn(() => new Promise(() => { /* never resolves */ })),
  requests: {} as Record<string, { threadId: string | null; orderMessageId: string | null; status: string }>
}));
vi.mock("../src/database.js", () => ({ prisma: { craftRequest: { findUnique: async ({ where }: { where: { id: string } }) => mocks.requests[where.id] ?? null } } }));
vi.mock("../src/config.js", () => ({ config: { COMPANION_API_PORT: 0, COMPANION_API_HOST: "127.0.0.1" } }));
vi.mock("../src/services/import-followup.js", () => ({ followUpImport: mocks.followUp }));
vi.mock("../src/services/addon-import.js", async (original) => ({
  ...await original<typeof import("../src/services/addon-import.js")>(),
  createAddonImportService: () => ({ apply: mocks.apply })
}));
vi.mock("../src/services/audit.js", async (original) => ({
  ...await original<typeof import("../src/services/audit.js")>(),
  createAuditService: () => ({ record: async () => undefined })
}));

import { autoApplyImportWith, createUploadTimer, craftRequestNeedsPost, inBackground, inGuildBackground, raceDeadline, startApplyLane } from "../src/companion-api.js";
import { snapshotChecksum } from "../src/services/addon-import.js";

describe("uploads never wait on Discord", () => {
  it("returns the import counts at once while the Discord follow-up never finishes", async () => {
    const client = { guilds: { fetch: mocks.fetchGuild } };
    const answer = await Promise.race([
      autoApplyImportWith({ guildId: "g", discordId: "d", importId: "i", createdBy: "u", since: new Date(), retried: false, client: client as never }),
      new Promise((resolve) => setTimeout(() => resolve("waited on Discord"), 1500))
    ]);
    expect(answer).toEqual({ epgp: 1, discovered: 2, held: 0, voided: 0, rejected: 0 });
  });

  it("a background side effect that never resolves or throws does not hold or break the caller", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    inBackground("Never", () => new Promise(() => undefined));
    inBackground("Broken", async () => { throw new Error("discord is down"); });
    const started = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(Date.now() - started).toBeLessThan(500);
    expect(warn).toHaveBeenCalledWith("Broken failed", expect.any(Error));
    warn.mockRestore();
  });
});

describe("the upload timing line", () => {
  const sum = (line: string) => [...(/phases=(.*)$/.exec(line)?.[1] ?? "").matchAll(/:(\d+)/g)].reduce((n, m) => n + Number(m[1]), 0);
  const total = (line: string) => Number(/total=(\d+)/.exec(line)?.[1]);

  it("lists only phases over 200 ms plus other, with a short hash of the guild and no names", async () => {
    const timer = createUploadTimer();
    await timer.time("fast", async () => 1);
    await timer.time("slow", () => new Promise((resolve) => setTimeout(resolve, 260)));
    const line = timer.line("guild-internal-id-123", 4096, true);
    expect(line).toMatch(/^upload guild=[0-9a-f]{8} total=\d+ bytes=4096 officer=1 phases=slow:\d+,other:\d+$/);
    expect(line).not.toContain("guild-internal-id-123");
    expect(createUploadTimer().line("g", 0, false)).toMatch(/officer=0 phases=other:\d+$/);
  });

  it("attributes every millisecond: untimed waits between phases, the time before the timer started, and the tail", async () => {
    const started = Date.now() - 600;                 // 600 ms spent before the timer was created (body, auth)
    const timer = createUploadTimer(started);
    timer.mark("body", started + 300); timer.mark("auth", started + 600);
    await new Promise((resolve) => setTimeout(resolve, 250));   // an await nobody wrapped
    await timer.time("work", async () => undefined);
    timer.mark("settings");
    await new Promise((resolve) => setTimeout(resolve, 230));   // the tail after the last mark
    const line = timer.line("g", 1, false);
    expect(line).toContain("body:300");
    expect(line).toContain("auth:300");
    expect(line).toMatch(/before:work:2\d\d/);
    expect(sum(line)).toBe(total(line));
  });
});

describe("background work is serialized per guild", () => {
  it("runs one task at a time per guild, in order, and tells tasks past the cap of five to skip their refresh parts", async () => {
    const log: string[] = [];
    const releases: Array<() => void> = [];
    for (let i = 0; i < 7; i++) {
      inGuildBackground("g-cap", `Task ${i}`, (overCap) => new Promise<void>((resolve) => {
        log.push(`start ${i}${overCap ? " over" : ""}`);
        releases.push(() => { log.push(`end ${i}`); resolve(); });
      }));
    }
    inGuildBackground("g-other", "Other guild", async () => { log.push("other"); });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(log).toEqual(["start 0", "other"]);   // another guild is not held up
    for (let i = 0; i < 7; i++) {
      releases[i]!();
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(log.filter((l) => l.startsWith("start"))).toEqual(["start 0", "start 1", "start 2", "start 3", "start 4", "start 5 over", "start 6 over"]);
    // Drained: the next one is a normal task again.
    let overCap: boolean | undefined;
    inGuildBackground("g-cap", "After", async (over) => { overCap = over; });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(overCap).toBe(false);
  });
});

describe("a craft request made in game is posted once", () => {
  it("only a request with no forum post, no orders line and status OPEN is posted by a task that waited its turn", async () => {
    mocks.requests = {
      fresh: { threadId: null, orderMessageId: null, status: "OPEN" },
      posted: { threadId: "t1", orderMessageId: "m1", status: "OPEN" },
      ordersOnly: { threadId: null, orderMessageId: "m2", status: "OPEN" },
      closed: { threadId: null, orderMessageId: null, status: "CANCELLED" }
    };
    expect(await craftRequestNeedsPost("fresh")).toBe(true);
    expect(await craftRequestNeedsPost("posted")).toBe(false);
    expect(await craftRequestNeedsPost("ordersOnly")).toBe(false);
    expect(await craftRequestNeedsPost("closed")).toBe(false);
    expect(await craftRequestNeedsPost("missing")).toBe(false);
  });
});

describe("a long apply never holds the response, and retries do not pile up", () => {
  const tick = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

  it("raceDeadline answers null at the deadline while the work keeps running, and the result when it is fast", async () => {
    let finished = false;
    const slow = tick(150).then(() => { finished = true; return "done"; });
    const started = Date.now();
    expect(await raceDeadline(slow, 30)).toBeNull();
    expect(Date.now() - started).toBeLessThan(120);
    expect(finished).toBe(false);
    expect(await slow).toBe("done");               // the same promise: no second apply was started
    expect(await raceDeadline(Promise.resolve("fast"), 500)).toBe("fast");
  });

  it("one apply per lane: a newer upload replaces the waiting one (latest wins) and runs once after the first ends", async () => {
    const ran: string[] = [];
    const next: string[] = [];
    let release!: () => void;
    const run = async (job: string) => { ran.push(job); if (job === "first") await new Promise<void>((resolve) => { release = resolve; }); return job; };
    const first = startApplyLane("lane-a", "first", run, (outcome) => next.push(outcome));
    expect(first).not.toBeNull();
    expect(startApplyLane("lane-a", "second", run, (outcome) => next.push(outcome))).toBeNull();   // answered "received" at once
    expect(startApplyLane("lane-a", "third", run, (outcome) => next.push(outcome))).toBeNull();
    expect(startApplyLane("lane-b", "other", run, () => undefined)).not.toBeNull();                 // another uploader is not held
    await tick();
    expect(ran).toEqual(["first", "other"]);
    release();
    await first;
    await tick(30);
    expect(ran).toEqual(["first", "other", "third"]);   // "second" was superseded, "third" ran once
    expect(next).toEqual(["third"]);
    // The lane is free again.
    expect(startApplyLane("lane-a", "later", async (job) => job, () => undefined)).not.toBeNull();
  });
});

describe("an unchanged saved file dedupes", () => {
  const snapshot = (at: number, lastOnline: number) => ({
    source: "Guilded", exportedAt: new Date(at * 1000), epgpTransactions: [{ character: "Aria", sourceRef: "x1" }], readiness: [],
    guildRoster: { at, complete: true, members: [{ name: "Bob", online: false, lastOnline }] }, guildEvents: [{ at, text: "joined" }], guildInfo: { at, motd: "hi" }
  });

  it("the export stamp and the guild roster, events and MOTD (applied elsewhere, 'now minus age') do not change the checksum; real content does", () => {
    const base = snapshotChecksum(snapshot(1_800_000_000, 1_799_000_000) as never);
    expect(snapshotChecksum(snapshot(1_800_000_300, 1_799_000_300) as never)).toBe(base);
    const changed = { ...snapshot(1_800_000_000, 1_799_000_000), epgpTransactions: [{ character: "Aria", sourceRef: "x2" }] };
    expect(snapshotChecksum(changed as never)).not.toBe(base);
  });
});
