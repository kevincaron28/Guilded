import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Bug sweep 7 Nov (P2028): the standings feed's RepeatableRead transaction ran its 15 s budget out
// under load. Only the reads that must agree in one snapshot stay inside it; the guild board, bank,
// calendar, raids, public raids, dungeon board and items are read before it with the plain client.

// Records every table the code touches; every query answers an empty result.
function recordingDb() {
  const touched = new Set<string>();
  const empty = new Proxy({}, { get: (_, method) => async () => (String(method).startsWith("find") && String(method) !== "findMany" ? null : String(method).startsWith("aggregate") ? {} : []) });
  const db = new Proxy({}, {
    get: (_, model) => {
      if (typeof model !== "string") return undefined;
      if (model.startsWith("$")) return async () => [];
      touched.add(model);
      return empty;
    }
  });
  return { db, touched };
}

describe("the standings transaction", () => {
  it("reads only the standings, base GP, accounts and the ledger, loot and run refs", async () => {
    const { standingsConsistentReads } = await import("../src/companion-api.js");
    const { db, touched } = recordingDb();
    const result = await standingsConsistentReads(db as never, "g1", "m1");
    expect(Object.keys(result).sort()).toEqual(["acceptedLedgerRefs", "acceptedLootRefs", "acceptedRunRefs", "accounts", "baseGp", "standings"]);
    const allowed = new Set(["guildSettings", "dungeonRun", "character", "member", "epgpTransaction", "lootAward", "raidAttendance", "raid", "raidCore", "coreMember"]);
    for (const model of ["guildSettings", "dungeonRun", "character", "lootAward"]) expect(touched.has(model), model).toBe(true);
    expect([...touched].filter((model) => !allowed.has(model))).toEqual([]);
    for (const model of ["poll", "pollVote", "boardPost", "guildBankSnapshot", "bankRequest", "guildBankTarget", "calendarEvent", "dungeonSeason", "lootRule"]) expect(touched.has(model)).toBe(false);
  }, 60_000);

  it("runs nothing else inside the transaction", () => {
    const source = readFileSync(new URL("../src/companion-api.ts", import.meta.url), "utf8");
    const body = source.slice(source.indexOf("async function standingsParts("), source.indexOf("export async function standingsConsistentReads("));
    const transactions = body.match(/prisma\.\$transaction\([^\n]*/g) ?? [];
    expect(transactions).toEqual([expect.stringContaining("standingsConsistentReads(transaction as unknown as PrismaClient, guild.id, access.memberId)")]);
    // The other reads use the plain client, before the transaction.
    for (const read of ["boardForAddon(prisma", "bankForAddon(prisma", "upcomingRaidsForAddon(prisma", "publicRaids(prisma", "addonDungeonBoard(prisma", "itemInsights(prisma", "nextRaidRoster(prisma"]) {
      expect(body.indexOf(read), read).toBeGreaterThan(-1);
      expect(body.indexOf(read), read).toBeLessThan(body.indexOf("prisma.$transaction("));
    }
  });
});
