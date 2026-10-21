import { describe, expect, it, vi } from "vitest";
vi.mock("../src/config.js", () => ({ config: { DISCORD_CLIENT_ID: "1552633893587394590", HOSTED_PILOT: false } }));
const logged = vi.hoisted(() => vi.fn());
vi.mock("../src/services/housekeeping.js", () => ({ postToLogChannel: logged }));

import { parseAddonSnapshot } from "../src/integrations/addon.js";
import {
  blockVerifiedCharacter, formatVerifyCode, linkVerifiedCharacters, newVerifyCode, normalizeVerifyCode, tellVerified, verifyCodeFor
} from "../src/services/character-verify.js";

// In-memory persistence boundary; the verify and pairing services are real.
function newGuild() {
  const characters: { id: string; name: string; realm: string; memberId: string; isMain: boolean; member?: unknown }[] = [];
  const codes: { guildId: string; memberId: string; code: string }[] = [];
  const claims: { guildId: string; memberId: string; nameKey: string; status: string }[] = [];
  const users: Record<string, string> = { ray: "user-ray", kev: "user-kev" };
  const db = {
    character: {
      findMany: vi.fn(async () => characters.map((row) => ({ ...row, member: { discordUserId: users[row.memberId] } }))),
      findFirst: vi.fn(async ({ where }) => characters.find((row) => row.memberId === where.memberId && row.name === where.name) ?? null),
      count: vi.fn(async ({ where }) => characters.filter((row) => row.memberId === where.memberId && (!where.isMain || row.isMain)).length),
      create: vi.fn(async ({ data }) => { const row = { id: `character-${characters.length}`, ...data }; characters.push(row); return row; }),
      update: vi.fn(async ({ where, data }) => Object.assign(characters.find((row) => row.id === where.id)!, data))
    },
    characterVerifyCode: {
      upsert: vi.fn(async ({ where, create }) => {
        const found = codes.find((row) => row.guildId === where.guildId_memberId.guildId && row.memberId === where.guildId_memberId.memberId);
        if (found) return found;
        codes.push(create);
        return create;
      }),
      findMany: vi.fn(async ({ where }) => codes.filter((row) => row.guildId === where.guildId && where.code.in.includes(row.code))
        .map((row) => ({ ...row, member: { discordUserId: users[row.memberId] } })))
    },
    characterVerifyClaim: {
      findMany: vi.fn(async ({ where }) => claims.filter((row) => row.guildId === where.guildId && where.memberId.in.includes(row.memberId))),
      upsert: vi.fn(async ({ where, create, update }) => {
        const key = where.guildId_memberId_nameKey;
        const found = claims.find((row) => row.guildId === key.guildId && row.memberId === key.memberId && row.nameKey === key.nameKey);
        if (found) return Object.assign(found, update);
        claims.push(create);
        return create;
      })
    },
    professionSkill: { upsert: vi.fn() },
    unclaimedCharacter: { deleteMany: vi.fn() }
  };
  const database = { ...db, $transaction: async (callback: (tx: typeof db) => unknown) => callback(db) };
  return { db, database: database as never, characters, claims };
}

const officer = { officer: true };

// What an officer's companion uploads for a guildmate whose digest carried a code.
const peer = (name: string, verify?: string) => parseAddonSnapshot({
  source: "Guilded", exportedAt: "2026-10-21T20:00:00Z",
  characters: [{ name, realm: "Forever", class: "MAGE", level: 60, ...(verify ? { verify } : {}) }]
}).characters;

describe("verify codes", () => {
  it("are eight letters without I or O, shown as ABCD-EFGH and read back however they are pasted", () => {
    for (let index = 0; index < 50; index++) expect(newVerifyCode()).toMatch(/^[A-HJ-NP-Z]{8}$/);
    expect(formatVerifyCode("ABCDEFGH")).toBe("ABCD-EFGH");
    expect(normalizeVerifyCode(" abcd-efgh ")).toBe("ABCDEFGH");
    expect(normalizeVerifyCode("ABCD EFGH")).toBe("ABCDEFGH");
    // I and O are never issued, so a code with them is a typo.
    expect(normalizeVerifyCode("ABCD-EFGI")).toBeNull();
    expect(normalizeVerifyCode("ABC")).toBeNull();
    expect(normalizeVerifyCode(12345678)).toBeNull();
  });

  it("stay the same for a member, so the line pasted in game keeps working", async () => {
    const guild = newGuild();
    const first = await verifyCodeFor(guild.database, "guild", "ray");
    expect(await verifyCodeFor(guild.database, "guild", "ray")).toBe(first);
    expect(await verifyCodeFor(guild.database, "guild", "kev")).not.toBe(first);
  });

  it("reach the bot through the export schema, and an old upload without one still parses", () => {
    expect(peer("Ray", "ABCDEFGH")[0]!.verify).toBe("ABCDEFGH");
    expect(peer("Ray")[0]!.verify).toBeUndefined();
  });
});

