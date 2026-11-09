import { describe, expect, it, vi } from "vitest";
import { DEVICE_LIMITS, deviceFor, handleDeviceUpload, registerDevice, runsOfDevice, storeDeviceRuns, type DeviceRow, type DeviceStore, type ServerCandidate } from "../src/services/companion-device.js";
import { provisionalSeasonRules } from "../src/services/dungeon-bracket-season.js";
import { dungeonRating } from "../src/services/dungeon-rating.js";

// Zero-setup companion: dungeon runs from an unsigned device are stored like any run and count on the guild board.

const season = { id: "s1", startsAt: new Date("2026-11-04T23:00:00Z"), endsAt: null, status: "ACTIVE", name: "Season 1", ratingRules: provisionalSeasonRules().rules };
const start = Math.floor(new Date("2026-11-08T20:00:00Z").getTime() / 1000);
const now = new Date("2026-11-09T12:00:00Z");
const run = (id: string, over: Record<string, unknown> = {}) => ({ id, protocolVersion: 1, state: "COMPLETED", instanceId: 90, name: "Gnomeregan", difficultyId: 0,
  startedAt: start, endedAt: start + 2700, reporters: 1, completedBy: "final boss", encounters: [],
  players: ["Kev", "Bob", "Amy"].map((character) => ({ character, realm: "Forever", deaths: 0, presentSec: 2700, inGuild: true, level: 30, minLevel: 30 })), ...over });

function fakeTx(initial: Record<string, unknown>[] = [], characters: unknown[] = []) {
  const runs = [...initial];
  const tx = {
    guild: { findUnique: async () => ({ gameEdition: "forever" }) },
    character: { findMany: async () => characters },
    guildSettings: { findUnique: async () => ({ dungeonLeaderboardChannelId: null }) },
    dungeonSeason: { findFirst: async () => season, create: async () => season, update: vi.fn() },
    dungeonRun: {
      findUnique: async ({ where }: { where: { guildId_runRef: { runRef: string } } }) => runs.find((r) => r["runRef"] === where.guildId_runRef.runRef) ?? null,
      findMany: async ({ where }: { where: { runRef?: { in: string[] }; instanceId?: number; valid?: boolean; state?: string; completedBy?: string } }) => runs.filter((r) =>
        (!where.runRef || where.runRef.in.includes(r["runRef"] as string)) && (where.instanceId === undefined || r["instanceId"] === where.instanceId)
        && (where.valid === undefined || r["valid"] === where.valid) && (where.state === undefined || r["state"] === where.state)
        && (where.completedBy === undefined || r["completedBy"] === where.completedBy)),
      create: async ({ data }: { data: Record<string, unknown> & { players: { create: { character: string; memberId: string | null }[] } } }) => {
        const row = { ...data, id: `run-${runs.length + 1}`, players: data.players.create.map((p) => ({ ...p, member: null })) };
        runs.push(row);
        return row;
      }
    },
    dungeonAchievement: { findMany: async () => [], create: async () => ({}) },
    dungeonPointTransaction: { create: async ({ data }: { data: unknown }) => data }
  };
  return { tx: tx as never, runs };
}

