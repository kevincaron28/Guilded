import { describe, expect, it, vi } from "vitest";
import {
  exchangeCharacterPairingCode,
  hashCompanionSecret,
  issueCharacterPairingCode,
  linkPairedCharacter,
  revokeCompanionCredentials
} from "../src/services/character-pairing.js";

describe("character pairing", () => {
  it("stores only a hash of a short-lived one-time code", async () => {
    const upsert = vi.fn(async () => ({}));
    const issuedAt = new Date("2026-09-28T12:00:00Z");
    const result = await issueCharacterPairingCode({ characterPairing: { upsert } } as never, "guild", "member", issuedAt);

    expect(result.code).toMatch(/^[A-F0-9]{12}$/);
    expect(result.expiresAt.getTime() - issuedAt.getTime()).toBe(15 * 60_000);
    expect(upsert).toHaveBeenCalledWith({
      where: { guildId_memberId: { guildId: "guild", memberId: "member" } },
      create: { guildId: "guild", memberId: "member", codeHash: hashCompanionSecret(result.code), expiresAt: result.expiresAt },
      update: { codeHash: hashCompanionSecret(result.code), expiresAt: result.expiresAt, consumedAt: null }
    });
    expect(JSON.stringify(upsert.mock.calls)).not.toContain(result.code);
  });

  it("atomically consumes the code and returns a separate credential", async () => {
    const code = "A1B2C3D4E5F6";
    const now = new Date("2026-09-28T12:00:00Z");
    const tx = {
      characterPairing: {
        findFirst: vi.fn(async () => ({ id: "pair", memberId: "member", member: { discordUserId: "discord-user" } })),
        updateMany: vi.fn(async () => ({ count: 1 }))
      },
      companionCredential: { create: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 1 })) }
    };
    const database = { $transaction: async (callback: (client: typeof tx) => unknown) => callback(tx) };
    const result = await exchangeCharacterPairingCode(database as never, "discord-guild", ` ${code.toLowerCase()} `, now);

    expect(result.discordUserId).toBe("discord-user");
    expect(result.companionCredential).toHaveLength(43);
    expect(tx.characterPairing.findFirst).toHaveBeenCalledWith({
      where: { codeHash: hashCompanionSecret(code), guild: { discordId: "discord-guild" }, expiresAt: { gt: now }, consumedAt: null },
      select: { id: true, memberId: true, member: { select: { discordUserId: true } } }
    });
    expect(tx.characterPairing.updateMany).toHaveBeenCalledWith({
      where: { id: "pair", consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now }
    });
    expect(tx.companionCredential.updateMany).toHaveBeenCalledWith({
      where: { memberId: "member", revokedAt: null },
      data: { revokedAt: expect.any(Date) }
    });
    expect(tx.companionCredential.create).toHaveBeenCalledWith({
      data: { memberId: "member", tokenHash: hashCompanionSecret(result.companionCredential) }
    });
    expect(JSON.stringify(tx.companionCredential.create.mock.calls)).not.toContain(result.companionCredential);
  });

  it("rejects a code that is expired, used, or does not match the guild", async () => {
    const tx = {
      characterPairing: { findFirst: vi.fn(async () => null), updateMany: vi.fn() },
      companionCredential: { create: vi.fn() }
    };
    const database = { $transaction: async (callback: (client: typeof tx) => unknown) => callback(tx) };

    await expect(exchangeCharacterPairingCode(database as never, "guild", "NOPE")).rejects.toThrow(/invalid, expired, or already used/);
    expect(tx.characterPairing.updateMany).not.toHaveBeenCalled();
    expect(tx.companionCredential.create).not.toHaveBeenCalled();
  });

  it("rejects a lost race when another request already consumed the code", async () => {
    const tx = {
      characterPairing: {
        findFirst: vi.fn(async () => ({ id: "pair", memberId: "member", member: { discordUserId: "discord-user" } })),
        updateMany: vi.fn(async () => ({ count: 0 }))
      },
      companionCredential: { create: vi.fn() }
    };
    const database = { $transaction: async (callback: (client: typeof tx) => unknown) => callback(tx) };

    await expect(exchangeCharacterPairingCode(database as never, "guild", "A1B2C3D4E5F6")).rejects.toThrow(/invalid, expired, or already used/);
    expect(tx.companionCredential.create).not.toHaveBeenCalled();
  });

  it("links the exporter's own character as main on the first paired upload", async () => {
    const tx = {
      character: {
        findMany: vi.fn(async () => []),
        count: vi.fn(async () => 0),
        create: vi.fn(async () => ({ id: "character" }))
      },
      professionSkill: { upsert: vi.fn(async () => ({})) },
      unclaimedCharacter: { deleteMany: vi.fn(async () => ({ count: 1 })) }
    };
    const database = { $transaction: async (callback: (client: typeof tx) => unknown) => callback(tx) };
    const result = await linkPairedCharacter(database as never, "guild", "member", {
      name: "Ray", realm: "Forever", class: "PRIEST", race: "Scourge", level: 60, spec: "Holy",
      professions: [{ name: "Tailoring", skillLevel: 300 }]
    });

    expect(result).toBe("linked");
    expect(tx.character.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        memberId: "member", name: "Ray", realm: "Forever", className: "Priest",
        race: "Undead", level: 60, spec: "Holy", isMain: true
      })
    });
    expect(tx.professionSkill.upsert).toHaveBeenCalledWith({
      where: { characterId_profession: { characterId: "character", profession: "Tailoring" } },
      create: { characterId: "character", profession: "Tailoring", skillLevel: 300 },
      update: { skillLevel: 300 }
    });
    expect(tx.unclaimedCharacter.deleteMany).toHaveBeenCalledWith({ where: { guildId: "guild", nameKey: "ray" } });
  });

  it("revokes only the target member's active credentials, e.g. after an officer unlinks their character", async () => {
    const database = { companionCredential: { updateMany: vi.fn(async () => ({ count: 2 })) } };
    await revokeCompanionCredentials(database as never, "member");
    expect(database.companionCredential.updateMany).toHaveBeenCalledWith({
      where: { memberId: "member", revokedAt: null },
      data: { revokedAt: expect.any(Date) }
    });
  });

  it("does not take a character already linked to another member", async () => {
    const tx = {
      character: {
        findMany: vi.fn(async () => [{ id: "character", name: "Ray", realm: "Forever", memberId: "other-member" }]),
        count: vi.fn(),
        create: vi.fn(),
        update: vi.fn()
      },
      professionSkill: { upsert: vi.fn() },
      unclaimedCharacter: { deleteMany: vi.fn() }
    };
    const database = { $transaction: async (callback: (client: typeof tx) => unknown) => callback(tx) };
    const result = await linkPairedCharacter(database as never, "guild", "member", {
      name: "Ray", realm: "Forever", class: "PRIEST", race: "", level: 60, spec: "",
      professions: []
    });

    expect(result).toBe("owned-by-another");
    expect(tx.character.update).not.toHaveBeenCalled();
    expect(tx.character.create).not.toHaveBeenCalled();
  });
});
