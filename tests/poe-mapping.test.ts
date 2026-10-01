import { describe, expect, it, vi } from "vitest";
import { createPoeMappingService, poeUploadSchema } from "../src/services/poe-mapping.js";
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
    expect(tx.poeMapVisit.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { guildId: "guild", memberId: "member", league: "Pilot" } }));
    const groupBy = vi.fn(async () => []);
    const db = { poeMapVisit: { groupBy }, member: { findMany: vi.fn(async () => []) } };
    await createPoeMappingService(db as never).summary("guild", "Pilot", "HARDCORE", 7, "member", now);
    expect(groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ guildId: "guild", memberId: "member", league: "Pilot", mode: "HARDCORE" }) }));
  });
});

const line = (time: string, message: string, pid = "123") => `2026/09/30 ${time} 123456 2caa1afc [DEBUG Client ${pid}] ${message}`;
const profile = { character: "Ann", league: "Pilot", mode: "STANDARD" };
describe("PoE2 log parser", () => {
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
  it("marks process changes as interrupted and ignores out-of-order transitions", () => {
    const journal = { active: null, pending: [] };
    consumePoeEvent(journal, parsePoeLogLine(line("12:00:00", 'Generating level 80 area "MapSteppe" with seed 1')), profile);
    consumePoeEvent(journal, parsePoeLogLine(line("11:59:00", 'Generating level 60 area "HideoutFelled" with seed 1')), profile);
    expect(journal.pending).toHaveLength(0);
    consumePoeEvent(journal, parsePoeLogLine(line("12:05:00", 'Generating level 60 area "HideoutFelled" with seed 1', "124")), profile);
    expect(journal.pending[0]).toMatchObject({ endReason: "INTERRUPTED" });
  });
});
