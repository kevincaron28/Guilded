import { describe, expect, it } from "vitest";
import { deviceUploadBody } from "../companion/device-sync.mjs";
import { acknowledgements, pruneAcknowledged } from "../companion/delta.mjs";

// 9.3.1: a companion sends runs it only heard through a group to a bot that announced it handles them, and only once.
const run = (id: string, over: Record<string, unknown> = {}) => ({ id, state: "COMPLETED", endedAt: 1000, reporterNames: ["Amy"], viaGroup: true,
  players: [{ character: "Amy", realm: "R" }, { character: "Bob", realm: "R" }], ...over });
const full = (dungeonRuns: unknown[]) => ({ guild: null, wowGuild: "Quebec Gold-Realm", character: { name: "Kev", realm: "R" }, alts: [], characters: [], dungeonRuns });
const ids = (body: { dungeonRuns?: { id: string }[] }) => (body.dungeonRuns ?? []).map((entry) => entry.id);

describe("the companion and group-carried runs", () => {
  it("holds them back from a bot that did not announce the feature (an unsigned upload)", () => {
    const runs = [run("QG-A"), run("QG-B", { viaGroup: undefined })];
    expect(ids(deviceUploadBody(full(runs) as never, { acknowledged: new Set() }))).toEqual(["QG-B"]);
    expect(ids(deviceUploadBody(full(runs) as never, { acknowledged: new Set(), groupRelay: true })).sort()).toEqual(["QG-A", "QG-B"]);
  });

  it("only the group: receipt stops a carried run, and the plain id stops only a guild run", () => {
    const runs = [run("QG-A"), run("QG-B")];
    expect(ids(deviceUploadBody(full(runs) as never, { acknowledged: new Set(["QG-A"]), groupRelay: true })).sort()).toEqual(["QG-A", "QG-B"]);
    expect(ids(deviceUploadBody(full(runs) as never, { acknowledged: new Set(["group:QG-A"]), groupRelay: true }))).toEqual(["QG-B"]);
  });

  it("a signed upload drops them unless the standings announced the feature, and after the bot's receipt", () => {
    const exported = full([run("QG-A"), run("QG-B", { viaGroup: undefined })]);
    const ack = acknowledgements({ personal: { acceptedRunRefs: ["group:QG-A"] } });
    expect(pruneAcknowledged(exported as never, ack, new Set(["ledger-delta"])).exported.dungeonRuns.map((entry: { id: string }) => entry.id)).toEqual(["QG-B"]);
    expect(pruneAcknowledged(exported as never, acknowledgements({}), new Set(["group-relay"])).exported.dungeonRuns.map((entry: { id: string }) => entry.id)).toEqual(["QG-A", "QG-B"]);
    expect(pruneAcknowledged(exported as never, ack, new Set(["group-relay"])).exported.dungeonRuns.map((entry: { id: string }) => entry.id)).toEqual(["QG-B"]);
  });
});
