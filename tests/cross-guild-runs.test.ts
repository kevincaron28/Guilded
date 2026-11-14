import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls: { guildId: string; runs: { id: string; players: { character: string; inGuild: boolean }[] }[]; now: Date; source: Record<string, unknown> }[] = [];
let failFor: string | null = null;
vi.mock("../src/services/companion-device.js", () => ({
  storeDeviceRuns: vi.fn(async (_tx: unknown, guildId: string, runs: never[], now: Date, source: Record<string, unknown>) => {
    if (guildId === failFor) throw new Error("unique constraint");
    calls.push({ guildId, runs, now, source });
    return { stored: runs.length, skipped: 0, summaries: [{ results: [], duplicates: 0, malformed: 0 }] };
  })
}));

import { guildsWithMembersIn, localiseRun, shareRuns, type ShareOrigin } from "../src/services/cross-guild-runs.js";
import { dungeonRunSchema } from "../src/services/dungeon-rules.js";

const start = Math.floor(new Date("2026-11-13T18:00:00Z").getTime() / 1000);
const receivedAt = new Date("2026-11-13T20:00:00Z");
const names = ["Kev Alpha", "Bob Smith", "Amy Jones", "Zed Gamma", "Liz Nobody"];
const run = (id: string, overrides: Record<string, unknown> = {}) => ({
  id, protocolVersion: 1, state: "COMPLETED", instanceId: 36, name: "Deadmines", difficultyId: 1, startedAt: start, endedAt: start + 1500, reporters: 1,
  completedBy: "final boss", reporterNames: ["Kev Alpha"],
  players: names.map((character) => ({ character, realm: "Forever", deaths: 0, presentSec: 1500, inGuild: true, level: 20, minLevel: 20, guild: "Alpha" })),
  ...overrides
});
const origin = (over: Partial<ShareOrigin> = {}): ShareOrigin => ({ guildId: "g-origin", deviceId: null, characterKeys: ["kev alpha"], receivedAt, ...over });

interface Row { guildId: string; name: string; realm: string }
interface World { characters: Row[]; roster: { guildId: string; nameKey: string }[]; off: string[]; discord: Record<string, string | null>; held: string[]; excludedDevices: Record<string, string[]>; received: number }
const world = (over: Partial<World> = {}): World => ({
  characters: [
    { guildId: "g-origin", name: "Kev Alpha", realm: "Forever" },
    { guildId: "g-beta", name: "Bob Smith", realm: "Forever" }, { guildId: "g-beta", name: "Amy Jones", realm: "Forever" },
    { guildId: "g-gamma", name: "Zed Gamma", realm: "Forever" },
    { guildId: "g-delta", name: "Bob", realm: "Forever" }, { guildId: "g-delta", name: "Bob Smyth", realm: "Forever" },
    { guildId: "g-eps", name: "Liz Nobody", realm: "Forever" }
  ],
  roster: [{ guildId: "g-beta", nameKey: "bob smith" }, { guildId: "g-beta", nameKey: "amy jones" }, { guildId: "g-beta", nameKey: "kev alpha" }, { guildId: "g-gamma", nameKey: "zed gamma" }, { guildId: "g-delta", nameKey: "bob" }, { guildId: "g-origin", nameKey: "kev alpha" }],
  off: ["g-gamma"], discord: { "g-beta": "d-beta", "g-gamma": "d-gamma", "g-delta": "d-delta", "g-eps": "d-eps", "g-origin": "d-origin" }, held: [], excludedDevices: {}, received: 0, ...over
});

function fakeDatabase(w: World) {
  return {
    character: { findMany: vi.fn(async ({ where }: { where: { guildId?: { not: string }; OR: { name: { equals: string } }[] } }) =>
      w.characters.filter((row) => (!where.guildId || row.guildId !== where.guildId.not) && where.OR.some((clause) => row.name.toLowerCase() === clause.name.equals.toLowerCase()))) },
    guildRosterEntry: { findMany: vi.fn(async ({ where }: { where: { guildId: { in: string[] }; nameKey: { in: string[] } } }) => w.roster.filter((row) => where.guildId.in.includes(row.guildId) && where.nameKey.in.includes(row.nameKey))) },
    guildSettings: { findMany: vi.fn(async ({ where }: { where: { guildId: { in: string[] } } }) => where.guildId.in.filter((id) => w.off.includes(id)).map((guildId) => ({ guildId }))) },
    guild: { findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => ({ id, name: `Guild ${id}`, gameEdition: "forever", discordId: w.discord[id] ?? "" }))) },
    companionDevice: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({ excludedGuilds: w.excludedDevices[where.id] ?? [] })),
      upsert: vi.fn(async ({ where }: { where: { tokenHash: string } }) => ({ id: `inbox-${where.tokenHash}` }))
    },
    dungeonRunWitness: {
      findFirst: vi.fn(async ({ where }: { where: { guildId: string; runRef: string } }) => w.held.includes(`${where.guildId}:${where.runRef}`) ? { id: "w" } : null),
      count: vi.fn(async () => w.received)
    },
    $transaction: vi.fn(async (work: (tx: unknown) => unknown) => work({}))
  };
}

beforeEach(() => { calls.length = 0; failFor = null; });
afterEach(() => { delete process.env["RUN_INTEGRITY_CONFIG"]; });

