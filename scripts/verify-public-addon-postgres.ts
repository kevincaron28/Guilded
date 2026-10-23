// Existing local disposable schema only; never runs migrations or starts a bot.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createPrismaClient } from "../src/database.js";
import { dungeonRunSchema } from "../src/services/dungeon-rules.js";
import { prismaPublicRunStore, summarize } from "../src/services/public-runs.js";
import { prismaLeaderboardStore } from "../src/services/public-leaderboard.js";
import { publicAddonBoard } from "../src/services/public-addon-board.js";
import { publicSeasons } from "../src/services/public-score.js";
import { loadOfficialWindows } from "../src/services/official-seasons.js";

const url = new URL(process.env["TEST_DATABASE_URL"] ?? "");
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.pathname !== "/guilded_release_test") throw new Error("Disposable local test database required.");
const db = createPrismaClient(url.toString());
const realm = `fixture-${randomUUID()}`, me = { character: "Tester", realm };
const end = Math.floor(Date.now() / 1000) - 60;
const keys: string[] = [];
try {
  for (const [role, seconds] of [["TANK", 2400], ["HEALER", 2000], [null, 1800]] as const) {
    const summary = summarize(dungeonRunSchema.parse({ id: `${realm}-${role}`, protocolVersion: 1, state: "COMPLETED", instanceId: 36,
      name: "The Deadmines", difficultyId: 0, startedAt: end - seconds, endedAt: end, recorder: "Tester", completedBy: "final boss", encounters: [],
      players: [{ ...me, ...(role ? { role } : {}), level: 20, minLevel: 20, presentSec: seconds }] }));
    keys.push(summary.runKey);
    await prismaPublicRunStore(db).createRun(summary, { key: realm, reporters: ["tester"] }, "personal");
  }
  const periods = publicSeasons(new Date(), await loadOfficialWindows(db));
  const load = async () => publicAddonBoard(await prismaLeaderboardStore(db).characterRuns(me.character, realm), me, periods)!;
  let board = await load();
  assert.equal(board.profiles[0]!.points, 267);
  assert.deepEqual(board.profiles[0]!.roles.map(r => r.points), [200, 240, 0]);
  assert.ok(board.profiles[0]!.roles[0]!.guidance?.routes.find(r => r.key === "36")?.next);
  await db.publicRun.updateMany({ where: { runKey: { in: keys } }, data: { status: "DISPUTED" } });
  board = await load();
  assert.equal(board.profiles[0]!.points, 0);
  assert.equal(board.profiles[0]!.guidance, null);
  console.log("Standalone public snapshot: actual realm-scoped database reads, role totals, scenarios and dispute corrections passed.");
} finally {
  await db.publicRun.deleteMany({ where: { runKey: { in: keys } } });
  await db.$disconnect();
}
