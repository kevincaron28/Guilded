import { describe, expect, it, vi } from "vitest";
import { createPoeMappingService, poeAreaName, poeUploadSchema } from "../src/services/poe-mapping.js";
import { parsePoeLogLine, consumePoeEvent } from "../companion/poe-log.mjs";

const visit = { runRef: "a".repeat(64), character: "MappingAnn", league: "Pilot", mode: "STANDARD", areaId: "MapLoftySummit", areaLevel: 80, startedAt: "2026-09-30T12:00:00Z", endedAt: "2026-09-30T12:05:00Z", endReason: "AREA_CHANGED" };
const payload = { guildDiscordId: "123", visits: [visit] };
const now = new Date("2026-10-01T12:00:00Z");
function fixture(enabled = true, reset: Date | null = null) {
  const records: unknown[] = [];
  const keys = new Set<string>();
  const tx = {
    guildSettings: { findUnique: vi.fn(async () => ({ poeTrackingEnabled: enabled, dataResetAt: reset })) },
    member: { findFirst: vi.fn(async ({ where }: { where: { guildId: string; id: string } }) => where.guildId === "guild" && where.id === "member" ? { id: "member" } : null) },
    poeMapVisit: { createMany: vi.fn(async ({ data }: { data: { guildId: string; memberId: string; runRef: string }[] }) => {
      let count = 0;
      for (const row of data) {
        const key = `${row.guildId}:${row.memberId}:${row.runRef}`;
        if (!keys.has(key)) { keys.add(key); records.push(row); count++; }
      }
      return { count };
    }), findMany: vi.fn(async () => []) }
  };
  return { tx, records, service: createPoeMappingService({ ...tx, $transaction: async (run: (value: typeof tx) => unknown) => run(tx) } as never) };
}

