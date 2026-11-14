import { describe, expect, it, vi } from "vitest";

// N members of one guild asking at once: the guild-wide snapshot is read once, each member gets their own ledger refs.
const counts = new Map<string, number>();
const hit = (key: string) => counts.set(key, (counts.get(key) ?? 0) + 1);
vi.mock("../src/database.js", () => {
  const empty = (model: string) => new Proxy({}, { get: (_, method) => async () => { hit(`${model}.${String(method)}`); await new Promise((resolve) => setTimeout(resolve, 20)); const m = String(method);
    return m === "findMany" || m === "groupBy" ? [] : m.startsWith("aggregate") ? {} : m === "count" ? 0 : null; } });
  const prisma: Record<string, unknown> = new Proxy({}, { get: (_, model) => {
    if (typeof model !== "string") return undefined;
    if (model === "$transaction") return async (fn: (tx: unknown) => unknown, options?: { isolationLevel?: string }) => { hit(`$transaction:${options?.isolationLevel ?? "default"}`); return fn(prisma); };
    if (model.startsWith("$")) return async () => [];
    return empty(model);
  } });
  return { prisma, createPrismaClient: () => prisma };
});

describe("standingsParts wiring", () => {
  it("makes one snapshot read for several members of a guild and one ledger-refs read per member", async () => {
    const { standingsParts } = await import("../src/companion-api.js");
    const { markGuildChanged } = await import("../src/services/standings-feed.js");
    const guild = { id: "g1", discordId: "d1" };
    const members = ["m1", "m2", "m3", "m4"];
    counts.clear();
    await standingsParts(guild, { memberId: "solo", actorId: "a-solo" });
    const oneMember = new Map(counts);
    markGuildChanged("g1"); // a change: the first run's reads are not reused
    counts.clear();
    const parts = await Promise.all(members.map((memberId) => standingsParts(guild, { memberId, actorId: `a-${memberId}` })));
    expect(parts).toHaveLength(4);
    // One consistent snapshot for the whole guild, however many members ask at once.
    expect(oneMember.get("$transaction:RepeatableRead")).toBe(1);
    expect(counts.get("$transaction:RepeatableRead")).toBe(1);
    // Everything else the guild reads is made once too: each extra member adds only their own reads of the ledger (their ledger refs
    // and their own views), never the guild-wide ones.
    const extra = members.length - 1;
    expect(counts.get("epgpTransaction.findMany")! - oneMember.get("epgpTransaction.findMany")!).toBeLessThanOrEqual(3 * extra);
    expect(counts.get("dungeonRun.findMany")).toBe(oneMember.get("dungeonRun.findMany"));
  }, 60_000);
});
