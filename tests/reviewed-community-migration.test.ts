import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Real embedded PostgreSQL executes the additive SQL/constraints. Multi-client
// advisory-lock behavior is covered by scripts/verify-reviewed-community.ts on
// the existing disposable PostgreSQL CI service, not claimed from this test.
const database = new PGlite();
beforeAll(async () => {
  await database.exec(`CREATE TABLE "Guild" (id TEXT PRIMARY KEY);
    CREATE TABLE "Member" (id TEXT PRIMARY KEY);
    CREATE TABLE "GuildSettings" ("guildId" TEXT PRIMARY KEY, "language" TEXT NOT NULL);
    CREATE TABLE "GroupAlert" (id TEXT PRIMARY KEY, kinds TEXT[] NOT NULL);
    INSERT INTO "Guild" VALUES ('guild'); INSERT INTO "Member" VALUES ('member');
    INSERT INTO "GuildSettings" VALUES ('guild', 'fr'); INSERT INTO "GroupAlert" VALUES ('alert', ARRAY['DUNGEON']);`);
  await database.exec(readFileSync(new URL("../prisma/migrations/20261129000000_reviewed_community_flows/migration.sql", import.meta.url), "utf8"));
});
afterAll(() => database.close());

describe("reviewed community additive migration", () => {
  it("retains legacy rows and defaults all new delivery gates off", async () => {
    expect((await database.query('SELECT * FROM "GuildSettings"')).rows).toEqual([{ guildId: "guild", language: "fr", targetedAlertsEnabled: false, targetedAlertsChannelId: null }]);
    expect((await database.query('SELECT * FROM "GroupAlert"')).rows).toEqual([{ id: "alert", kinds: ["DUNGEON"], subscription: null }]);
  });
  it("enforces event reservation uniqueness and retains uncertain attempts", async () => {
    await database.exec(`INSERT INTO "TargetedAlertAttempt" (id,"guildId","memberId","eventKey","channelId",status) VALUES ('a','guild','member','group:1','channel','UNCERTAIN')`);
    await expect(database.exec(`INSERT INTO "TargetedAlertAttempt" (id,"guildId","memberId","eventKey","channelId") VALUES ('b','guild','member','group:1','channel')`)).rejects.toMatchObject({ code: "23505" });
    expect((await database.query('SELECT status FROM "TargetedAlertAttempt"')).rows).toEqual([{ status: "UNCERTAIN" }]);
  });
  it("allows only one weekly occurrence and refuses invalid cosmetic targets", async () => {
    await database.exec(`INSERT INTO "WeeklyQuestionOccurrence" (id,"guildId","weekKey",status,"channelId") VALUES ('a','guild','2026-10-26','SKIPPED','channel')`);
    await expect(database.exec(`INSERT INTO "WeeklyQuestionOccurrence" (id,"guildId","weekKey",status,"channelId") VALUES ('b','guild','2026-10-26','ATTEMPTED','channel')`)).rejects.toMatchObject({ code: "23505" });
    await expect(database.exec(`INSERT INTO "CooperativeGoal" ("guildId","seasonId",edition,"seasonStartsAt",target,metric,"startsAt","endsAt",rules,"rulesHash","createdBy","updatedAt")
      VALUES ('guild','season','forever','2026-10-27',0,'dungeons','2026-10-27','2026-11-03','{}','hash','officer',CURRENT_TIMESTAMP)`)).rejects.toMatchObject({ code: "23514" });
  });
});