describe("PoE2 personal mapping observations", () => {
  it("binds uploads to the credential member and deduplicates replayed visits", async () => {
    const { service, records } = fixture();
    expect((await service.ingest("guild", "member", payload, now)).inserted).toBe(1);
    expect((await service.ingest("guild", "member", payload, now)).inserted).toBe(0);
    expect(records).toEqual([expect.objectContaining({ guildId: "guild", memberId: "member", durationSeconds: 300 })]);
    expect(() => poeUploadSchema.parse({ ...payload, memberId: "someone-else" })).toThrow();
  });
  it("refuses disabled tracking and members from another guild", async () => {
    await expect(fixture(false).service.ingest("guild", "member", payload, now)).rejects.toThrow("disabled");
    const { service, records } = fixture();
    await expect(service.ingest("other-guild", "member", payload, now)).rejects.toThrow("not active");
    expect(records).toHaveLength(0);
  });
  it("acknowledges history excluded by a full guild reset without restoring it", async () => {
    const { service, records } = fixture(true, now);
    expect(await service.ingest("guild", "member", payload, now)).toMatchObject({ inserted: 0, acceptedRunRefs: [visit.runRef], excludedByReset: 1 });
    expect(records).toHaveLength(0);
  });
  it("treats interrupted/overlong timing as unknown and rejects future/backwards visits", async () => {
    const { service, records } = fixture();
    await service.ingest("guild", "member", { ...payload, visits: [{ ...visit, endReason: "INTERRUPTED" }, { ...visit, runRef: "b".repeat(64), endedAt: "2026-10-01T00:00:00Z" }] }, now);
    expect(records).toEqual([expect.objectContaining({ durationSeconds: null }), expect.objectContaining({ durationSeconds: null })]);
    await expect(service.ingest("guild", "member", { ...payload, visits: [{ ...visit, endedAt: "2030-01-01T00:00:00Z" }] }, now)).rejects.toThrow("future");
    expect(() => poeUploadSchema.parse({ ...payload, visits: [{ ...visit, endedAt: "2026-09-29T00:00:00Z" }] })).toThrow();
  });
  it("allows only bounded observations, with no claimed clear/loot/points or raw chat", () => {
    for (const extra of [{ completed: true }, { points: 100 }, { rawLog: "chat" }, { memberId: "other" }]) {
      expect(() => poeUploadSchema.parse({ ...payload, visits: [{ ...visit, ...extra }] })).toThrow();
    }
    expect(() => poeUploadSchema.parse({ ...payload, visits: Array(101).fill(visit) })).toThrow();
    expect(() => poeUploadSchema.parse({ ...payload, visits: [{ ...visit, areaId: "MapWorldsDesert" }] })).toThrow();
  });
  it("scopes recent runs and summaries to the guild, league and mode", async () => {
    const { service, tx } = fixture();
    await service.recent("guild", "member", "Pilot");
    expect(tx.poeMapVisit.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { guildId: "guild", memberId: "member", league: { equals: "Pilot", mode: "insensitive" } } }));
    const groupBy = vi.fn(async () => []);
    const db = { poeMapVisit: { groupBy }, member: { findMany: vi.fn(async () => []) } };
    await createPoeMappingService(db as never).summary("guild", "Pilot", "HARDCORE", 7, "member", now);
    expect(groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ guildId: "guild", memberId: "member", league: { equals: "Pilot", mode: "insensitive" }, mode: "HARDCORE" }) }));
  });
  it("counts portal re-entries of one map instance as one map", async () => {
    const groupBy = vi.fn(async () => [
      { memberId: "ann", instanceRef: "c".repeat(64), _count: { _all: 3, durationSeconds: 3 }, _sum: { durationSeconds: 900 } },
      { memberId: "ann", instanceRef: "d".repeat(64), _count: { _all: 1, durationSeconds: 0 }, _sum: { durationSeconds: null } },
      { memberId: "bob", instanceRef: null, _count: { _all: 2, durationSeconds: 2 }, _sum: { durationSeconds: 600 } }
    ]);
    const db = { poeMapVisit: { groupBy }, member: { findMany: vi.fn(async () => [{ id: "ann", displayName: "Ann" }, { id: "bob", displayName: "Bob" }]) } };
    expect(await createPoeMappingService(db as never).summary("guild", "pilot", "STANDARD", 7, undefined, now)).toEqual([
      { memberId: "ann", name: "Ann", maps: 2, visits: 4, timedVisits: 3, seconds: 900 },
      { memberId: "bob", name: "Bob", maps: 2, visits: 2, timedVisits: 2, seconds: 600 }
    ]);
    expect(groupBy).toHaveBeenCalledWith(expect.objectContaining({ by: ["memberId", "instanceRef"] }));
  });
  it("stores the optional instance reference and still accepts older companions", async () => {
    const { service, records } = fixture();
    await service.ingest("guild", "member", { ...payload, visits: [visit, { ...visit, runRef: "b".repeat(64), instanceRef: "c".repeat(64) }] }, now);
    expect(records).toEqual([expect.objectContaining({ instanceRef: null }), expect.objectContaining({ instanceRef: "c".repeat(64) })]);
    expect(() => poeUploadSchema.parse({ ...payload, visits: [{ ...visit, instanceRef: "seed 123" }] })).toThrow();
  });
  it("suggests the guild's observed leagues, most recent first", async () => {
    const groupBy = vi.fn(async () => [{ league: "Dawn of the Hunt" }, { league: "Standard" }]);
    expect(await createPoeMappingService({ poeMapVisit: { groupBy } } as never).leagueChoices("guild", " dawn ")).toEqual([{ name: "Dawn of the Hunt", value: "Dawn of the Hunt" }, { name: "Standard", value: "Standard" }]);
    expect(groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { guildId: "guild", league: { contains: "dawn", mode: "insensitive" } }, take: 25 }));
  });
  it("turns internal area IDs into readable map names", () => {
    expect(poeAreaName("MapHiddenGrotto")).toBe("Hidden Grotto");
    expect(poeAreaName("MapAugury_NoBoss")).toBe("Augury No Boss");
    expect(poeAreaName("MapUberBoss2")).toBe("Uber Boss 2");
    expect(poeAreaName("MapQQ")).toBe("QQ");
  });
});

