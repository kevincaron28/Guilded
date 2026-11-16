import { describe, expect, it, vi } from "vitest";
import { backfillPublicRunGuilds } from "../src/services/public-run-guild-backfill.js";

describe("public run guild backfill", () => {
  it("reads public runs without a guild in pages and fills only rows that have none", async () => {
    const pages = [Array.from({ length: 500 }, (_, i) => ({ id: `a${i}` })), [{ id: "b1" }]];
    const findMany = vi.fn(async (...args: unknown[]) => { void args; return pages.shift() ?? []; });
    const executeRaw = vi.fn(async (...args: unknown[]) => { void args; return 2; });
    const result = await backfillPublicRunGuilds({ publicRun: { findMany }, $executeRaw: executeRaw } as never);
    expect(result).toEqual({ runs: 501, fromRuns: 4, fromRosters: 4 });
    expect(findMany.mock.calls[0]![0]).toMatchObject({ where: { guildBackfillAt: null, players: { some: { guild: null } } }, orderBy: { id: "asc" }, take: 500 });
    expect(findMany.mock.calls[1]![0]).toMatchObject({ cursor: { id: "a499" }, skip: 1 });
    const sql = (executeRaw.mock.calls as unknown as { strings: string[] }[][]).map((call) => call[0]!.strings.join("?"));
    expect(sql).toHaveLength(6); // per page: run players, rosters of the run's own server, the looked-at marker
    for (const text of [sql[0]!, sql[1]!]) expect(text).toContain('"guild" IS NULL');
    expect(sql[1]).toContain('r."guildId"');
    expect(sql[2]).toContain('guildBackfillAt');
    expect(sql[0]).toContain('"DungeonRunPlayer"');
    expect(sql[1]).toContain('"GuildRosterEntry"');
    // a server with several WowGuilds is ambiguous: only its single guild, or the one a recording client named
    expect(sql[1]).toContain('"WowGuild" w2');
    expect(sql[1]).toContain('= 1');
    expect(sql[1]).toContain('lower(dq."guild") = lower(w."name")');
  });
  it("reports a failed batch and carries on", async () => {
    const onError = vi.fn();
    const findMany = vi.fn().mockResolvedValueOnce([{ id: "x" }]);
    const result = await backfillPublicRunGuilds({ publicRun: { findMany }, $executeRaw: vi.fn(async () => { throw new Error("boom"); }) } as never, onError);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(result.runs).toBe(1);
  });
});
