import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { createPrismaClient } from "../src/database.js";
import { withEdition } from "../src/services/edition-context.js";
import { lockDungeonCalendar } from "../src/services/dungeon-calendar-lock.js";
import { freezeSeasonRules } from "../src/services/official-seasons.js";
import { readRuleSnapshot } from "../src/services/public-score.js";

/** Reproduce a calendar writer waiting longer than Prisma's default 5s execution
 * budget. This fixture and its lock run only against the disposable CI database. */
export async function verifySeasonCalendarPostgres() {
  const url = new URL(process.env["DATABASE_URL"] ?? "");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.pathname !== "/guilded_release_test") throw new Error("Disposable local test database required.");
  url.searchParams.set("connection_limit", "3");
  const database = createPrismaClient(url.toString());
  let id: string | undefined;
  try {
    await withEdition("retail", async () => {
      const fixture = await database.officialSeason.create({ data: { gameEdition: "retail", number: 2147483000, name: "Release calendar lock fixture", startsAt: new Date("2099-01-01T00:00:00Z") } });
      id = fixture.id;
      let acquired!: () => void;
      const ready = new Promise<void>(resolve => { acquired = resolve; });
      const holder = database.$transaction(async tx => {
        await lockDungeonCalendar(tx);
        acquired();
        await delay(6_000);
      }, { timeout: 15_000 });
      const writers = (async () => {
        await ready;
        return Promise.all([freezeSeasonRules(database, new Date("2100-01-01")), freezeSeasonRules(database, new Date("2100-01-01"))]);
      })();
      const [, results] = await Promise.all([holder, writers]);
      assert.equal(results.filter(result => result?.frozen).length, 1);
      assert.equal(results.filter(result => result === null).length, 1);
      const saved = await database.officialSeason.findUniqueOrThrow({ where: { id: fixture.id } });
      assert.ok(readRuleSnapshot(saved.rules));
      assert.equal(await freezeSeasonRules(database, new Date("2100-01-01")), null);
    });
  } finally {
    try { if (id) await database.officialSeason.delete({ where: { id } }); }
    finally { await database.$disconnect(); }
  }
}
