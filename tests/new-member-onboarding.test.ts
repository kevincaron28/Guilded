import { describe, expect, it, vi } from "vitest";
vi.mock("../src/config.js", () => ({ config: { DISCORD_CLIENT_ID: "1552633893587394590", HOSTED_PILOT: false } }));

import { characterLinkPrompt } from "../src/services/character-link-prompt.js";
import { importCharacter, parseCharacterString } from "../src/services/character-import.js";
import { exchangeCharacterPairingCode, linkPairedCharacter } from "../src/services/character-pairing.js";

// In-memory persistence boundary; the linking, import, pairing and prompt services are real.
function newMember() {
  const rows: { id: string; name: string; realm: string; memberId: string; isMain: boolean; professionsUpdatedAt?: Date }[] = [];
  let pairing: { id: string; memberId: string; codeHash: string; expiresAt: Date; consumedAt: Date | null } | null = null;
  const credentials: { memberId: string; tokenHash: string; revokedAt: Date | null }[] = [];
  const db = {
    member: { findUnique: vi.fn(async () => ({ guildId: "guild" })) },
    character: {
      findMany: vi.fn(async ({ where }) => rows.filter(row => !where.name || row.name.toLowerCase() === where.name.equals.toLowerCase())),
      count: vi.fn(async ({ where }) => rows.filter(row => row.memberId === where.memberId && (!where.isMain || row.isMain)).length),
      create: vi.fn(async ({ data }) => { const row = { id: `character-${rows.length}`, ...data }; rows.push(row); return row; }),
      findUnique: vi.fn(async ({ where }) => rows.find(row => row.id === where.id)),
      update: vi.fn(async ({ where, data }) => { const row = rows.find(row => row.id === where.id)!; Object.assign(row, data); return row; }),
      updateMany: vi.fn(async ({ data }) => { rows.forEach(row => Object.assign(row, data)); return { count: rows.length }; })
    },
    characterPairing: {
      upsert: vi.fn(async ({ create }) => { pairing = { id: "pair", ...create, consumedAt: null }; return pairing; }),
      findFirst: vi.fn(async ({ where }) => pairing && pairing.codeHash === where.codeHash && !pairing.consumedAt && pairing.expiresAt > where.expiresAt.gt
        ? { ...pairing, member: { discordUserId: "user" } } : null),
      updateMany: vi.fn(async ({ data }) => { if (!pairing || pairing.consumedAt) return { count: 0 }; Object.assign(pairing, data); return { count: 1 }; })
    },
    companionCredential: {
      updateMany: vi.fn(async ({ data }) => { credentials.forEach(row => Object.assign(row, data)); return { count: credentials.length }; }),
      create: vi.fn(async ({ data }) => { const credential = { ...data, revokedAt: null }; credentials.push(credential); return credential; })
    },
    professionSkill: { deleteMany: vi.fn(), upsert: vi.fn() },
    recipeKnown: { deleteMany: vi.fn() }, professionCooldown: { deleteMany: vi.fn() },
    unclaimedCharacter: { deleteMany: vi.fn() }, $executeRaw: vi.fn()
  };
  const database = { ...db, $transaction: async (callback: (tx: typeof db) => unknown) => callback(db) };
  return { db, database: database as never, rows, credentials };
}
const self = (name: string) => ({ name, realm: "Forever", class: "MAGE" as const, race: "", level: 60, spec: "", professions: [] });
const line = (name: string) => parseCharacterString(`QG2;${name};Forever;MAGE;;60;;`);

describe("a new member's main and alt journey", () => {
  it("links the main then an alt with only the addon, preserving the main on repeated imports", async () => {
    const member = newMember();
    const initial = await characterLinkPrompt(member.database, "guild", "member", "server", "fr");
    expect(initial.embeds[0]!.data.description).toContain("Aucun personnage WoW");
    expect(initial.embeds[0]!.data.description).toContain("addon seul (par défaut)");
    expect(member.db.characterPairing.upsert).not.toHaveBeenCalled();
    expect(await importCharacter(member.database, "member", line("NewMain"))).toMatchObject({ isMain: true, action: "created" });
    expect(await importCharacter(member.database, "member", line("NewAlt"))).toMatchObject({ isMain: false, action: "created" });
    expect(await importCharacter(member.database, "member", line("NewAlt"))).toMatchObject({ isMain: false, action: "updated" });
    expect(member.rows.map(row => [row.name, row.isMain])).toEqual([["NewMain", true], ["NewAlt", false]]);
    expect(member.credentials).toHaveLength(0);
  });

  it("can add the optional companion later and sync an alt without changing the manually linked main", async () => {
    const member = newMember();
    await importCharacter(member.database, "member", line("NewMain"));
    await characterLinkPrompt(member.database, "guild", "member", "server", "en");
    expect(member.db.characterPairing.upsert).not.toHaveBeenCalled();
    const reply = await characterLinkPrompt(member.database, "guild", "member", "server", "en", "companion");
    const code = reply.embeds[0]!.data.fields![1]!.value.match(/\*\*([A-F0-9]{12})\*\*/)![1]!;
    const connection = await exchangeCharacterPairingCode(member.database, "server", code);
    expect(connection.discordUserId).toBe("user");
    expect(await linkPairedCharacter(member.database, "guild", "member", self("NewMain"))).toBe("already-linked");
    expect(await linkPairedCharacter(member.database, "guild", "member", self("NewAlt"))).toBe("linked");
    expect(await linkPairedCharacter(member.database, "guild", "member", self("NewAlt"))).toBe("already-linked");
    expect(member.rows.map(row => [row.name, row.isMain])).toEqual([["NewMain", true], ["NewAlt", false]]);
    expect(member.credentials).toHaveLength(1);
    expect(member.db.characterPairing.upsert).toHaveBeenCalledOnce();
  });

  it("links the first companion upload as main and the next character as alt with one connection", async () => {
    const member = newMember();
    const reply = await characterLinkPrompt(member.database, "guild", "member", "server", "en", "companion");
    const code = reply.embeds[0]!.data.fields![1]!.value.match(/\*\*([A-F0-9]{12})\*\*/)![1]!;
    await exchangeCharacterPairingCode(member.database, "server", code);
    await linkPairedCharacter(member.database, "guild", "member", self("NewMain"));
    await linkPairedCharacter(member.database, "guild", "member", self("NewAlt"));
    expect(member.rows.map(row => [row.name, row.isMain])).toEqual([["NewMain", true], ["NewAlt", false]]);
    expect(member.db.characterPairing.upsert).toHaveBeenCalledOnce();
  });
});
