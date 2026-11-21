import { describe, expect, it, vi } from "vitest";
import { createRaidService } from "../src/services/raid.js";

describe("raid notes", () => {
  it("stores a trimmed note with an optional boss", async () => {
    const database = {
      raid: { findFirst: vi.fn().mockResolvedValue({ id: "r1" }) },
      raidNote: { create: vi.fn().mockImplementation(async ({ data }) => data) }
    };
    const note = await createRaidService(database as never).addNote("r1", "g1", "  Stack tighter on Rag  ", "officer", " Ragnaros ");
    expect(note).toEqual({ raidId: "r1", body: "Stack tighter on Rag", createdBy: "officer", bossName: "Ragnaros" });
  });

  it("refuses notes for raids in another guild", async () => {
    const database = { raid: { findFirst: vi.fn().mockResolvedValue(null) }, raidNote: { create: vi.fn() } };
    await expect(createRaidService(database as never).addNote("r1", "other", "text", "o")).rejects.toThrow("not found");
    expect(database.raidNote.create).not.toHaveBeenCalled();
  });
});
