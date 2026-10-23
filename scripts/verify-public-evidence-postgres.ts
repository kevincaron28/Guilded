// Uses existing schema in an isolated database. Creates/removes only its own fixtures.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createPrismaClient } from "../src/database.js";
import { dungeonRunSchema } from "../src/services/dungeon-rules.js";
import { ingestPublicRuns, prismaPublicRunStore, summarize } from "../src/services/public-runs.js";
const url = new URL(process.env["TEST_DATABASE_URL"] ?? "");
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.pathname !== "/guilded_release_test") throw new Error("Disposable local test database required.");
const db = createPrismaClient(url.toString());
const store = prismaPublicRunStore(db);
const end = Math.floor(Date.now() / 1000) - 60;
const input = dungeonRunSchema.parse({ id: `evidence-test-${randomUUID()}`, protocolVersion: 1, state: "COMPLETED", instanceId: 389,
  name: "Ragefire Chasm", difficultyId: 0, startedAt: end - 1500, endedAt: end, completedBy: "manual", recorder: "Kev",
  encounters: [{ id: 1, success: true, at: end - 900 }],
  players: ["Kev", "Amy", "Bob"].map(character => ({ character, realm: "Test", level: 16, minLevel: 16, presentSec: 1500 })) });
const summary = summarize(input);
const race = { ...input, id: `${input.id}-race` };
try {
  // Force every first reader to observe the same missing run, then race real inserts.
  let readers = 0;
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const racingStore = { ...store, async findRun(key: string) {
    if (key === `${race.instanceId}:${race.id}` && readers < 3) {
      const result = await store.findRun(key);
      if (++readers === 3) release();
      await barrier; return result;
    }
    return store.findRun(key);
  } };
  const raced = await Promise.all(["Kev", "Amy", "Bob"].map(character => ingestPublicRuns(racingStore,
    { uploaderKey: `fixture:race:${character}`, character, source: "personal", runs: [race] })));
  assert.equal(raced.flatMap(r => r.accepted).length, 1);
  assert.equal(raced.flatMap(r => r.confirmed).length, 2);
  assert.equal((await db.publicRun.findUniqueOrThrow({ where: { runKey: `${race.instanceId}:${race.id}` } })).confirmations, 3);
  await store.createRun(summary, { key: "fixture:first", reporters: ["kev"] }, "personal");
  const stored = (await store.findRun(summary.runKey))!;
  const full = { ...summary, completedBy: "final boss", encounters: [...summary.encounters, { id: 2, success: true as const, at: end - 10 }] };
  await store.addUpload(stored.id, { key: "fixture:copy", reporters: ["kev"] }, full);
  assert.equal((await store.findRun(summary.runKey))?.completedBy, "final boss");
  // Concurrent copies of Bob's report count once, even with distinct uploader accounts.
  await Promise.all(Array.from({ length: 5 }, (_, i) => store.addUpload(stored.id, { key: `fixture:bob-${i}`, reporters: ["bob"] }, full)));
  let row = await db.publicRun.findUniqueOrThrow({ where: { id: stored.id }, include: { players: true, uploads: true } });
  assert.equal(row.confirmations, 2);
  assert.equal(row.players.length, 3);
  assert.equal(row.uploads.length, 7);
  await store.addUpload(stored.id, { key: "fixture:bad", reporters: ["amy"] }, { ...full, difficultyId: 9 });
  await store.addUpload(stored.id, { key: "fixture:later", reporters: ["amy"] }, full);
  row = await db.publicRun.findUniqueOrThrow({ where: { id: stored.id }, include: { players: true, uploads: true } });
  assert.equal(row.status, "DISPUTED");
  assert.equal(row.confirmations, 2);
  console.log("Public evidence: atomic promotion, independent concurrent confirmations, party preservation and sticky disputes passed.");
} finally {
  await db.publicRun.deleteMany({ where: { runKey: { in: [summary.runKey, `${race.instanceId}:${race.id}`] } } });
  await db.$disconnect();
}