describe("linking from an officer's upload", () => {
  it("links the first character as main and every later one as an alt, telling the member each time", async () => {
    const guild = newGuild();
    const code = await verifyCodeFor(guild.database, "guild", "ray");
    expect(await linkVerifiedCharacters(guild.database, "guild", officer, peer("Highpriest Cheech", code)))
      .toEqual([{ discordUserId: "user-ray", name: "Highpriest Cheech", status: "linked", isMain: true }]);
    // The next upload still carries the same digest: nothing more happens.
    expect(await linkVerifiedCharacters(guild.database, "guild", officer, peer("Highpriest Cheech", code))).toEqual([]);
    // An alt on the same WoW account repeats the code from the account's saved data.
    expect(await linkVerifiedCharacters(guild.database, "guild", officer, peer("Cheech Alt", code)))
      .toEqual([{ discordUserId: "user-ray", name: "Cheech Alt", status: "linked", isMain: false }]);
    expect(guild.characters.map((row) => [row.name, row.memberId, row.isMain])).toEqual([["Highpriest Cheech", "ray", true], ["Cheech Alt", "ray", false]]);
  });

  it("only trusts an officer's upload: a member's own companion could pair any name with their code", async () => {
    const guild = newGuild();
    const code = await verifyCodeFor(guild.database, "guild", "ray");
    expect(await linkVerifiedCharacters(guild.database, "guild", { officer: false }, peer("Guild Master", code))).toEqual([]);
    expect(guild.db.characterVerifyCode.findMany).not.toHaveBeenCalled();
    expect(guild.characters).toEqual([]);
  });

  it("ignores unknown codes, characters without a class and digests without a code", async () => {
    const guild = newGuild();
    await verifyCodeFor(guild.database, "guild", "ray");
    expect(await linkVerifiedCharacters(guild.database, "guild", officer, peer("Stranger", "ZZZZZZZZ"))).toEqual([]);
    expect(await linkVerifiedCharacters(guild.database, "guild", officer, peer("Plain"))).toEqual([]);
    const classless = parseAddonSnapshot({ source: "Guilded", exportedAt: "2026-10-21T20:00:00Z", characters: [{ name: "Blank", realm: "Forever", verify: "ABCDEFGH" }] }).characters;
    expect(await linkVerifiedCharacters(guild.database, "guild", officer, classless)).toEqual([]);
    expect(guild.characters).toEqual([]);
  });

  it("never takes a character linked to someone else, and says so only once", async () => {
    const guild = newGuild();
    guild.characters.push({ id: "taken", name: "Ray", realm: "Forever", memberId: "kev", isMain: true });
    const code = await verifyCodeFor(guild.database, "guild", "ray");
    expect(await linkVerifiedCharacters(guild.database, "guild", officer, peer("Ray", code)))
      .toEqual([{ discordUserId: "user-ray", name: "Ray", status: "taken", isMain: false }]);
    expect(await linkVerifiedCharacters(guild.database, "guild", officer, peer("Ray", code))).toEqual([]);
    expect(guild.characters.find((row) => row.name === "Ray")!.memberId).toBe("kev");
  });

  it("does not link a character again after it was unlinked", async () => {
    const guild = newGuild();
    const code = await verifyCodeFor(guild.database, "guild", "ray");
    await linkVerifiedCharacters(guild.database, "guild", officer, peer("Ray", code));
    guild.characters.length = 0; // /character unlink
    await blockVerifiedCharacter(guild.database, "guild", "ray", "Ray");
    expect(await linkVerifiedCharacters(guild.database, "guild", officer, peer("Ray", code))).toEqual([]);
    expect(guild.characters).toEqual([]);
    expect(guild.claims).toEqual([{ guildId: "guild", memberId: "ray", nameKey: "ray", status: "BLOCKED" }]);
  });
});

describe("telling the member", () => {
  it("DMs without pings and logs new links for officers", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const discordGuild = { id: "server", name: "Quebec Gold" };
    const client = { guilds: { fetch: vi.fn().mockResolvedValue(discordGuild) }, users: { send } };
    await tellVerified(client as never, "server", "fr", [
      { discordUserId: "user-ray", name: "Ray", status: "linked", isMain: true },
      { discordUserId: "user-kev", name: "Kev", status: "taken", isMain: false }
    ]);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]).toEqual(["user-ray", { content: expect.stringContaining("**Ray** est maintenant lié") as unknown, allowedMentions: { parse: [] } }]);
    expect(send.mock.calls[0]![1].content).toContain("comme ton principal");
    expect(send.mock.calls[1]![1].content).toContain("déjà lié à quelqu'un d'autre sur **Quebec Gold**");
    // Only the new link reaches the officers' log (postToLogChannel never pings).
    expect(logged).toHaveBeenCalledWith(discordGuild, "🔗 Ray was linked to <@user-ray> by their /guilded verify code.");
  });

  it("never throws when Discord is unreachable", async () => {
    const client = { guilds: { fetch: vi.fn().mockRejectedValue(new Error("down")) }, users: { send: vi.fn().mockRejectedValue(new Error("closed DMs")) } };
    await expect(tellVerified(client as never, "server", "en", [{ discordUserId: "u", name: "Ray", status: "linked", isMain: false }])).resolves.toBeUndefined();
  });
});
