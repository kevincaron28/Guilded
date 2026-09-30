import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { readAddonExport } from "../companion/lua-export.mjs";
import { parseAddonSnapshot } from "../src/integrations/addon.js";
import { applyRaidAttendance } from "../src/services/raid-import.js";

const characters = [
  { id: "c-kev", name: "Kev", realm: "Forever", memberId: "m-kev" },
  { id: "c-bob", name: "Bob", realm: "Forever", memberId: "m-bob" },
  { id: "c-zed", name: "Zed", realm: "Forever", memberId: "m-zed" },
  { id: "c-amy", name: "Amy", realm: "Forever", memberId: "m-amy" }
];

function fakeTx(existingAttendance: { memberId: string }[] = []) {
  const created: { memberId: string; status: string }[] = [];
  const touched: string[] = [];
  const tx = {
    character: {
      updateMany: async ({ where }: { where: { id: string } }) => { touched.push(where.id); return { count: 1 }; }
    },
    raid: {
      findMany: async () => [
        {
          id: "far", title: "Other night", scheduledAt: new Date("2026-09-24T19:00:00Z"),
          signups: [], attendance: []
        },
        {
          id: "r1", title: "Molten Core", scheduledAt: new Date("2026-09-25T00:00:00Z"),
          signups: [
            { memberId: "m-kev", status: "SIGNED_UP" },
            { memberId: "m-bob", status: "SIGNED_UP" },
            { memberId: "m-amy", status: "SIGNED_UP" },
            { memberId: "m-zed", status: "CANCELLED" }
          ],
          attendance: existingAttendance
        }
      ]
    },
    raidAttendance: {
      create: async ({ data }: { data: { memberId: string; status: string } }) => {
        created.push({ memberId: data.memberId, status: data.status });
        return data;
      }
    },
    member: {
      findUnique: async ({ where }: { where: { id: string } }) => ({ displayName: where.id.replace("m-", "") })
    }
  };
  return { tx, created, touched };
}

const addonRaid = parseAddonSnapshot({
  source: "Guilded",
  exportedAt: "2026-09-25T03:00:00Z",
  raids: [{
    ref: "1-Kev", title: "MC", startedAt: "2026-09-25T00:30:00Z", endedAt: "2026-09-25T03:00:00Z",
    players: [
      { character: "Kev", realm: "Forever", seen: true },
      { character: "Bob", realm: "Forever", status: "LATE", seen: true },
      { character: "Zed", realm: "Forever", seen: true }
    ]
  }]
}).raids;

describe("in-game raid attendance import", () => {
  it("matches the closest Discord raid and records marks, presence, no-shows, walk-ins", async () => {
    const { tx, created, touched } = fakeTx();
    const [summary] = await applyRaidAttendance(tx as never, "g1", addonRaid, characters, "officer");
    expect(touched).toEqual(["c-kev", "c-bob", "c-zed"]);
    expect(summary?.matchedRaidTitle).toBe("Molten Core");
    expect(created).toEqual([
      { memberId: "m-kev", status: "PRESENT" },
      { memberId: "m-bob", status: "LATE" },
      { memberId: "m-zed", status: "PRESENT" },
      { memberId: "m-amy", status: "ABSENT" }
    ]);
    expect(summary?.noShows).toEqual(["amy"]);
    expect(summary?.walkIns).toEqual(["Zed"]);
  });

  it("never overwrites attendance already recorded on Discord", async () => {
    const { tx, created } = fakeTx([{ memberId: "m-bob" }, { memberId: "m-amy" }]);
    await applyRaidAttendance(tx as never, "g1", addonRaid, characters, "officer");
    expect(created.map((row) => row.memberId)).toEqual(["m-kev", "m-zed"]);
  });
});

describe("companion raid export", () => {
  it("exports finished raids with marks and presence", async () => {
    const dir = await mkdtemp(join(tmpdir(), "qg-raids-"));
    const file = join(dir, "Guilded.lua");
    await writeFile(file, `
GuildedDB = {
  raids = {
    [1] = { id = "100-Kev", title = "MC", startedAt = "2026-09-25T00:30:00Z", endedAt = "2026-09-25T03:00:00Z" },
    [2] = { id = "200-Kev", title = "Still going", startedAt = "2026-09-26T00:30:00Z" },
  },
  attendance = { ["100-Kev"] = { ["Bob"] = { status = "LATE" } } },
  presence = { ["100-Kev"] = { ["Bob"] = { firstSeen = "a" }, ["Kev"] = { firstSeen = "a" } } },
  epgp = {}, readiness = {}, attunements = {}, peerRoster = {}, exports = {},
}`, "utf8");
    try {
      const result = await readAddonExport(file, "Forever");
      const snapshot = parseAddonSnapshot(result);
      expect(snapshot.raids).toHaveLength(1);
      expect(snapshot.raids[0]?.players).toEqual([
        { character: "Bob", realm: "Forever", status: "LATE", seen: true },
        { character: "Kev", realm: "Forever", seen: true }
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("in-game loot import", () => {
  it("restricts attendance and loot matching to the selected core for simultaneous raids", async () => {
    const { tx } = fakeTx();
    const findMany = vi.spyOn(tx.raid, "findMany");
    await applyRaidAttendance(tx as never, "g1", [{ ...addonRaid[0]!, coreId: "core-a" }], characters, "officer");
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ guildId: "g1", coreId: "core-a" }) }));
  });
  it("adds loot once, links it to the matched raid, and reports unlinked characters", async () => {
    const { applyAddonLoot } = await import("../src/services/raid-import.js");
    const created: Record<string, unknown>[] = [];
    const tx = {
      lootAward: {
        findMany: vi.fn().mockResolvedValue([{ sourceRef: "qg-loot:old" }]),
        create: vi.fn().mockImplementation(async ({ data }) => { created.push(data); return { ...data, id: "award" }; })
      }
    };
    const result = await applyAddonLoot(tx as never, "g1", [
      { ref: "qg-loot:old", character: "Kev", realm: "Forever", item: "Old Ring", gp: 10 },
      { ref: "qg-loot:new", character: "bob", realm: "Forever", item: "[Helm]", gp: 30, raidRef: "1-Kev", boss: "Ragnaros" },
      { ref: "qg-loot:pug", character: "Stranger", realm: "Forever", item: "Cloak", gp: 5 }
    ], characters, new Map([["1-Kev", "r1"]]), "officer");
    expect(result).toEqual({ recorded: 1, skipped: 1, unmatched: ["Stranger"], recordedIds: ["award"] });
    expect(created[0]).toMatchObject({ memberId: "m-bob", itemName: "[Helm]", amount: 30, raidId: "r1", bossName: "Ragnaros", sourceRef: "qg-loot:new" });
  });
});
