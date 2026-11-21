import { describe, expect, it, vi } from "vitest";
import { findPlayer } from "../src/services/player-search.js";

describe("player search", () => {
  it("prefers an exact name and returns all of that member's characters", async () => {
    const findFirst = vi.fn().mockResolvedValueOnce({ name: "Bob", memberId: "m1" });
    const findMany = vi.fn().mockResolvedValue([
      { name: "Bob", isMain: true, member: { id: "m1", displayName: "Robert" } },
      { name: "Bobalt", isMain: false, member: { id: "m1", displayName: "Robert" } }
    ]);
    const found = await findPlayer({ character: { findFirst, findMany } } as never, "g1", " bob ");
    expect(found?.member.displayName).toBe("Robert");
    expect(found?.characters.map((c) => c.name)).toEqual(["Bob", "Bobalt"]);
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it("falls back to a partial match, and returns null when nothing matches", async () => {
    const findFirst = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    expect(await findPlayer({ character: { findFirst, findMany: vi.fn() } } as never, "g1", "zzz")).toBeNull();
    expect(findFirst).toHaveBeenCalledTimes(2);
  });
});
