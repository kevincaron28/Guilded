import { describe, expect, it } from "vitest";
import { findInactive, formatInactive } from "../src/services/inactive.js";

const now = new Date("2026-10-01T00:00:00Z");
const day = 86_400_000;
const ago = (days: number) => new Date(now.getTime() - days * day);

describe("inactivity report", () => {
  const database = {
    member: {
      findMany: async () => [
        { displayName: "Active", createdAt: ago(200), characters: [{ name: "A1", isMain: true, lastSeenAt: ago(2) }] },
        { displayName: "Gone", createdAt: ago(200), characters: [{ name: "G1", isMain: true, lastSeenAt: ago(60) }, { name: "G2", isMain: false, lastSeenAt: ago(45) }] },
        { displayName: "Never", createdAt: ago(100), characters: [{ name: "N1", isMain: true, lastSeenAt: null }] },
        { displayName: "NoChar", createdAt: ago(90), characters: [] }
      ]
    }
  };

  it("lists members with no recent sighting, longest gone first, never-seen last", async () => {
    const rows = await findInactive(database as never, "g", 30, now);
    expect(rows.map((row) => row.member)).toEqual(["Gone", "Never", "NoChar"]);
    // The newest sighting of any character counts (45 days, not 60).
    expect(Math.round((now.getTime() - rows[0]!.lastSeen!.getTime()) / day)).toBe(45);
  });

  it("formats a read-only report", async () => {
    const rows = await findInactive(database as never, "g", 30, now);
    const text = formatInactive(rows, 30);
    expect(text).toContain("Not seen in 30+ days** (3)");
    expect(text).toContain("**Gone** (G1)");
    expect(text).toContain("never seen in game");
    expect(text).toContain("no character linked");
    expect(formatInactive([], 30)).toContain("Everyone has been seen");
  });
});
