import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { handleDeviceUpload, registerDevice, deviceFor, type DeviceRow, type DeviceStore, type ServerCandidate } from "../src/services/companion-device.js";
import { deviceUploadBody } from "../companion/device-sync.mjs";
import { deviceStandingsToLua } from "../companion/standings-format.mjs";

// 9.1.3, second report from the two real PCs: an unsigned (zero-setup) companion never got an answer about
// its dungeon runs back to the addon.
const text = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

function memoryStore(candidates: ServerCandidate[], held: string[], receipts: Record<string, string> = {}) {
  const devices = new Map<string, DeviceRow & { tokenHash: string }>();
  const characters = new Map<string, Set<string>>();
  let next = 0;
  const imported: unknown[][] = [];
  const store: DeviceStore = {
    async create(tokenHash) { const id = `d${++next}`; devices.set(id, { id, tokenHash, guildId: null, chosenGuildId: null, claimedMemberId: null, revokedAt: null, uploads: 0 }); return { id }; },
    async find(tokenHash) { return [...devices.values()].find((row) => row.tokenHash === tokenHash) ?? null; },
    async candidates() { return candidates; },
    async characterKeys(deviceId) { return [...(characters.get(deviceId) ?? [])]; },
    async saveUpload(deviceId, _data, rows) { const set = characters.get(deviceId) ?? new Set<string>(); for (const row of rows) set.add(row.nameKey); characters.set(deviceId, set); },
    async claim() { return false; },
    async importRuns(_guildId, runs) { imported.push(runs); for (const run of runs) held.push((run as { id: string }).id); return { stored: runs.length, skipped: 0 }; },
    async acknowledge(_guildId, refs) { return { accepted: refs.filter((ref) => held.includes(ref) || ref in receipts), notes: receipts }; }
  };
  return { store, imported };
}

const quebec: ServerCandidate = { guildId: "g-qg", discordId: "111111111", serverName: "Quebec Gold", officerLinked: true };
const run = (id: string, character: string) => ({ id, state: "COMPLETED", endedAt: 100, players: [{ character }] });

describe("unsigned dungeon uploads are answered run by run", () => {
  it("returns every ref the server holds, plus a note for guildmates' runs, so none waits forever", async () => {
    const held = ["already-there"];
    const { store, imported } = memoryStore([quebec], held, { refused: "Not completed" });
    const { deviceSecret } = await registerDevice(store);
    const device = (await deviceFor(store, deviceSecret))!;
    const answer = await handleDeviceUpload(store, device, {
      guild: { name: "Quebec Gold", realm: "Realm 2" },
      characters: [{ name: "Meo Gratton", level: 20 }],
      dungeonRuns: [run("new-run", "Meo Gratton"), run("already-there", "Meo Gratton"), run("refused", "Meo Gratton"), run("peer-run", "Somebody Else")]
    });
    expect(answer.status).toBe("synced");
    if (answer.status !== "synced") return;
    expect(imported[0]).toHaveLength(3); // the peer's run is never imported
    expect([...(answer.runs?.acceptedRunRefs ?? [])].sort()).toEqual(["already-there", "new-run", "peer-run", "refused"]);
    expect(answer.runs?.runNotes).toMatchObject({ refused: "Not completed", "peer-run": "Not one of this PC's characters" });
  });

  it("the companion skips refs the bot answered and writes them for the addon without a Discord link", () => {
    const full = { wowGuild: "Quebec Gold-Realm 2", character: { name: "Meo Gratton", realm: "Realm 2" }, dungeonRuns: [run("a", "Meo Gratton"), run("b", "Meo Gratton")] };
    expect((deviceUploadBody(full).dungeonRuns ?? []).map((row: { id: string }) => row.id)).toEqual(["a", "b"]);
    expect((deviceUploadBody(full, { skip: new Set(["a"]) }).dungeonRuns ?? []).map((row: { id: string }) => row.id)).toEqual(["b"]);
    const lua = deviceStandingsToLua({ acceptedRunRefs: ["a", "peer-run"], runNotes: { "peer-run": "Not one of this PC's characters" } });
    expect(lua).toContain("GuildedLinkedAs = nil");
    expect(lua).toContain('GuildedDungeonAccepted = {\n  "a",\n  "peer-run",\n}');
    expect(lua).toContain('["peer-run"] = "Not one of this PC\'s characters"');
  });

  it("is wired: the engine writes the device standings after a synced answer and sends only unanswered runs", () => {
    const engine = text("companion/engine.mjs");
    expect(engine).toMatch(/writeDeviceStandings\(current, \{ acceptedRunRefs: \[\.\.\.deviceAccepted\]/);
    expect(engine).toContain("deviceAcceptedRuns: deviceAccepted");
    expect(text("companion/device-sync.mjs")).toContain("skip: config.deviceAcceptedRuns");
  });
});
