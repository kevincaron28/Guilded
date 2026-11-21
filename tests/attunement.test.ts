import { describe, expect, it, vi } from "vitest";
import { createAttunementService } from "../src/services/attunement.js";

describe("attunement service", () => {
  it("rejects a name that is too short before touching the database", () => {
    const service = createAttunementService({} as never);
    expect(() => service.set("character1", "X", true, "discord")).toThrow("Attunement name is required");
  });

  it("upserts a trimmed attunement record", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: "attune1", name: "Onyxia Key", completed: true });
    const database = { characterAttunement: { upsert } } as never;
    const service = createAttunementService(database);
    await service.set("character1", "  Onyxia Key  ", true, "discord");
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { characterId_name: { characterId: "character1", name: "Onyxia Key" } }
    }));
  });
});