describe("cross-guild run sharing: choosing guilds", () => {
  it("matches full names against the guild's own characters and in-game roster, never first names, other guilds' claims or the origin guild", async () => {
    const found = await guildsWithMembersIn(fakeDatabase(world()) as never, dungeonRunSchema.parse(run("QG-X1")), "g-origin");
    // g-delta has only a bare "Bob" and a "Bob Smyth": no match for "Bob Smith". g-eps has Liz but she is not in its roster. g-gamma switched off.
    expect([...found.keys()]).toEqual(["g-beta"]);
    expect([...found.get("g-beta")!.roster].sort()).toEqual(["amy jones", "bob smith", "kev alpha"]);
    expect([...(await guildsWithMembersIn(fakeDatabase(world({ off: [] })) as never, dungeonRunSchema.parse(run("QG-X1")), "g-origin")).keys()]).toEqual(["g-beta", "g-gamma"]);
  });

  it("leaves out a guild without a Discord server", async () => {
    const found = await guildsWithMembersIn(fakeDatabase(world({ discord: { "g-beta": null } })) as never, dungeonRunSchema.parse(run("QG-X2")), "g-origin");
    expect(found.size).toBe(0);
  });
});

describe("cross-guild run sharing: the copy", () => {
  it("stores one copy per other guild through that guild's own run checks, marking only its own roster members as in the guild", async () => {
    const shared = await shareRuns(fakeDatabase(world()) as never, origin(), [run("QG-X3")]);
    expect(calls.map((call) => call.guildId)).toEqual(["g-beta"]);
    expect(calls[0]!.source).toMatchObject({ shared: true, sealKey: null });
    expect(calls[0]!.now).toEqual(receivedAt);
    const marks = Object.fromEntries(calls[0]!.runs[0]!.players.map((player) => [player.character, player.inGuild]));
    expect(marks).toEqual({ "Kev Alpha": true, "Bob Smith": true, "Amy Jones": true, "Zed Gamma": false, "Liz Nobody": false });
    expect(shared).toMatchObject([{ guildId: "g-beta", discordId: "d-beta" }]);
  });

  it("does not carry the origin guild's marks: a mixed party never counts as a full guild group in another guild", () => {
    const copy = localiseRun(run("QG-X4"), new Set(["bob smith"]), "forever") as { players: { character: string; inGuild: boolean }[] };
    expect(copy.players.filter((player) => player.inGuild).map((player) => player.character)).toEqual(["Bob Smith"]);
  });

  it("shares nothing when no player of the run vouches for it (a stranger listing other guilds' members)", async () => {
    const database = fakeDatabase(world());
    await shareRuns(database as never, origin({ characterKeys: ["somebody else"] }), [run("QG-X5", { reporterNames: undefined, reporters: 0 }), run("QG-X6", { reporterNames: ["Stranger Name"] })]);
    expect(calls).toEqual([]);
    expect(database.$transaction).not.toHaveBeenCalled();
  });

  it("shares nothing for unfinished runs or runs only carried through a group", async () => {
    await shareRuns(fakeDatabase(world()) as never, origin(), [run("QG-X7", { state: "ABANDONED" }), run("QG-X8", { viaGroup: true })]);
    expect(calls).toEqual([]);
  });

  it("does not copy a run the guild holds for review, or one from a PC its officers excluded", async () => {
    await shareRuns(fakeDatabase(world({ held: ["g-beta:QG-X9"] })) as never, origin(), [run("QG-X9")]);
    expect(calls).toEqual([]);
    await shareRuns(fakeDatabase(world({ excludedDevices: { d1: ["g-beta"] } })) as never, origin({ deviceId: "d1" }), [run("QG-X10")]);
    expect(calls).toEqual([]);
  });

  it("skips a Discord server the bot is not in", async () => {
    await shareRuns(fakeDatabase(world()) as never, origin(), [run("QG-X11")], { eligible: () => false });
    expect(calls).toEqual([]);
  });

  it("chooses guilds in id order before the configured cut, and stops at the daily allowance of copies", async () => {
    process.env["RUN_INTEGRITY_CONFIG"] = JSON.stringify({ crossGuildMaxGuilds: 1 });
    await shareRuns(fakeDatabase(world({ off: [], characters: [...world().characters, { guildId: "g-aaa", name: "Zed Gamma", realm: "Forever" }], roster: [...world().roster, { guildId: "g-aaa", nameKey: "zed gamma" }], discord: { ...world().discord, "g-aaa": "d-aaa" } })) as never, origin(), [run("QG-X12")]);
    expect(calls.map((call) => call.guildId)).toEqual(["g-aaa"]);
    calls.length = 0;
    process.env["RUN_INTEGRITY_CONFIG"] = JSON.stringify({ crossGuildCopiesPerDay: 5 });
    await shareRuns(fakeDatabase(world({ received: 5 })) as never, origin(), [run("QG-X13")]);
    expect(calls).toEqual([]);
  });

  it("never throws when a guild cannot store the run (two uploads of one run racing), and keeps going with the others", async () => {
    failFor = "g-beta";
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const shared = await shareRuns(fakeDatabase(world({ off: [] })) as never, origin(), [run("QG-X14")]);
    expect(shared.map((item) => item.guildId)).toEqual(["g-gamma"]);
    error.mockRestore();
  });
});
