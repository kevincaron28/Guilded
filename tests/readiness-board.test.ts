import { describe, expect, it, vi } from "vitest";
import { buildReadinessLines, chunkLines, queueDailyReadiness } from "../src/services/readiness-board.js";
import { dispatchDiscordJob } from "../src/services/discord-jobs.js";
import type { DiscordJob } from "../src/generated/prisma/client.js";

describe("readiness board", () => {
  it("keeps one durable summary per guild-local day without resetting delivered jobs", async () => {
    const rows = new Map<string, Record<string, unknown>>();
    const upsert = vi.fn(async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
      const key = `${create["guildId"]}:${create["key"]}`;
      const row = rows.get(key);
      if (row) { Object.assign(row, update); return row; }
      const fresh = { ...create, id: key, status: "PENDING" }; rows.set(key, fresh); return fresh;
    });
    const db = { discordJob: { upsert } } as never;
    const first = await queueDailyReadiness(db, "guild", "America/Toronto", ["First report"], new Date("2026-10-14T02:00:00Z"));
    expect(first.key).toBe("readiness:2026-10-13");
    first.status = "DONE";
    const repeated = await queueDailyReadiness(db, "guild", "America/Toronto", ["New import"], new Date("2026-10-14T03:59:59Z"));
    expect(repeated.status).toBe("DONE");
    expect(JSON.stringify(repeated.payload)).toContain("First report");
    await queueDailyReadiness(db, "guild", "America/Toronto", ["Next day"], new Date("2026-10-14T04:00:00Z"));
    await queueDailyReadiness(db, "other", "America/Toronto", ["Other guild"], new Date("2026-10-14T04:00:00Z"));
    expect(rows.size).toBe(3);
  });

  it("fits a large automatic board into one message and points to the full private report", async () => {
    const upsert = vi.fn(async (args: unknown) => args);
    await queueDailyReadiness({ discordJob: { upsert } } as never, "guild", "America/Toronto", Array(100).fill("x".repeat(100)));
    const args = upsert.mock.calls[0]![0] as { create: { payload: { message: { embeds: { description: string }[] } } } };
    expect(args.create.payload.message.embeds).toHaveLength(1);
    const text = args.create.payload.message.embeds[0]!.description;
    expect(text.length).toBeLessThan(4096);
    expect(text).toContain("/readiness raid");
  });

  it("discards yesterday's delayed summary instead of sending it alongside today's", async () => {
    const fetch = vi.fn();
    await dispatchDiscordJob({ channels: { fetch } } as never, {
      id: "job", guildId: "guild", status: "PENDING", revision: 1, attempts: 0,
      createdAt: new Date(0), updatedAt: new Date(0), nextAttemptAt: new Date(0),
      leaseToken: null, lockedUntil: null, lastError: null, deliveredAt: null,
      key: "readiness:2000-01-01", kind: "MESSAGE", payload: { route: "readiness", day: "2000-01-01", timezone: "America/Toronto" }
    } satisfies DiscordJob);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("one line for ready players, problems listed for the rest, unknown for no check", async () => {
    const snapshots: Record<string, unknown> = {
      m1: { status: "READY", itemLevel: 62, character: { name: "Bob" }, findings: [{ severity: "INFO", message: "Required gear slots are populated." }] },
      m2: { status: "NOT_READY", itemLevel: null, character: { name: "Amy" }, findings: [{ severity: "ERROR", message: "Missing Head equipment." }] }
    };
    const database = {
      member: { findMany: async () => [{ id: "m1", displayName: "Bob" }, { id: "m2", displayName: "Amy" }, { id: "m3", displayName: "Cy" }] },
      inspectedCharacterSnapshot: { findFirst: async ({ where }: { where: { memberId: string } }) => snapshots[where.memberId] ?? null }
    };
    const lines = await buildReadinessLines(database as never, "g1");
    // A summary first, then most actionable first: not ready, no data, ready.
    expect(lines[0]).toBe("**1 ready · 0 with issues · 1 not ready · 1 no data**");
    expect(lines[1]).toContain("❌ **Amy** — NOT_READY");
    expect(lines[1]).toContain("Missing Head equipment.");
    expect(lines[2]).toContain("Cy");
    expect(lines[2]).toContain("no gear check");
    expect(lines[3]).toBe("✅ **Bob** — READY · ilvl 62");
  });

  it("with a target attunement, flags members without it as not ready", async () => {
    const database = {
      member: { findMany: async () => [{ id: "m1", displayName: "Bob" }, { id: "m2", displayName: "Amy" }] },
      inspectedCharacterSnapshot: {
        findFirst: async ({ where }: { where: { memberId: string } }) => ({ status: "READY", itemLevel: 60, characterId: where.memberId === "m1" ? "c1" : "c2", character: { name: where.memberId === "m1" ? "Bob" : "Amy" }, findings: [] })
      },
      characterAttunement: { findFirst: async ({ where }: { where: { characterId: string } }) => (where.characterId === "c1" ? { id: "a" } : null) }
    };
    const lines = await buildReadinessLines(database as never, "g1", { attunement: "Onyxia Key" });
    expect(lines[0]).toContain("1 ready · 0 with issues · 1 not ready");
    expect(lines[0]).toContain("target: Onyxia Key");
    expect(lines[1]).toContain("❌ **Amy** — NOT_READY");
    expect(lines[1]).toContain("Not attuned: Onyxia Key.");
    expect(lines[2]).toContain("✅ **Bob**");
  });

  it("splits long boards under Discord's message limit", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i} ${"x".repeat(40)}`);
    const chunks = chunkLines(lines, 500);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(500);
    expect(chunks.join("\n").split("\n")).toHaveLength(100);
  });
});

import { buildConsumableLines } from "../src/services/readiness-board.js";
import { parseAddonSnapshot } from "../src/integrations/addon.js";

describe("consumable scan", () => {
  const now = new Date("2026-10-01T20:00:00Z");
  const scannedAt = new Date("2026-10-01T19:48:00Z");

  it("lists who lacks a flask/elixir or food from the latest scan", async () => {
    const rows = [
      { character: "Amy", flask: "Flask of the Titans", elixirs: [], food: null, scannedAt },
      { character: "Bob", flask: null, elixirs: ["Elixir of the Mongoose"], food: "Well Fed", scannedAt },
      { character: "Cy", flask: null, elixirs: [], food: "Well Fed", scannedAt }
    ];
    const lines = await buildConsumableLines({ consumableCheck: { findMany: async () => rows } } as never, "g1", now);
    expect(lines[0]).toContain("3 scanned 12 min ago");
    expect(lines[1]).toContain("No flask/elixir: Cy");
    expect(lines[2]).toContain("No food: Amy");
  });

  it("says nobody when everyone is covered, and nothing without a fresh scan", async () => {
    const covered = [{ character: "Amy", flask: "Flask of Power", elixirs: [], food: "Well Fed", scannedAt }];
    const lines = await buildConsumableLines({ consumableCheck: { findMany: async () => covered } } as never, "g1", now);
    expect(lines[1]).toContain("nobody");
    expect(lines[2]).toContain("nobody");
    expect(await buildConsumableLines({ consumableCheck: { findMany: async () => [] } } as never, "g1", now)).toEqual([]);
  });

  it("accepts the export's consumeScan block", () => {
    const parsed = parseAddonSnapshot({
      source: "Guilded", exportedAt: "2026-10-01T20:00:00Z",
      consumeScan: { at: "2026-10-01T19:48:00Z", by: "Kev", players: [{ character: "Amy", realm: "R", flask: "Flask of Power", elixirs: [] }] }
    });
    expect(parsed.consumeScan?.players).toHaveLength(1);
  });
});