const line = (time: string, message: string, pid = "123") => `2026/09/30 ${time} 123456 2caa1afc [DEBUG Client ${pid}] ${message}`;
const profile = { character: "Ann", league: "Pilot", mode: "STANDARD" };
describe("PoE2 log parser", () => {
  it.each(['MapHiddenGrotto', 'MapAugury_NoBoss', 'MapUberBoss2'])("accepts the ID grammar %s without claiming current-patch coverage", areaId => {
    expect(parsePoeLogLine(line('12:00:00', `Generating level 80 area "${areaId}" with seed 123`))).toMatchObject({ kind: 'area', areaId });
  });
  it.each(['Abnormal disconnect', 'Abnormal disconnect: connection lost', 'Abnormal disconnect - connection lost'])("detects interruption independently of a login host: %s", message => {
    expect(parsePoeLogLine(line('12:00:00', message).replace('[DEBUG Client', '[INFO Client'))).toMatchObject({ kind: 'interrupted' });
  });
  it("does not treat chat quoting an interruption as an engine event", () => {
    expect(parsePoeLogLine(line('12:00:00', ': Name: Abnormal disconnect').replace('[DEBUG Client', '[INFO Client'))).toBeNull();
  });
  it("accepts observed PoE2 map engine messages and ignores chat, campaign and PoE1 maps", () => {
    const journal = { active: null, pending: [] };
    for (const area of ["G1_2", "HideoutFelled", "MapWorldsDesert"]) consumePoeEvent(journal, parsePoeLogLine(line("12:00:00", `Generating level 80 area "${area}" with seed 1`)), profile);
    expect(journal.active).toBeNull();
    expect(parsePoeLogLine(line("12:00:00", ': @From Someone: Generating level 80 area "MapSteppe" with seed 1'))).toBeNull();
    expect(parsePoeLogLine(line("12:00:00", 'Generating level 80 area "MapSteppe" with seed 1'))).toMatchObject({ kind: "area", areaId: "MapSteppe" });
    expect(parsePoeLogLine(line("25:00:00", 'Generating level 80 area "MapSteppe" with seed 1'))).toBeNull();
  });
  it("records separate portal visits, deduplicates repeated lines and never asserts a clear", () => {
    const journal = { active: null, pending: [] };
    const map = parsePoeLogLine(line("12:00:00", 'Generating level 80 area "MapSteppe" with seed 1'));
    consumePoeEvent(journal, map, profile); consumePoeEvent(journal, map, profile);
    expect(journal.pending).toHaveLength(0);
    consumePoeEvent(journal, parsePoeLogLine(line("12:05:00", 'Generating level 60 area "HideoutFelled" with seed 1')), profile);
    consumePoeEvent(journal, parsePoeLogLine(line("12:06:00", 'Generating level 80 area "MapSteppe" with seed 1')), profile);
    expect(journal.pending).toHaveLength(1);
    expect(journal.pending[0]).toMatchObject({ areaId: "MapSteppe", endReason: "AREA_CHANGED" });
    expect(journal.pending[0]).not.toHaveProperty("completed");
  });
  it("gives portal re-entries the same instance and never keeps the seed", () => {
    const journal = { active: null, pending: [] as { runRef: string; instanceRef?: string }[] };
    const enter = (time: string, area: string, seed: string) => consumePoeEvent(journal, parsePoeLogLine(line(time, `Generating level 80 area "${area}" with seed ${seed}`)), profile);
    enter("12:00:00", "MapSteppe", "4242"); enter("12:05:00", "HideoutFelled", "1");
    enter("12:06:00", "MapSteppe", "4242"); enter("12:09:00", "HideoutFelled", "1");
    enter("12:10:00", "MapSteppe", "777"); enter("12:15:00", "HideoutFelled", "1");
    expect(journal.pending).toHaveLength(3);
    const [first, reentry, other] = journal.pending as [{ runRef: string; instanceRef?: string }, { runRef: string; instanceRef?: string }, { runRef: string; instanceRef?: string }];
    expect(first.instanceRef).toMatch(/^[a-f0-9]{64}$/);
    expect(reentry.instanceRef).toBe(first.instanceRef);
    expect(reentry.runRef).not.toBe(first.runRef);
    expect(other.instanceRef).not.toBe(first.instanceRef);
    expect(JSON.stringify(journal)).not.toMatch(/4242|777|seed/);
  });
  it("marks process changes as interrupted and ignores out-of-order transitions", () => {
    const journal = { active: null, pending: [] };
    consumePoeEvent(journal, parsePoeLogLine(line("12:00:00", 'Generating level 80 area "MapSteppe" with seed 1')), profile);
    consumePoeEvent(journal, parsePoeLogLine(line("11:59:00", 'Generating level 60 area "HideoutFelled" with seed 1')), profile);
    expect(journal.pending).toHaveLength(0);
    consumePoeEvent(journal, parsePoeLogLine(line("12:05:00", 'Generating level 60 area "HideoutFelled" with seed 1', "124")), profile);
    expect(journal.pending[0]).toMatchObject({ endReason: "INTERRUPTED" });
  });
});
