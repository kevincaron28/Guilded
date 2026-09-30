import { describe, expect, it, vi } from "vitest";
import { syncProfessionSnapshot } from "../src/services/profession-snapshot.js";

const character = { id: "c", name: "Ray", realm: "Realm" };
const at = new Date("2026-09-30T10:00:00Z");
function fake(updatedAt: Date | null = null) {
  return {
    character: { findUnique: vi.fn(async () => ({ professionsUpdatedAt: updatedAt })), update: vi.fn() },
    professionSkill: { deleteMany: vi.fn(), upsert: vi.fn() },
    recipeKnown: { deleteMany: vi.fn() }, professionCooldown: { deleteMany: vi.fn() }
  };
}
describe("complete profession snapshots", () => {
  it("removes an unlearned skill, recipes and cooldowns while retaining the remaining profession", async () => {
    const db = fake();
    await syncProfessionSnapshot(db as never, "g", character, [{ name: "Mining", skillLevel: 300 }], true, at);
    expect(db.professionSkill.deleteMany).toHaveBeenCalledWith({ where: { characterId: "c", profession: { notIn: ["Mining"] } } });
    const where = { guildId: "g", character: "Ray", realm: "Realm", profession: { notIn: ["Mining"] } };
    expect(db.recipeKnown.deleteMany).toHaveBeenCalledWith({ where });
    expect(db.professionCooldown.deleteMany).toHaveBeenCalledWith({ where });
    expect(db.character.update).toHaveBeenCalledWith({ where: { id: "c" }, data: { professionsUpdatedAt: at } });
  });
  it("accepts a confirmed empty list but never deletes skills when the API was unavailable", async () => {
    const complete = fake();
    await syncProfessionSnapshot(complete as never, "g", character, [], true, at);
    expect(complete.professionSkill.deleteMany).toHaveBeenCalledWith({ where: { characterId: "c", profession: { notIn: [] } } });
    const unknown = fake();
    await syncProfessionSnapshot(unknown as never, "g", character, [], false, at);
    expect(unknown.professionSkill.deleteMany).not.toHaveBeenCalled();
    expect(unknown.character.update).not.toHaveBeenCalled();
  });
  it.each([true, false])("does not resurrect removed skills from stale or legacy reports (complete=%s)", async (complete) => {
    const db = fake(at);
    expect(await syncProfessionSnapshot(db as never, "g", character, [{ name: "Alchemy", skillLevel: 300 }], complete, new Date(at.getTime() - 1000))).toBe(false);
    expect(db.professionSkill.upsert).not.toHaveBeenCalled();
    expect(db.professionSkill.deleteMany).not.toHaveBeenCalled();
  });
});
