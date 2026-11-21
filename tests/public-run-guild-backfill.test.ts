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
  it("matches rosters on a server that has no WowGuild row (the live case: the 0-from-rosters bug)", async () => {
    // Production shape: Québec Gold is a default-scope Guild with a roster ("el pirata", inGuild) and no WowGuild rows at all.
    const executeRaw = vi.fn(async (...args: unknown[]) => { void args; return 0; });
    await backfillPublicRunGuilds({ publicRun: { findMany: vi.fn().mockResolvedValueOnce([{ id: "r1" }]) }, $executeRaw: executeRaw } as never);
    const roster = (executeRaw.mock.calls as unknown as { strings: string[] }[][])[1]![0]!.strings.join("?");
    // The Discord server's name ("⚜Quebec Gold⚜") is never the guild written on a public run; only what the server's companions reported is.
    expect(roster).not.toContain('g."name"');
    expect(roster).toContain('"CompanionDevice" d');
    expect(roster).toContain('d."wowGuildName"');
    expect(roster).toContain('count(*) >= 2');
    expect(roster).toContain('count(DISTINCT lower(d."wowGuildName")) = 1');
    expect(roster).toContain('LEFT JOIN "WowGuild" w'); // never an inner join: no WowGuild must not drop the row
    expect(roster).toContain('COALESCE(w."name", dn."name")');
    expect(roster).toContain('w."id" IS NULL'); // no WowGuild: the realm and ambiguity checks do not apply
    expect(roster).not.toMatch(/\n\s+JOIN "WowGuild"/);
    expect(roster).toContain('lower(normalize(p2."character", NFC))'); // the roster key is the NFC lower-case full name
    expect(roster).toContain(`g."scopeKey" <> 'default'`); // scoped guilds use their own WowGuild
  });
  it("reports a failed batch and carries on", async () => {
    const onError = vi.fn();
    const findMany = vi.fn().mockResolvedValueOnce([{ id: "x" }]);
    const result = await backfillPublicRunGuilds({ publicRun: { findMany }, $executeRaw: vi.fn(async () => { throw new Error("boom"); }) } as never, onError);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(result.runs).toBe(1);
  });
});
