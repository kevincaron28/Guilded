import { describe, expect, it, vi } from "vitest";
import { dungeonRoleFixture } from "./fixtures/dungeon-role-contract.js";
import { mergePlayerReports, reconcileSummaries, summarize } from "../src/services/public-runs.js";
import { restorePlayerPatches } from "../src/services/public-run-player-restore.js";
import { ownGuildNames } from "../src/services/import-followup.js";
import { postingGuildName } from "../src/services/dungeon-announce.js";

describe("player details survive a merge of several reports", () => {
  it("keeps guild, faction, display name and deaths when the last report lacks them", () => {
    const run = dungeonRoleFixture(false, "DAMAGER", { nativeApi: true }).run;
    const now = new Date(run.endedAt! * 1000);
    const own = summarize(run, now);
    own.players = own.players.map((p) => ({ ...p, guild: "Québec Gold", faction: "HORDE", displayName: "Full Name", deaths: 2 }));
    const relayed = structuredClone(own);
    relayed.players = relayed.players.map(({ guild, faction, displayName, ...p }) => { void guild; void faction; void displayName; return { ...p, deaths: null }; });
    (relayed.integrity as { run: { observer: string } }).run.observer = "Peer";
    for (const reports of [[own, relayed], [relayed, own]]) {
      const merged = reconcileSummaries(reports);
      expect(merged).not.toBeNull();
      for (const player of merged!.players) expect(player).toMatchObject({ guild: "Québec Gold", faction: "HORDE", displayName: "Full Name", deaths: 2 });
    }
  });
  it("takes the highest death count and the later non-empty value", () => {
    const base = { character: "a", realm: "", className: null, role: null, level: null, minLevel: null, presentSec: 0, deaths: 1 };
    expect(mergePlayerReports({ ...base, guild: "Old" }, { ...base, deaths: 3, guild: "New" })).toMatchObject({ deaths: 3, guild: "New" });
    expect(mergePlayerReports({ ...base, deaths: null }, { ...base, deaths: 0 }).deaths).toBe(0);
  });
});

describe("restorePlayerPatches", () => {
  it("fills only null fields from the uploads' saved evidence", () => {
    const rows = [
      { id: "1", character: "Lebowski Holyroller", realm: "", guild: null, faction: null, displayName: null, deaths: null },
      { id: "2", character: "Other", realm: "", guild: "Kept", faction: "ALLIANCE", displayName: "x", deaths: 0 }
    ];
    const patches = restorePlayerPatches(rows, [
      { players: [{ character: "lebowski holyroller", realm: "-", guild: "Québec Gold", faction: "HORDE", deaths: 1 }, { character: "Other", guild: "Else" }] },
      { players: [{ character: "Lebowski Holyroller", deaths: 3, displayName: "Lebowski Holyroller" }] }
    ]);
    expect(patches).toEqual([{ id: "1", guild: "Québec Gold", faction: "HORDE", displayName: "Lebowski Holyroller", deaths: 3 }]);
  });
});

describe("the card's own-guild fallback", () => {
  const db = (wow: { name: string }[], devices: { wowGuildName: string | null; _count: { _all: number } }[]) => ({
    wowGuild: { findMany: vi.fn(async () => wow) }, companionDevice: { groupBy: vi.fn(async () => devices) }
  }) as never;
  it("uses registered guilds first", async () => {
    expect(await ownGuildNames(db([{ name: "Reg" }], [{ wowGuildName: "Dev", _count: { _all: 3 } }]), "g")).toEqual([{ name: "Reg" }]);
  });
  it("falls back to the guild name the server's companions reported when no WowGuild exists (Quebec Gold)", async () => {
    const names = await ownGuildNames(db([], [{ wowGuildName: "Québec Gold", _count: { _all: 9 } }]), "g");
    expect(names).toEqual([{ name: "Québec Gold" }]);
    expect(postingGuildName(names, [])).toBe("Québec Gold");
  });
  it("is empty when nothing is known", async () => {
    expect(await ownGuildNames(db([], []), "g")).toEqual([]);
  });
});
