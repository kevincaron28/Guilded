import { describe, expect, it } from "vitest";
import { parseResetArgs, selectSkillsToRemove, type SkillRow } from "../src/services/profession-reset.js";

const row = (id: string, updatedAt: string, realm = "Classic Beta PvP"): SkillRow => ({ id, profession: "Mining", character: `C${id}`, realm, updatedAt: new Date(updatedAt) });
const before = new Date("2026-11-04T23:00:00Z");

describe("selectSkillsToRemove", () => {
  const rows = [row("old", "2026-10-20T00:00:00Z"), row("new", "2026-11-05T01:00:00Z"), row("edge", "2026-11-04T23:00:00Z"), row("oldForever", "2026-10-21T00:00:00Z", "CAMWOW US2 Realm 2 PvP")];

  it("removes only rows stored before the cutoff", () => {
    expect(selectSkillsToRemove(rows, before).map((r) => r.id)).toEqual(["old", "oldForever"]);
  });

  it("can be limited to one realm, ignoring case and spacing", () => {
    expect(selectSkillsToRemove(rows, before, " classic beta pvp ").map((r) => r.id)).toEqual(["old"]);
  });
});

describe("parseResetArgs", () => {
  const now = Date.parse("2026-11-05T12:00:00Z");
  it("previews unless --apply is given", () => {
    expect(parseResetArgs(["--guild", "1", "--before", "2026-11-04T23:00:00Z"], now).apply).toBe(false);
    expect(parseResetArgs(["--guild", "1", "--before", "2026-11-04T23:00:00Z", "--apply"], now).apply).toBe(true);
  });
  it("requires a guild and a past date", () => {
    expect(() => parseResetArgs(["--before", "2026-11-04T23:00:00Z"], now)).toThrow("Usage");
    expect(() => parseResetArgs(["--guild", "1", "--before", "nope"], now)).toThrow("not a date");
    expect(() => parseResetArgs(["--guild", "1", "--before", "2026-12-01T00:00:00Z"], now)).toThrow("future");
  });
});
