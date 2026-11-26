import { describe, expect, it, vi } from "vitest";
import { reserveFor } from "../src/services/mobile-reserve.js";

const GUILD = "123456789";

function fakeDb() {
  return {
    member: { findFirst: vi.fn().mockResolvedValue({ id: "m1", guildId: "g1" }) },
    character: { findFirst: vi.fn().mockResolvedValue({ name: "Ann Smith", realm: "R" }) },
    reserveList: { findUnique: vi.fn().mockResolvedValue({ active: true, open: true, perPlayer: 1 }) },
    itemReserve: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
    recipeKnown: { findFirst: vi.fn().mockResolvedValue(null) },
    reserveRequest: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0), create: vi.fn().mockResolvedValue({}), deleteMany: vi.fn() }
  };
}

describe("phone app reserves", () => {
  const input = { guildDiscordId: GUILD, characterId: "c1", item: "item:19364" };

  it("asks for the member's own character", async () => {
    const db = fakeDb();
    expect(await reserveFor(db as never, "discord-1", input)).toMatchObject({ status: "ok", outcome: { kind: "requested", itemId: 19364 } });
    expect(db.character.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "c1", memberId: "m1" } }));
    expect(db.reserveRequest.create).toHaveBeenCalledWith({ data: expect.objectContaining({ guildId: "g1", memberId: "m1", character: "Ann Smith", remove: false }) });
  });

  it("refuses bad input, other people's characters and servers it does not serve", async () => {
    const db = fakeDb();
    expect(await reserveFor(db as never, "discord-1", { ...input, item: " " })).toEqual({ status: "invalid" });
    expect(await reserveFor(db as never, "discord-1", input, () => false)).toEqual({ status: "gone" });
    db.character.findFirst.mockResolvedValue(null);
    expect(await reserveFor(db as never, "discord-1", input)).toEqual({ status: "gone" });
    expect(db.reserveRequest.create).not.toHaveBeenCalled();
  });

  it("passes the member's refusal on and lets real failures fail", async () => {
    const db = fakeDb();
    db.reserveList.findUnique.mockResolvedValue({ active: true, open: false, perPlayer: 1 });
    expect(await reserveFor(db as never, "discord-1", input)).toMatchObject({ status: "refused", message: expect.stringContaining("No soft-reserve list is open") });
    db.reserveList.findUnique.mockRejectedValue(new TypeError("boom"));
    await expect(reserveFor(db as never, "discord-1", input)).rejects.toThrow("boom");
  });
});