describe("runs an unsigned device sends", () => {
  it("only keeps runs a character of this device was in", () => {
    const own = new Set(["kev"]);
    expect(runsOfDevice([run("a"), run("b", { players: [{ character: "Zed", realm: "", presentSec: 1, inGuild: true }] }), null, { id: "c" }], own)).toHaveLength(1);
  });

  it("stores the run and it counts on the guild board for an in-guild reported character", async () => {
    const { tx, runs } = fakeTx();
    expect(await storeDeviceRuns(tx, "g1", [run("QG-1")], now)).toEqual({ stored: 1, skipped: 0 });
    expect(runs).toHaveLength(1);
    const rows = await dungeonRating(tx, "g1", season);
    expect(rows.find((row) => row.character === "Kev")?.points).toBeGreaterThan(0);
  });

  it("links a character a member already has, and keeps the integrity rules (manual end, too short)", async () => {
    const { tx, runs } = fakeTx([], [{ name: "Kev", realm: "", memberId: "m-kev", spec: null, displayName: null, member: { discordUserId: "1" } }]);
    await storeDeviceRuns(tx, "g1", [run("run-ok"), run("manual", { completedBy: undefined, endReason: "manual", startedAt: start + 9000, endedAt: start + 11700 }), run("short", { startedAt: start + 20000, endedAt: start + 20020 })], now);
    const players = (id: string) => (runs.find((r) => r["runRef"] === id)?.["players"] as { character: string; memberId: string | null }[] | undefined);
    expect(players("run-ok")?.find((p) => p.character === "Kev")?.memberId).toBe("m-kev");
    expect(runs.find((r) => r["runRef"] === "short")).toMatchObject({ valid: false });
  });

  it("never touches a run the server already stores, and a second upload adds nothing", async () => {
    const confirmed = { id: "run-0", runRef: "QG-1", valid: true, state: "COMPLETED", completedBy: "final boss", instanceId: 90, players: [] };
    const { tx, runs } = fakeTx([confirmed]);
    expect(await storeDeviceRuns(tx, "g1", [run("QG-1", { endedAt: start + 3000 })], now)).toEqual({ stored: 0, skipped: 1 });
    expect(runs).toEqual([confirmed]);
    expect(await storeDeviceRuns(tx, "g1", [run("QG-2")], now)).toMatchObject({ stored: 1 });
    expect(await storeDeviceRuns(tx, "g1", [run("QG-2")], now)).toEqual({ stored: 0, skipped: 1 });
    expect(runs).toHaveLength(2);
  });
});

describe("device upload with runs", () => {
  const quebec: ServerCandidate = { guildId: "g1", discordId: "111111111", serverName: "Quebec Gold", officerLinked: true };
  function store() {
    const devices = new Map<string, DeviceRow & { tokenHash: string }>();
    const imported: unknown[][] = [];
    const s: DeviceStore = {
      async create(tokenHash) { devices.set("d1", { id: "d1", tokenHash, guildId: null, chosenGuildId: null, claimedMemberId: null, revokedAt: null, uploads: 0 }); return { id: "d1" }; },
      async find(tokenHash) { return [...devices.values()].find((d) => d.tokenHash === tokenHash) ?? null; },
      async candidates() { return [quebec]; },
      async characterKeys() { return []; },
      async saveUpload() { /* characters are covered by companion-device.test.ts */ },
      async claim() { return false; },
      async importRuns(_guildId, runs) { imported.push(runs); return { stored: runs.length, skipped: 0 }; }
    };
    return { s, imported };
  }
  const body = (runs: unknown[]) => ({ guild: { name: "Quebec Gold", realm: "Realm" }, characters: [{ name: "Kev" }], dungeonRuns: runs });

  it("sends the device's runs for import and says how many were stored", async () => {
    const { s, imported } = store();
    const device = (await deviceFor(s, (await registerDevice(s)).deviceSecret))!;
    const answer = await handleDeviceUpload(s, device, body([run("a"), run("b", { players: [{ character: "Zed", realm: "", presentSec: 1, inGuild: true }] })]), { now });
    expect(answer).toMatchObject({ status: "synced", runs: { received: 2, stored: 1, skipped: 0 } });
    expect(imported[0]).toHaveLength(1);
  });

  it("does not import for a claimed device or more than the per-upload cap", async () => {
    const { s, imported } = store();
    const device = (await deviceFor(s, (await registerDevice(s)).deviceSecret))!;
    expect(await handleDeviceUpload(s, { ...device, claimedMemberId: "m" }, body([run("a")]))).toEqual({ status: "claimed" });
    await expect(handleDeviceUpload(s, device, body(Array.from({ length: DEVICE_LIMITS.runsPerUpload + 1 }, (_, i) => run(`r${i}`))))).rejects.toThrow();
    expect(imported).toHaveLength(0);
  });

  it("stops at the per-device hourly run limit", async () => {
    const { s, imported } = store();
    const device = (await deviceFor(s, (await registerDevice(s)).deviceSecret))!;
    let left = 2;
    await handleDeviceUpload(s, device, body([run("a"), run("b"), run("c")]), { now, runLimiter: () => left-- > 0 });
    expect(imported[0]).toHaveLength(2);
  });
});
