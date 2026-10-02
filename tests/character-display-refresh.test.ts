import { describe, expect, it, vi } from "vitest";
import { queueCharacterDisplayRefresh } from "../src/services/character-display-refresh.js";

function database(enabled = true, owned = [{ id: "character" }]) {
  return { guildSettings: { findUnique: vi.fn().mockResolvedValue({ characterSignups: enabled }) }, character: { findMany: vi.fn().mockResolvedValue(owned) },
    raidCore: { findMany: vi.fn().mockResolvedValue([{ id: "core" }]) }, raid: { findMany: vi.fn().mockResolvedValue([{ id: "raid" }]) }, discordJob: { upsert: vi.fn().mockResolvedValue({ id: "job" }) } };
}
describe("character display refresh queue", () => {
  it("queues durable edits for affected primaries, backups and selected raid characters", async () => {
    const db = database();
    expect(await queueCharacterDisplayRefresh(db as never, "guild", ["character", "foreign"])).toHaveLength(2);
    expect(db.character.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["character", "foreign"] }, member: { guildId: "guild" } } }));
    expect(db.raidCore.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { guildId: "guild", members: { some: { OR: [{ characterId: { in: ["character"] } }, { backups: { some: { characterId: { in: ["character"] } } } }] } } } }));
    expect(db.discordJob.upsert.mock.calls.map(([call]) => call.create.kind)).toEqual(["CORE_ROSTER", "RAID_POST"]);
  });
  it("does not refresh a foreign character or a guild using legacy account signups", async () => {
    for (const db of [database(false), database(true, [])]) {
      expect(await queueCharacterDisplayRefresh(db as never, "guild", ["foreign"])).toEqual([]);
      expect(db.discordJob.upsert).not.toHaveBeenCalled();
    }
  });
  it("hourly refresh includes active displays without reopening completed raids", async () => {
    const db = database();await queueCharacterDisplayRefresh(db as never, "guild");
    expect(db.character.findMany).not.toHaveBeenCalled();
    expect(db.raid.findMany).toHaveBeenCalledWith({ where: { guildId: "guild", status: { in: ["PLANNED", "ACTIVE"] } }, select: { id: true } });
  });
});
