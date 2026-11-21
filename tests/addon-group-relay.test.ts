import { describe, expect, it, vi } from "vitest";
import { RUN_TRUST } from "../src/services/run-trust.js";
import { STRANGER_NOTE } from "../src/services/relay-public.js";
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

  it("carried runs never spend the device's shared hourly budget", async () => {
    const { s, importRuns, publicRuns } = store();
    // The hourly budget refuses everything: the guild lane gets nothing, the relay lane has its own caps.
    await handleDeviceUpload(s, device, body([run("QG-B1")]), { now, runLimiter: () => false });
    expect(publicRuns).toHaveBeenCalledTimes(1);
    expect(importRuns).not.toHaveBeenCalled();
  });
});

// Guild-only Discord (14 November 2026): a run with no player of the device's guild goes to the public lane, not the guild's.
describe("runs of strangers reaching a guild's device lane", () => {
  const strangers = (id: string, over: Record<string, unknown> = {}) => run(id, { viaGroup: undefined, reporterNames: ["Zed"], ...over });
  const members = (names: string[], gate = true) => async () => ({ gate, names });

  it("goes to the public lane and is receipted, and the guild lane gets only the guild's own run", async () => {
    const { s, importRuns, publicRuns } = store();
    s.membership = members(["kev", "bob"]);
    const mine = run("QG-MINE", { viaGroup: undefined, players: ["Kev", "Zed"].map((character) => ({ character, realm: "Forever", deaths: 0, presentSec: 2700 })) });
    const answer = await handleDeviceUpload(s, device, body([strangers("QG-STRANGERS"), mine]), { now });
    expect(publicRuns).toHaveBeenCalledTimes(1);
    expect((publicRuns.mock.calls[0]![1] as { id: string; viaGroup: boolean }[]).map((entry) => [entry.id, entry.viaGroup])).toEqual([["QG-STRANGERS", true]]);
    expect((importRuns.mock.calls[0]![1] as { id: string }[]).map((entry) => entry.id)).toEqual(["QG-MINE"]);
    expect((answer as { runReceipts?: { acceptedRunRefs: string[] } }).runReceipts?.acceptedRunRefs).toContain("QG-STRANGERS");
  });

  it("stranger runs beyond the per-upload cap are neither stored nor receipted, so the companion sends them again next upload and none is lost", async () => {
    const { s, importRuns, publicRuns } = store();
    s.membership = members(["kev", "bob"]);
    const many = Array.from({ length: RUN_TRUST.relayedPerUpload + 3 }, (_, index) => strangers(`QG-CAP-${String(index).padStart(2, "0")}`));
    const first = await handleDeviceUpload(s, device, body(many), { now });
    const sent = (publicRuns.mock.calls[0]![1] as { id: string }[]).map((entry) => entry.id);
    expect(sent).toEqual(many.slice(0, RUN_TRUST.relayedPerUpload).map((entry) => entry.id));
    const receipted = (first as { runReceipts?: { acceptedRunRefs: string[] } }).runReceipts?.acceptedRunRefs ?? [];
    expect(receipted.sort()).toEqual([...sent].sort());
    expect(importRuns).not.toHaveBeenCalled();
    // The addon keeps what was not receipted; the next upload carries just those and they go through.
    const rest = many.filter((entry) => !receipted.includes(entry.id));
    expect(rest).toHaveLength(3);
    await handleDeviceUpload(s, device, body(rest), { now });
    expect((publicRuns.mock.calls[1]![1] as { id: string }[]).map((entry) => entry.id)).toEqual(rest.map((entry) => entry.id));
  });

  // 16 November 2026: the real lane answers "group:<id>", which the addon takes for its carried list only. A stranger's run sits in the
  // addon's own list, so it also needs its plain id back, or it waits ("not reached Discord") and is sent for ever.
  it("answers a stranger run with its plain id and a note too, using what the real relay lane returns", async () => {
    const { s, importRuns } = store();
    s.membership = members(["kev", "bob"]);
    s.publicRuns = vi.fn(async (_deviceId: string, runs: unknown[]) => runs.map((entry) => `group:${(entry as { id: string }).id}`));
    const ids = ["QG-20261116-032503-Caliban Dawnbreaker", "QG-20261116-011224-Caliban Dawnbreaker"];
    const answer = await handleDeviceUpload(s, device, body(ids.map((id) => strangers(id, { reporterNames: ["Caliban Dawnbreaker"],
      players: ["Caliban Dawnbreaker", "Hueso Flacido"].map((character) => ({ character, realm: "Forever", deaths: 0, presentSec: 2700 })) }))), { now });
    expect(importRuns).not.toHaveBeenCalled();
    const receipts = (answer as { runReceipts?: { acceptedRunRefs: string[]; runNotes: Record<string, string> } }).runReceipts!;
    for (const id of ids) {
      expect(receipts.acceptedRunRefs).toContain(id);
      expect(receipts.acceptedRunRefs).toContain(`group:${id}`);
      expect(receipts.runNotes[id]).toBe(STRANGER_NOTE);
    }
  });

  it("a failing relay leaves stranger runs unreceipted and never breaks the upload", async () => {
    const { s } = store();
    s.membership = members(["kev", "bob"]);
    s.publicRuns = vi.fn(async () => { throw new Error("down"); });
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const answer = await handleDeviceUpload(s, device, body([strangers("QG-DOWN")]), { now });
    errors.mockRestore();
    expect(answer.status).toBe("synced");
    expect((answer as { runReceipts?: { acceptedRunRefs: string[] } }).runReceipts?.acceptedRunRefs ?? []).not.toContain("QG-DOWN");
  });

  it("with no membership known (empty or old roster) the run stays with the guild lane as before", async () => {
    const { s, importRuns, publicRuns } = store();
    s.membership = members([], false);
    await handleDeviceUpload(s, device, body([strangers("QG-DOUBT")]), { now });
    expect(publicRuns).not.toHaveBeenCalled();
    expect((importRuns.mock.calls[0]![1] as { id: string }[]).map((entry) => entry.id)).toEqual(["QG-DOUBT"]);
  });

  it("the device's own character counts as a participant", async () => {
    const { s, importRuns, publicRuns } = store();
    s.membership = async (_guildId, own) => ({ gate: true, names: [...own] });
    const own = run("QG-OWNCHAR", { viaGroup: undefined, players: ["Kev", "Zed"].map((character) => ({ character, realm: "Forever", deaths: 0, presentSec: 2700 })) });
    await handleDeviceUpload(s, device, body([own]), { now });
    expect(publicRuns).not.toHaveBeenCalled();
    expect(importRuns).toHaveBeenCalledTimes(1);
  });
});
