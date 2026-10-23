import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { reserveAiAttempt } from "../src/services/ai-budget.js";

// Called only by the disposable PostgreSQL harness. Real transactions exercise the lock.
export async function verifyAiBudgetPostgres(database: PrismaClient) {
  const day = new Date("2099-01-01T23:59:59Z");
  await database.aiDailyUsage.deleteMany({ where: { day: { in: ["2099-01-01", "2099-01-02"] } } });
  const attempts = await Promise.all(Array.from({ length: 20 }, (_, i) =>
    reserveAiAttempt(database, `pilot-${i % 2}`, { global: 7, guild: 4 }, day)));
  assert.equal(attempts.filter(Boolean).length, 7);
  const rows = await database.aiDailyUsage.findMany({ where: { day: "2099-01-01" } });
  assert.equal(rows.find(row => row.scope === "global")?.attempts, 7);
  assert.ok(rows.filter(row => row.scope !== "global").every(row => row.attempts <= 4));
  assert.equal(await reserveAiAttempt(database, "new-guild", { global: 7, guild: 4 }, day), false);
  assert.equal(await reserveAiAttempt(database, "pilot-0", { global: 7, guild: 4 }, new Date("2099-01-02T00:00:00Z")), true);
  assert.equal(await reserveAiAttempt(database, "pilot-0", { global: 0, guild: 4 }, day), false);
}
