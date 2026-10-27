import { describe, expect, it } from "vitest";
import { integrityPresence, integrityRole, integrityStartReason, integrityWindowReason, UPLOAD_GRACE_MS } from "../src/services/dungeon-integrity.js";
import { dungeonRoleFixture } from "./fixtures/dungeon-role-contract.js";
import { summarize } from "../src/services/public-runs.js";
import { leaderRun } from "../src/services/public-leaderboard.js";

const start = new Date("2026-11-05T01:00:00Z");
// Synthetic API contract inputs, never evidence of a live game session.
const witness = { version: 2, startWitness: "unknown", observer: "Tester", detectedAt: start.getTime()/1000-30,
  combatAt:start.getTime()/1000, startTrigger: "first combat", continuous: true };
describe("current-v2 evidence foundation (not activation)", () => {
  it.each([undefined, null, {}, { ...witness, observer: undefined }, { ...witness, startTrigger: "manual" }, { ...witness, continuous: false }, { ...witness, detectedAt: start.getTime() / 1000 + 60 }])("keeps incomplete start evidence provisional: %j", evidence => {
    expect(integrityStartReason(evidence, start, 1200)).toBeTruthy();
  });
  it("accepts observed combat with unknown freshness, but rejects late attachment", () => {
    expect(integrityStartReason(witness, start, 1200)).toBeUndefined();
    expect(integrityStartReason({ ...witness, detectedAt: start.getTime() / 1000 + 6 }, start, 1200)).toBeTruthy();
  });
  it("requires 80 percent known observation and excludes mixed roles from role ranks", () => {
    const p = { knownSec: 800, unknownSec: 200, lockedRole: "DPS", mixedRole: false, knownIntervals:[[100,900]] };
    expect(integrityPresence(p, 1000)).toBe(true);
    expect(integrityPresence({ ...p, knownSec: 799 }, 1000)).toBe(false);
    expect(integrityPresence({ ...p, knownSec: 801 }, 1000)).toBe(false);
    expect(integrityPresence(undefined, 1000)).toBe(false);
    expect(integrityRole(p)).toBe("DPS");
    expect(integrityRole({ ...p, mixedRole: true })).toBeNull();
    expect(integrityPresence({ ...p, mixedRole: true }, 1000)).toBe(true);
  });
  it("defines half-open season and 72-hour upload boundaries", () => {
    const window = { from: new Date("2026-11-05T00:00:00Z"), to: new Date("2026-12-05T00:00:00Z") };
    const end = new Date(start.getTime() + 1200_000), deadline = window.to.getTime() + UPLOAD_GRACE_MS;
    expect(integrityWindowReason(start, end, new Date(deadline - 1), window)).toBeUndefined();
    expect(integrityWindowReason(start, end, new Date(deadline), window)).toBe("Season upload grace expired");
    expect(integrityWindowReason(new Date(window.from.getTime() - 1), end, end, window)).toBe("Run crosses season boundary");
    expect(integrityWindowReason(start, window.to, window.to, window)).toBe("Run crosses season boundary");
  });
  it.each([false, true])("preserves honest unknown witness through actual Lua export and public row mapping (standalone %s)", standalone => {
    const { run } = dungeonRoleFixture(standalone);
    expect(run.integrity).toMatchObject({ version: 2, startWitness: "unknown", startTrigger: "first combat", continuous: true });
    expect(integrityStartReason(run.integrity, new Date(run.startedAt! * 1000), run.endedAt! - run.startedAt!)).toBeUndefined();
    expect(run.players[0]?.integrity).toMatchObject({ knownSec: 1200, unknownSec: 0, lockedRole: "DPS", mixedRole: false });
    const summary = summarize(run, start);
    expect(summary.evidenceVersion).toBe(2);
    const row = leaderRun({ ...summary, id: "synthetic", confirmations: 1 } as never);
    expect(row.players[0]?.integrity).toEqual(run.players[0]?.integrity);
    expect(row.evidence?.integrity).toEqual(run.integrity);
  });
});
