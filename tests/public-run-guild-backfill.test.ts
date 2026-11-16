import { describe, expect, it, vi } from "vitest";
import { backfillPublicRunGuilds } from "../src/services/public-run-guild-backfill.js";

describe("public run guild backfill", () => {
  it("reads public runs without a guild in pages and fills only rows that have none", async () => {
    const pages = [Array.from({ length: 500 }, (_, i) => ({ id: `a${i}` })), [{ id: "b1" }]];
    const findMany = vi.fn(async (...args: unknown[]) => { void args; return pages.shift() ?? []; });
    const executeRaw = vi.fn(async (...args: unknown[]) => { void args; return 2; });
    const result = await backfillPublicRunGuilds({ publicRun: { findMany }, $executeRaw: executeRaw } as never);
    expect(result).toEqual({ runs: 501, fromRuns: 4, fromRosters: 4 });
    expect(findMany.mock.calls[0]![0]).toMatchObject({ where: { players: { some: { guild: null } } }, orderBy: { id: "asc" }, take: 500 });
    expect(findMany.mock.calls[1]![0]).toMatchObject({ cursor: { id: "a499" }, skip: 1 });
    const sql = (executeRaw.mock.calls as unknown as { strings: string[] }[][]).map((call) => call[0]!.strings.join("?"));
    expect(sql).toHaveLength(4);
    for (const text of sql) expect(text).toContain('p."guild" IS NULL');
    expect(sql[0]).toContain('"DungeonRunPlayer"');
    expect(sql[1]).toContain('"GuildRosterEntry"');
  });
  it("reports a failed batch and carries on", async () => {
    const onError = vi.fn();
    const findMany = vi.fn().mockResolvedValueOnce([{ id: "x" }]);
    const result = await backfillPublicRunGuilds({ publicRun: { findMany }, $executeRaw: vi.fn(async () => { throw new Error("boom"); }) } as never, onError);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(result.runs).toBe(1);
  });
});
