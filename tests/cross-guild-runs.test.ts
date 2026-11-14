import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stored: { guildId: string; run: unknown; characters: { memberId: string }[] }[] = [];
vi.mock("../src/services/dungeon-import.js", async (original) => ({
  ...await original<typeof import("../src/services/dungeon-import.js")>(),
  importSharedRun: vi.fn(async (_tx: unknown, guildId: string, run: unknown, characters: { memberId: string }[]) => {
    stored.push({ guildId, run, characters });
    return { results: [{ runRef: (run as { id: string }).id, valid: true, state: "COMPLETED" }] };
  })
}));

import { guildsWithMembersIn, shareRuns } from "../src/services/cross-guild-runs.js";
import { dungeonRunSchema } from "../src/services/dungeon-rules.js";

const start = Math.floor(new Date("2026-11-13T18:00:00Z").getTime() / 1000);
const now = new Date("2026-11-13T20:00:00Z");
const run = (id: string, overrides: Record<string, unknown> = {}) => ({
  id, protocolVersion: 1, state: "COMPLETED", instanceId: 36, name: "Deadmines", difficultyId: 1, startedAt: start, endedAt: start + 1500, reporters: 1,
  completedBy: "final boss", reporterNames: ["Kev"],
  players: ["Kev", "Bob", "Amy", "Zed", "Liz"].map((character) => ({ character, realm: "Forever", deaths: 0, presentSec: 1500, inGuild: true, level: 20, minLevel: 20, guild: character === "Kev" ? "Alpha" : "Beta" })),
  ...overrides
});

// Guild rosters: g-beta has Bob and Amy, g-gamma has Zed (its switch is off), g-delta has a "Bobby" (a different player), g-origin has Kev.
const rosters = [
  { guildId: "g-origin", id: "c1", name: "Kev", realm: "Forever", memberId: "m1", spec: null, displayName: null, gameEdition: "forever", member: { discordUserId: "u1" } },
  { guildId: "g-beta", id: "c2", name: "Bob", realm: "Forever", memberId: "m2", spec: null, displayName: null, gameEdition: "forever", member: { discordUserId: "u2" } },
  { guildId: "g-beta", id: "c3", name: "Amy", realm: "Forever", memberId: "m3", spec: null, displayName: null, gameEdition: "forever", member: { discordUserId: "u3" } },
  { guildId: "g-gamma", id: "c4", name: "Zed", realm: "Forever", memberId: "m4", spec: null, displayName: null, gameEdition: "forever", member: { discordUserId: "u4" } },
  { guildId: "g-delta", id: "c5", name: "Bobby", realm: "Forever", memberId: "m5", spec: null, displayName: null, gameEdition: "forever", member: { discordUserId: "u5" } }
];

function fakeDatabase(off: string[] = ["g-gamma"]) {
  return {
    character: { findMany: vi.fn(async ({ where }: { where: { guildId?: { not: string }; OR: { name: { startsWith: string } }[] } }) =>
      rosters.filter((row) => (!where.guildId || row.guildId !== where.guildId.not) && where.OR.some((clause) => row.name.toLowerCase().startsWith(clause.name.startsWith))).map((row) => ({ ...row }))) },
    guildSettings: { findMany: vi.fn(async ({ where }: { where: { guildId: { in: string[] } } }) => where.guildId.in.filter((id) => off.includes(id)).map((guildId) => ({ guildId }))) },
    guild: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({ name: `Guild ${where.id}`, gameEdition: "forever", discordId: `d-${where.id}` })) },
    $transaction: vi.fn(async (work: (tx: unknown) => unknown) => work({}))
  };
}

beforeEach(() => { stored.length = 0; });
afterEach(() => { delete process.env["RUN_INTEGRITY_CONFIG"]; });

describe("cross-guild run sharing", () => {
  it("finds other guilds by their own roster, not by what the run says, and honours the guild's switch", async () => {
    const parsed = dungeonRunSchema.parse(run("QG-X1"));
    const found = await guildsWithMembersIn(fakeDatabase() as never, parsed, "g-origin");
    expect([...found.keys()]).toEqual(["g-beta"]);
    expect(found.get("g-beta")!.map((character) => character.name).sort()).toEqual(["Amy", "Bob"]);
    expect(found.has("g-delta")).toBe(false);
    const all = await guildsWithMembersIn(fakeDatabase() as never, parsed, null);
    expect([...all.keys()].sort()).toEqual(["g-beta", "g-origin"]);
  });

  it("stores a finished run once in each other guild with its own members only, and returns the cards to post", async () => {
    const shared = await shareRuns(fakeDatabase() as never, "g-origin", [run("QG-X2")], now);
    expect(stored.map((entry) => entry.guildId)).toEqual(["g-beta"]);
    expect(stored[0]!.characters.map((character) => character.memberId).sort()).toEqual(["m2", "m3"]);
    expect(shared).toHaveLength(1);
    expect(shared[0]).toMatchObject({ guildId: "g-beta", discordId: "d-g-beta" });
  });

  it("shares nothing for runs that are not finished, were only carried through a group, or have no reporter's statement behind them", async () => {
    const database = fakeDatabase();
    await shareRuns(database as never, "g-origin", [run("QG-X3", { state: "ABANDONED" }), run("QG-X4", { viaGroup: true }), run("QG-X5", { reporterNames: undefined, reporters: 0 })], now);
    expect(stored).toEqual([]);
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  it("takes its thresholds from the server configuration", async () => {
    process.env["RUN_INTEGRITY_CONFIG"] = JSON.stringify({ crossGuildMinReporters: 2 });
    await shareRuns(fakeDatabase() as never, "g-origin", [run("QG-X6")], now);
    expect(stored).toEqual([]);
    await shareRuns(fakeDatabase() as never, "g-origin", [run("QG-X7", { reporterNames: ["Kev", "Bob"] })], now);
    expect(stored.map((entry) => entry.guildId)).toEqual(["g-beta"]);
    stored.length = 0;
    process.env["RUN_INTEGRITY_CONFIG"] = JSON.stringify({ crossGuildMaxGuilds: 1 });
    await shareRuns(fakeDatabase([]) as never, "g-origin", [run("QG-X8")], now);
    expect(stored).toHaveLength(1);
  });

  it("never throws when a guild cannot store the run, and keeps going with the others", async () => {
    const database = fakeDatabase([]);
    database.$transaction.mockRejectedValueOnce(new Error("boom"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const shared = await shareRuns(database as never, "g-origin", [run("QG-X9")], now);
    expect(shared.map((item) => item.guildId)).toEqual(["g-gamma"]);
    error.mockRestore();
  });
});
