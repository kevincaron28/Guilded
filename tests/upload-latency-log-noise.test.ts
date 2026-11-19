import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/database.js", () => ({ prisma: {} }));
vi.mock("../src/config.js", () => ({ config: { COMPANION_API_PORT: 0, COMPANION_API_HOST: "127.0.0.1" } }));

import { z } from "zod";
import { applyFinishedLine, shouldLogStandings, resetStandingsHeartbeat, STANDINGS_HEARTBEAT_MS } from "../src/companion-api.js";
import { clearGuildMembershipCache, guildMembership, withOwnNames } from "../src/services/guild-participants.js";
import { pairingCandidatesWhere } from "../src/services/character-pairing.js";
import { NICKNAME_LOG_REPEAT_MS, resetNicknameLogThrottle, shouldLogNicknameSync, type NicknameSyncResult } from "../src/services/nickname-sync.js";

describe("import-apply-finished", () => {
  it("says late=1 only for an apply that ended after the answer went out", () => {
    expect(applyFinishedLine({ guildHash: "ab12cd34", ms: 36000, late: true, ok: true })).toBe("import-apply-finished guild=ab12cd34 ms=36000 late=1 ok=1");
    expect(applyFinishedLine({ guildHash: "ab12cd34", ms: 800, late: false, ok: false })).toBe("import-apply-finished guild=ab12cd34 ms=800 late=0 ok=0");
    // (9.4) A failed apply says why: reason, code, and the count of each failing check for unreadable data (no values).
    const zod = z.object({ players: z.array(z.object({ realm: z.string().min(1) })) }).safeParse({ players: [{ realm: "" }, { realm: "" }] });
    expect(zod.success).toBe(false);
    expect(applyFinishedLine({ guildHash: "ab12cd34", ms: 800, late: false, ok: false, error: zod.success ? null : zod.error }))
      .toBe("import-apply-finished guild=ab12cd34 ms=800 late=0 ok=0 reason=invalid-payload code=- transient=0 checks=players[].realm:too_smallx2");
    expect(applyFinishedLine({ guildHash: "ab12cd34", ms: 800, late: false, ok: false, error: Object.assign(new Error("x"), { code: "P2028" }) }))
      .toBe("import-apply-finished guild=ab12cd34 ms=800 late=0 ok=0 reason=transaction-timeout code=P2028 transient=1");
  });
});

describe("standings log sampling", () => {
  beforeEach(() => resetStandingsHeartbeat());
  const ok = (guild: string, ms: number, wait: string | null = "12") => ({ guild, status: 200 as const, ms, wait });
  it("keeps errors, hang-ups and slow answers, and one heartbeat per guild per ten minutes", () => {
    const t0 = 1_000_000;
    expect(shouldLogStandings(ok("g", 12_100), t0)).toBe(true); // first: heartbeat
    expect(shouldLogStandings(ok("g", 12_100), t0 + 3_000)).toBe(false);
    expect(shouldLogStandings(ok("g", 40), t0 + 6_000)).toBe(false);
    expect(shouldLogStandings(ok("other", 40), t0 + 6_000)).toBe(true);
    expect(shouldLogStandings({ guild: "g", status: 500, ms: 10, wait: null }, t0 + 6_000)).toBe(true);
    expect(shouldLogStandings({ guild: "g", status: "closed", ms: 10, wait: null }, t0 + 6_000)).toBe(true);
    expect(shouldLogStandings(ok("g", 2_500, null), t0 + 6_000)).toBe(true); // plain answer over 2 s
    expect(shouldLogStandings(ok("g", 16_000, "12"), t0 + 6_000)).toBe(true); // long poll 4 s past its wait
    expect(shouldLogStandings(ok("g", 12_100), t0 + STANDINGS_HEARTBEAT_MS + 1)).toBe(true);
  });
});

describe("nickname sync log throttle", () => {
  beforeEach(() => resetNicknameLogThrottle());
  const quiet = { changes: [], applied: 0, failed: 0, skipped: "I need the Manage Nicknames permission.", stats: {} } as unknown as NicknameSyncResult;
  it("logs a repeated quiet line once a day and a changed or busy one at once", () => {
    const t0 = 5_000_000;
    expect(shouldLogNicknameSync("g", "line A", quiet, t0)).toBe(true);
    expect(shouldLogNicknameSync("g", "line A", quiet, t0 + 3_600_000)).toBe(false);
    expect(shouldLogNicknameSync("h", "line A", quiet, t0 + 3_600_000)).toBe(true);
    expect(shouldLogNicknameSync("g", "line B", quiet, t0 + 3_700_000)).toBe(true);
    expect(shouldLogNicknameSync("g", "line B", { ...quiet, applied: 2 }, t0 + 3_800_000)).toBe(true);
    expect(shouldLogNicknameSync("g", "line B", undefined, t0 + 3_900_000)).toBe(true); // did not run: always
    expect(shouldLogNicknameSync("g", "line B", quiet, t0 + 3_900_000 + NICKNAME_LOG_REPEAT_MS + 1)).toBe(true);
  });
});

describe("setup status line", () => {
  it("is one line for all unfinished servers", async () => {
    const { unfinishedSetupLine } = await import("../src/commands/setup.js");
    expect(unfinishedSetupLine([])).toBeNull();
    const line = unfinishedSetupLine([{ name: "A", missing: ["x", "y"] }, { name: "B", missing: ["z"] }]);
    expect(line).toBe('Setup not finished for 2 servers: "A" (x; y), "B" (z). Run /setup start in Discord.');
    expect(line).not.toContain("\n");
  });
});

describe("pairing candidates", () => {
  it("narrows to the edition and the first name for WoW Forever", () => {
    expect(pairingCandidatesWhere("g1", { name: "Lebowski Holyroller", gameEdition: "forever" })).toEqual({ guildId: "g1", gameEdition: "forever", name: { startsWith: "Lebowski", mode: "insensitive" } });
    expect(pairingCandidatesWhere("g1", { name: "Lebowski" })).toMatchObject({ name: { startsWith: "Lebowski" } });
  });
});

describe("membership read", () => {
  beforeEach(() => clearGuildMembershipCache());
  it("concurrent uploads share one read, and withOwnNames adds the uploader on top", async () => {
    let reads = 0;
    const db = {
      guildRosterEntry: { findMany: async () => { reads++; await new Promise((r) => setTimeout(r, 20)); return [{ nameKey: "amy jones", inGuild: true, observedAt: new Date() }]; } },
      character: { findMany: async () => [{ name: "Bob Smith" }] }
    };
    const now = new Date();
    const [a, b] = await Promise.all([guildMembership(db, "g1", now), guildMembership(db, "g1", now)]);
    expect(reads).toBe(1);
    expect(a.names).toEqual(expect.arrayContaining(["amy jones", "bob smith"]));
    expect(withOwnNames(b, ["Kev Alpha"]).names).toContain("kev alpha");
    await guildMembership(db, "g1", now);
    expect(reads).toBe(1);
  });
});
