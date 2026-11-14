import { describe, expect, it, vi } from "vitest";
import { DEVICE_FEATURES, handleDeviceUpload, splitGroupRuns, type DeviceRow, type DeviceStore, type ServerCandidate } from "../src/services/companion-device.js";

// 9.3.1: runs a companion carries for players near it (party or raid, any guild) go to the public boards, whatever the
// carrier's own guild is, and never into the guild lane.

const quebec: ServerCandidate = { guildId: "g1", discordId: "111111111", serverName: "Quebec Gold", officerLinked: true };
const device: DeviceRow = { id: "d1", guildId: null, chosenGuildId: null, claimedMemberId: null, revokedAt: null, uploads: 0 };
const now = new Date("2026-11-13T12:00:00Z");
const start = Math.floor(now.getTime() / 1000) - 7200;
const run = (id: string, over: Record<string, unknown> = {}) => ({ id, protocolVersion: 1, state: "COMPLETED", instanceId: 90, name: "Gnomeregan", difficultyId: 0,
  startedAt: start, endedAt: start + 2700, reporters: 1, reporterNames: ["Zed"], viaGroup: true,
  players: ["Zed", "Amy"].map((character) => ({ character, realm: "Forever", deaths: 0, presentSec: 2700 })), ...over });

function store(candidates: ServerCandidate[] = [quebec]) {
  const importRuns = vi.fn(async (_guildId: string, runs: unknown[]) => ({ stored: runs.length, skipped: 0 }));
  const publicRuns = vi.fn(async (_deviceId: string, runs: unknown[]) => runs.map((entry) => (entry as { id: string }).id));
  const s: DeviceStore = {
    async create() { return { id: "d1" }; }, async find() { return device; }, async candidates() { return candidates; },
    async characterKeys() { return []; }, async claim() { return false; }, async saveUpload() {},
    async receipts(_guildId, refs) { return refs.map((runRef) => ({ runRef, reason: null })); },
    importRuns, publicRuns
  } as DeviceStore;
  return { s, importRuns, publicRuns };
}
const body = (dungeonRuns: unknown[], guild: unknown = { name: "Quebec Gold", realm: "R" }) => ({ ...(guild ? { guild } : {}), characters: [{ name: "Kev" }], dungeonRuns });

it("advertises the group relay so a companion only sends such runs to a bot that handles them", () => {
  expect(DEVICE_FEATURES).toContain("group-relay");
});

describe("runs carried for players in the group", () => {
  it("splits every marked run, whoever is in it: a viaGroup run never enters a guild lane", () => {
    const mixed = [run("a"), run("b", { viaGroup: undefined }), run("c", { reporterNames: [] }),
      run("d", { players: [{ character: "Kev", realm: "Forever" }, { character: "Zed", realm: "Forever" }] })];
    const { group, rest } = splitGroupRuns(mixed);
    expect(group.map((entry) => (entry as { id: string }).id)).toEqual(["a", "c", "d"]);
    expect(rest.map((entry) => (entry as { id: string }).id)).toEqual(["b"]);
  });

  it("sends them to the public lane, never the guild lane, and receipts them", async () => {
    const { s, importRuns, publicRuns } = store();
    const answer = await handleDeviceUpload(s, device, body([run("QG-G1")]), { now });
    expect(publicRuns).toHaveBeenCalledTimes(1);
    expect(importRuns).not.toHaveBeenCalled();
    expect(answer.status).toBe("synced");
    expect((answer as { runReceipts?: { acceptedRunRefs: string[] } }).runReceipts?.acceptedRunRefs).toEqual(["QG-G1"]);
  });

  it("works for a device with no guild at all, and for a guild no server knows", async () => {
    const none = store();
    const a = await handleDeviceUpload(none.s, device, body([run("QG-G2")], null), { now });
    expect(a.status).toBe("no-guild");
    expect((a as { runReceipts?: { acceptedRunRefs: string[] } }).runReceipts?.acceptedRunRefs).toEqual(["QG-G2"]);
    const unknown = store([]);
    const b = await handleDeviceUpload(unknown.s, device, body([run("QG-G3")]), { now });
    expect(b.status).toBe("no-guild");
    expect(unknown.publicRuns).toHaveBeenCalledTimes(1);
  });

  it("never puts a marked run in the guild lane, even one with the device's own character", async () => {
    const { s, importRuns, publicRuns } = store();
    await handleDeviceUpload(s, device, body([run("QG-G4", { players: [{ character: "Kev", realm: "Forever" }, { character: "Zed", realm: "Forever" }] })]), { now });
    expect(importRuns).not.toHaveBeenCalled();
    expect(publicRuns).toHaveBeenCalledTimes(1);
  });

  it("carries at most 25 per upload and survives the public lane failing", async () => {
    const many = store();
    await handleDeviceUpload(many.s, device, body(Array.from({ length: 30 }, (_, index) => run(`QG-M${index}`))), { now, runLimiter: () => true });
    expect((many.publicRuns.mock.calls[0] as unknown as [string, unknown[]])[1]).toHaveLength(25);
    const failing = store();
    failing.publicRuns.mockRejectedValueOnce(new Error("down"));
    const answer = await handleDeviceUpload(failing.s, device, body([run("QG-F1")]), { now });
    expect(answer.status).toBe("synced");
    expect((answer as { runReceipts?: unknown }).runReceipts).toBeUndefined();
  });
});
