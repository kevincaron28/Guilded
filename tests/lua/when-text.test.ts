import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// Bot timestamps (ISO, UTC) shown in the player's own time instead of "2026-10-16T15:56:40.149Z".
let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

describe("util.whenText", () => {
  it("says today, yesterday or the date, in local time, and ignores what it cannot read", () => {
    session = newLuaSession();
    const s = session;
    s.run(`NS = {}; GetServerTime = function() return NOW end`);
    s.load("Util.lua");
    // The expected text is computed with the same local clock the addon uses.
    const at = "2026-10-16T15:56:40.149Z";
    s.run(`NOW = NS.util.isoEpoch("${at}") + 3600`);
    expect(s.run(`return NS.util.whenText("${at}")`)).toBe(s.run(`return "today " .. date("%H:%M", NS.util.isoEpoch("${at}"))`));
    s.run(`NOW = NOW + 86400`);
    expect(s.run(`return NS.util.whenText("${at}")`)).toMatch(/^yesterday \d\d:\d\d$/);
    s.run(`NOW = NOW + 5 * 86400`);
    expect(s.run(`return NS.util.whenText("${at}")`)).toMatch(/^\d\d\/\d\d \d\d:\d\d$/);
    expect(s.run(`return tostring(NS.util.whenText("not a date"))`)).toBe("nil");
  });
});
