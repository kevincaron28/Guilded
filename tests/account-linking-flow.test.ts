import { once } from "node:events";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// In-memory stand-in for Prisma. Discord, Battle.net and the Windows app are not contacted:
// the companion talks to the test server over loopback, and the addon path is the real snapshot parser.
const world = vi.hoisted(() => {
  type Row = Record<string, unknown> & { id: string };
  type Data = Record<string, unknown>;
  const guilds: Row[] = [];
  const members: Row[] = [];
  const pairings: Row[] = [];
  const credentials: Row[] = [];
  const characters: Row[] = [];
  const professions: Row[] = [];
  const claims: Row[] = [];
  const verifyCodes: Row[] = [];
  const unclaimed: Row[] = [];
  const webPairings: Row[] = [];
  const webCredentials: Row[] = [];
  const accounts: Row[] = [];
  const battleNet: Row[] = [];
  let seq = 0;
  const next = (prefix: string) => `${prefix}${++seq}`;

  function memberOf(memberId: unknown) {
    return members.find((member) => member["id"] === memberId);
  }
  function memberWhereMatches(member: Row | undefined, where: { discordUserId?: string; guildId?: string; status?: { not?: string } } | undefined) {
    if (!where) return true;
    if (!member) return false;
    if (where.discordUserId && member["discordUserId"] !== where.discordUserId) return false;
    if (where.guildId && member["guildId"] !== where.guildId) return false;
    if (where.status?.not && member["status"] === where.status.not) return false;
    return true;
  }
  function nameEquals(value: unknown, expected: string) {
    return typeof value === "string" && value.toLowerCase() === expected.toLowerCase();
  }
  function matchingCharacters(where: Record<string, unknown>) {
    return characters.filter((row) => {
      if (typeof where["memberId"] === "string" && row["memberId"] !== where["memberId"]) return false;
      if (where["isMain"] === true && row["isMain"] !== true) return false;
      if (typeof where["name"] === "string" && row["name"] !== where["name"]) return false;
      if (where["name"] && typeof where["name"] === "object") {
        const equals = (where["name"] as { equals?: string }).equals;
        if (equals !== undefined && !nameEquals(row["name"], equals)) return false;
      }
      if (typeof where["realm"] === "string" && row["realm"] !== where["realm"]) return false;
      if (where["realm"] && typeof where["realm"] === "object") {
        const equals = (where["realm"] as { equals?: string }).equals;
        if (equals !== undefined && !nameEquals(row["realm"], equals)) return false;
      }
      if (typeof where["gameEdition"] === "string" && (row["gameEdition"] ?? "forever") !== where["gameEdition"]) return false;
      if (typeof where["id"] === "string" && row["id"] !== where["id"]) return false;
      if (where["member"] && typeof where["member"] === "object" && !memberWhereMatches(memberOf(row["memberId"]), where["member"] as { discordUserId?: string; guildId?: string; status?: { not?: string } })) return false;
      return true;
    });
  }
  function withMember(row: Row) {
    const member = memberOf(row["memberId"]);
    return { ...row, ...(member ? { member: { id: member["id"], discordUserId: member["discordUserId"], displayName: member["displayName"], guildId: member["guildId"], status: member["status"] } } : {}) };
  }
  function claimMatches(row: Row, where: Record<string, unknown>) {
    if (where["guildId"] && row["guildId"] !== where["guildId"]) return false;
    if (where["memberId"] && row["memberId"] !== where["memberId"]) return false;
    if (typeof where["nameKey"] === "string" && row["nameKey"] !== where["nameKey"]) return false;
    if (where["nameKey"] && typeof where["nameKey"] === "object" && !(where["nameKey"] as { in: string[] }).in.includes(String(row["nameKey"]))) return false;
    const wanted = where["status"] as string | { in: string[] } | undefined;
    if (wanted && !(typeof wanted === "object" ? wanted.in.includes(String(row["status"])) : row["status"] === wanted)) return false;
    return true;
  }

  const db = {
    guild: {
      async findUnique({ where }: { where: { id?: string; discordId_scopeKey?: { discordId: string } } }) {
        if (where.discordId_scopeKey) return guilds.find((guild) => guild["discordId"] === where.discordId_scopeKey?.discordId) ?? null;
        if (where.id) return guilds.find((guild) => guild["id"] === where.id) ?? null;
        return null;
      }
    },
    member: {
      async findUnique({ where }: { where: { id: string } }) {
        const member = members.find((row) => row["id"] === where.id);
        return member ? { discordUserId: member["discordUserId"] } : null;
      },
      async findUniqueOrThrow({ where }: { where: { id: string } }) {
        const member = members.find((row) => row["id"] === where.id);
        if (!member) throw new Error("Member not found.");
        const guild = guilds.find((row) => row["id"] === member["guildId"]);
        return { guildId: member["guildId"], guild: { gameEdition: guild?.["gameEdition"] ?? "forever" } };
      },
      async upsert({ where, create, update }: { where: { guildId_discordUserId: { guildId: string; discordUserId: string } }; create: Data; update: Data }) {
        const key = where.guildId_discordUserId;
        const existing = members.find((row) => row["guildId"] === key.guildId && row["discordUserId"] === key.discordUserId);
        if (existing) return Object.assign(existing, update);
        const row = { id: next("m"), status: "ACTIVE", ...create };
        members.push(row);
        return row;
      }
    },
    character: {
      async findMany({ where = {} }: { where?: Record<string, unknown> } = {}) {
        return matchingCharacters(where).map(withMember);
      },
      async findFirst({ where, orderBy }: { where: Record<string, unknown>; orderBy?: { lastSeenAt?: string } }) {
        const rows = matchingCharacters(where);
        if (orderBy?.lastSeenAt === "desc") rows.sort((a, b) => Number(b["lastSeenAt"] ? new Date(b["lastSeenAt"] as string | Date).getTime() : 0) - Number(a["lastSeenAt"] ? new Date(a["lastSeenAt"] as string | Date).getTime() : 0));
        const row = rows[0];
        return row ? withMember(row) : null;
      },
      async count({ where }: { where: Record<string, unknown> }) {
        return matchingCharacters(where).length;
      },
      async create({ data }: { data: Data }) {
        const row = { id: next("c"), ...data };
        characters.push(row);
        return row;
      },
      async update({ where, data }: { where: { id: string }; data: Data }) {
        const row = characters.find((item) => item["id"] === where.id);
        if (!row) throw new Error("Character not found.");
        return Object.assign(row, data);
      },
      async updateMany({ where, data }: { where: { memberId?: string }; data: Data }) {
        const rows = characters.filter((row) => !where.memberId || row["memberId"] === where.memberId);
        rows.forEach((row) => Object.assign(row, data));
        return { count: rows.length };
      },
      async delete({ where }: { where: { id: string } }) {
        const index = characters.findIndex((row) => row["id"] === where.id);
        if (index >= 0) characters.splice(index, 1);
      }
    },
    professionSkill: {
      async upsert({ where, create, update }: { where: { characterId_profession: { characterId: string; profession: string } }; create: Data; update: Data }) {
        const key = where.characterId_profession;
        const existing = professions.find((row) => row["characterId"] === key.characterId && row["profession"] === key.profession);
        if (existing) return Object.assign(existing, update);
        const row = { id: next("prof"), ...create };
        professions.push(row);
        return row;
      }
    },
    // Two members and one character (character-move.ts): recorded, never silent.
    characterLinkConflict: { findUnique: async () => null, upsert: async () => ({}) },
    unclaimedCharacter: {
      async findMany({ where }: { where: { guildId: string } }) {
        return unclaimed.filter((row) => row["guildId"] === where.guildId);
      },
      async findFirst({ where }: { where: { guildId: string; OR?: { id?: string; nameKey?: string }[] } }) {
        return unclaimed.find((row) => row["guildId"] === where.guildId && (where.OR ?? [{ id: row["id"] as string }]).some((item) => (item.id !== undefined && row["id"] === item.id) || (item.nameKey !== undefined && row["nameKey"] === item.nameKey))) ?? null;
      },
      async delete({ where }: { where: { id: string } }) {
        const index = unclaimed.findIndex((row) => row["id"] === where.id);
        if (index >= 0) unclaimed.splice(index, 1);
      },
      async deleteMany({ where }: { where: { guildId?: string; nameKey?: string } }) {
        const before = unclaimed.length;
        for (let index = unclaimed.length - 1; index >= 0; index--) {
          const row = unclaimed[index]!;
          if (where.guildId && row["guildId"] !== where.guildId) continue;
          if (where.nameKey && row["nameKey"] !== where.nameKey) continue;
          unclaimed.splice(index, 1);
        }
        return { count: before - unclaimed.length };
      }
    },
    characterPairing: {
      async upsert({ where, create, update }: { where: { guildId_memberId: { guildId: string; memberId: string } }; create: Data; update: Data }) {
        const key = where.guildId_memberId;
        const existing = pairings.find((row) => row["guildId"] === key.guildId && row["memberId"] === key.memberId);
        if (existing) return Object.assign(existing, update);
        const row = { id: next("pair"), consumedAt: null, ...create };
        pairings.push(row);
        return row;
      },
      async findMany({ where, take }: { where: { codeHash: string; expiresAt: { gt: Date }; consumedAt: null }; take?: number }) {
        const rows = pairings.filter((row) => row["codeHash"] === where.codeHash && row["consumedAt"] === null && (row["expiresAt"] as Date) > where.expiresAt.gt);
        return rows.slice(0, take ?? rows.length).map((row) => ({ ...row, guild: { discordId: guilds.find((guild) => guild["id"] === row["guildId"])?.["discordId"] } }));
      },
      async findFirst({ where }: { where: { codeHash: string; guild: { discordId: string }; expiresAt: { gt: Date }; consumedAt: null } }) {
        const guild = guilds.find((row) => row["discordId"] === where.guild.discordId);
        const pairing = pairings.find((row) => row["codeHash"] === where.codeHash && row["guildId"] === guild?.["id"] && row["consumedAt"] === null && (row["expiresAt"] as Date) > where.expiresAt.gt);
        if (!pairing || !guild) return null;
        const member = memberOf(pairing["memberId"]);
        return { id: pairing["id"], memberId: pairing["memberId"], guild: { id: guild["id"], name: guild["name"], gameEdition: guild["gameEdition"] }, member: { discordUserId: member?.["discordUserId"] } };
      },
      async updateMany({ where, data }: { where: { id: string; consumedAt: null; expiresAt: { gt: Date } }; data: { consumedAt: Date } }) {
        const row = pairings.find((item) => item["id"] === where.id && item["consumedAt"] === null && (item["expiresAt"] as Date) > where.expiresAt.gt);
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }
    },
    companionCredential: {
      async create({ data }: { data: Data }) {
        const row = { id: next("cred"), revokedAt: null, deviceName: "Paired companion", ...data };
        credentials.push(row);
        return row;
      },
      async updateMany({ where, data }: { where: { memberId: string; revokedAt: null }; data: { revokedAt: Date } }) {
        const rows = credentials.filter((row) => row["memberId"] === where.memberId && row["revokedAt"] === null);
        rows.forEach((row) => Object.assign(row, data));
        return { count: rows.length };
      },
      async count({ where }: { where: { revokedAt: null; member: { discordUserId?: string; guildId?: string; status?: { not?: string } } } }) {
        return credentials.filter((row) => row["revokedAt"] === null && memberWhereMatches(memberOf(row["memberId"]), where.member)).length;
      },
      // link-status.ts: the newest device sync of this member's credentials.
      async findFirst({ where }: { where: { revokedAt: null; member: { discordUserId?: string; guildId?: string; status?: { not?: string } } } }) {
        const rows = credentials.filter((row) => row["revokedAt"] === null && row["lastUsedAt"] instanceof Date && memberWhereMatches(memberOf(row["memberId"]), where.member));
        rows.sort((a, b) => (b["lastUsedAt"] as Date).getTime() - (a["lastUsedAt"] as Date).getTime());
        return rows[0] ? { lastUsedAt: rows[0]["lastUsedAt"] } : null;
      }
    },
    characterVerifyCode: {
      async upsert({ where, create }: { where: { guildId_memberId: { guildId: string; memberId: string } }; create: Data }) {
        const key = where.guildId_memberId;
        const existing = verifyCodes.find((row) => row["guildId"] === key.guildId && row["memberId"] === key.memberId);
        if (existing) return existing;
        const row = { id: next("code"), ...create };
        verifyCodes.push(row);
        return row;
      },
      async findMany({ where }: { where: { guildId: string; code: { in: string[] } } }) {
        return verifyCodes.filter((row) => row["guildId"] === where.guildId && where.code.in.includes(String(row["code"]))).map((row) => ({ ...row, member: { discordUserId: memberOf(row["memberId"])?.["discordUserId"] } }));
      }
    },
    characterVerifyClaim: {
      async findFirst({ where }: { where: Record<string, unknown> }) {
        return claims.find((row) => claimMatches(row, where)) ?? null;
      },
      async findMany({ where }: { where: Record<string, unknown> }) {
        return claims.filter((row) => claimMatches(row, where));
      },
      async upsert({ where, create, update }: { where: { guildId_memberId_nameKey: { guildId: string; memberId: string; nameKey: string } }; create: Data; update: Data }) {
        const key = where.guildId_memberId_nameKey;
        const existing = claims.find((row) => row["guildId"] === key.guildId && row["memberId"] === key.memberId && row["nameKey"] === key.nameKey);
        if (existing) return Object.assign(existing, update);
        const row = { id: next("claim"), ...create };
        claims.push(row);
        return row;
      }
    },
    webPairing: {
      async upsert({ where, create, update }: { where: { accountId: string }; create: Data; update: Data }) {
        const existing = webPairings.find((row) => row["accountId"] === where.accountId);
        if (existing) return Object.assign(existing, update);
        const row = { id: next("webpair"), consumedAt: null, ...create };
        webPairings.push(row);
        return row;
      },
      async findUnique({ where }: { where: { codeHash: string } }) {
        const row = webPairings.find((item) => item["codeHash"] === where.codeHash);
        return row ? { id: row["id"], accountId: row["accountId"] } : null;
      },
      async updateMany({ where, data }: { where: { id: string; consumedAt: null; expiresAt: { gt: Date } }; data: { consumedAt: Date } }) {
        const row = webPairings.find((item) => item["id"] === where.id && item["consumedAt"] === null && (item["expiresAt"] as Date) > where.expiresAt.gt);
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }
    },
    webCompanionCredential: {
      async create({ data }: { data: Data }) {
        const row = { id: next("webcred"), revokedAt: null, ...data };
        webCredentials.push(row);
        return row;
      },
      async findFirst({ where }: { where: { tokenHash?: string; revokedAt: null; account?: { discordUserId: string } } }) {
        if (where.account) {
          const rows = webCredentials.filter((row) => row["revokedAt"] === null && row["lastUsedAt"] instanceof Date && accounts.some((account) => account["id"] === row["accountId"] && account["discordUserId"] === where.account!.discordUserId));
          rows.sort((a, b) => (b["lastUsedAt"] as Date).getTime() - (a["lastUsedAt"] as Date).getTime());
          return rows[0] ? { lastUsedAt: rows[0]["lastUsedAt"] } : null;
        }
        const row = webCredentials.find((item) => item["tokenHash"] === where.tokenHash && item["revokedAt"] === null);
        if (!row) return null;
        const account = accounts.find((item) => item["id"] === row["accountId"]);
        return { accountId: row["accountId"], account: { username: account?.["username"] ?? "" } };
      },
      async updateMany({ where, data }: { where: { accountId: string; revokedAt: null }; data: { revokedAt: Date } }) {
        const rows = webCredentials.filter((row) => row["accountId"] === where.accountId && row["revokedAt"] === null);
        rows.forEach((row) => Object.assign(row, data));
        return { count: rows.length };
      },
      async count({ where }: { where: { revokedAt: null; account: { discordUserId: string } } }) {
        return webCredentials.filter((row) => row["revokedAt"] === null && accounts.some((account) => account["id"] === row["accountId"] && account["discordUserId"] === where.account.discordUserId)).length;
      }
    },
    battleNetIdentity: {
      async count({ where }: { where: { account: { discordUserId: string } } }) {
        return battleNet.filter((row) => row["discordUserId"] === where.account.discordUserId).length;
      }
    },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(db)
  };

  function reset() {
    for (const list of [guilds, members, pairings, credentials, characters, professions, claims, verifyCodes, unclaimed, webPairings, webCredentials, accounts, battleNet]) list.length = 0;
    seq = 0;
    guilds.push(
      { id: "g1", discordId: "111111111111111111", name: "Alpha", gameEdition: "forever" },
      { id: "g2", discordId: "222222222222222222", name: "Beta", gameEdition: "retail" }
    );
    members.push(
      { id: "m1", guildId: "g1", discordUserId: "user-ray", displayName: "Ray", status: "ACTIVE" },
      { id: "m2", guildId: "g1", discordUserId: "user-kev", displayName: "Kev", status: "ACTIVE" },
      { id: "m3", guildId: "g2", discordUserId: "user-zed", displayName: "Zed", status: "ACTIVE" }
    );
    accounts.push({ id: "acc1", discordUserId: "user-ray", username: "ray" });
  }

  return { db, reset, guilds, members, pairings, credentials, characters, professions, claims, verifyCodes, unclaimed, webPairings, webCredentials, accounts, battleNet };
});

vi.mock("../src/database.js", () => ({ prisma: world.db }));

import { pairAccount } from "../companion/engine.mjs";
import { parseAddonSnapshot } from "../src/integrations/addon.js";
import { resetFailures, startCompanionApi } from "../src/companion-api.js";
import { autoLinkUnclaimed, claimCharacter } from "../src/services/character-autolink.js";
import {
  cleanDeviceName, exchangeCharacterPairingCode, hashCompanionSecret, issueCharacterPairingCode, issueMemberCredential,
  linkPairedCharacter, revokeCompanionCredentials
} from "../src/services/character-pairing.js";
import { blockVerifiedCharacter, formatVerifyCode, linkVerifiedCharacters, verifyCodeFor } from "../src/services/character-verify.js";
import { memberLinkStatus } from "../src/services/link-status.js";
import { exchangePersonalCode, issuePersonalCode, personalAccess, prismaPersonalStore } from "../src/services/personal-pairing.js";

const DISCORD = "111111111111111111";
const OTHER = "222222222222222222";
const db = world.db as never;

const self = (over: Record<string, unknown> = {}) => ({
  name: "Ray", realm: "Forever", class: "PRIEST", race: "Human", level: 60, spec: "Holy", professions: [] as { name: string; skillLevel: number }[], ...over
});

describe("account linking across Discord, the addon, the companion and the site", () => {
  let server: Server;
  let address: string;

  beforeAll(async () => {
    server = startCompanionApi({ isReady: () => true, guilds: { fetch: vi.fn() } } as never);
    await once(server, "listening");
    const bound = server.address();
    if (!bound || typeof bound === "string") throw new Error("Test server did not bind a port.");
    address = `http://127.0.0.1:${bound.port}`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  beforeEach(() => {
    world.reset();
    resetFailures();
  });

  async function postPair(body: unknown) {
    const response = await fetch(`${address}/api/v1/addon-pairings`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
    });
    return { status: response.status, json: await response.json() as { error?: string; companionCredential?: string; guildDiscordId?: string; personal?: boolean; discordUserId?: string; wowGuildName?: string } };
  }

  it("links one character from a Discord verify code, an addon digest and a companion upload, and will not give it to someone else", async () => {
    const code = await verifyCodeFor(db, "g1", "m1");
    const digest = parseAddonSnapshot({
      source: "Guilded", exportedAt: "2026-11-03T16:00:00Z",
      characters: [{ name: "Ray", realm: "Forever", class: "MAGE", level: 60, verify: formatVerifyCode(code) }]
    }).characters;
    const linked = await linkVerifiedCharacters(db, "g1", { officer: true }, digest);
    expect(linked).toEqual([expect.objectContaining({ discordUserId: "user-ray", name: "Ray", status: "linked", isMain: true })]);
    expect(world.characters).toHaveLength(1);
    expect(world.characters[0]).toMatchObject({ memberId: "m1", className: "Mage", isMain: true });
    expect(world.characters[0]?.["guildRankIndex"]).toBeUndefined();
    expect(world.verifyCodes.map((row) => row["code"])).toEqual([code]);
    expect(JSON.stringify(world.verifyCodes)).not.toContain(formatVerifyCode(code));

    const refreshed = await linkPairedCharacter(db, "g1", "m1", self({ guildRankName: "Officer", guildRankIndex: 1, professions: [{ name: "Tailoring", skillLevel: 300 }] }));
    expect(refreshed).toBe("already-linked");
    expect(world.characters).toHaveLength(1);
    expect(world.characters[0]).toMatchObject({ className: "Priest", isMain: true, guildRankName: "Officer", guildRankIndex: 1 });
    expect(world.professions).toEqual([]);

    await expect(linkPairedCharacter(db, "g1", "m2", self())).resolves.toBe("owned-by-another");
    expect(world.characters).toHaveLength(1);
    expect(world.characters[0]?.["memberId"]).toBe("m1");

    const again = await linkVerifiedCharacters(db, "g1", { officer: true }, digest);
    expect(again).toEqual([]);
    expect(world.characters).toHaveLength(1);
  });

  it("keeps a guild rank on later uploads and clears nothing when an older companion omits it", async () => {
    await expect(linkPairedCharacter(db, "g1", "m1", self({ class: "" }))).resolves.toBe("missing-class");
    expect(world.characters).toHaveLength(0);

    await expect(linkPairedCharacter(db, "g1", "m1", self({ guildRankName: "Guild Master", guildRankIndex: 0 }))).resolves.toBe("linked");
    expect(world.characters[0]).toMatchObject({ isMain: true, guildRankName: "Guild Master", guildRankIndex: 0 });
    await expect(linkPairedCharacter(db, "g1", "m1", self({ level: 59 }))).resolves.toBe("already-linked");
    expect(world.characters[0]).toMatchObject({ level: 59, guildRankIndex: 0, guildRankName: "Guild Master" });
    await expect(linkPairedCharacter(db, "g1", "m1", self({ guildRankName: "Raider", guildRankIndex: 4 }))).resolves.toBe("already-linked");
    expect(world.characters[0]).toMatchObject({ guildRankName: "Raider", guildRankIndex: 4 });
  });

  it("issues a one-time companion code, exchanges it from the app, and rejects a second use", async () => {
    const issued = await issueCharacterPairingCode(db, "g1", "m1");
    expect(world.pairings[0]?.["codeHash"]).toBe(hashCompanionSecret(issued.code));
    expect(JSON.stringify(world.pairings)).not.toContain(issued.code);

    const paired = await pairAccount({ uploadUrl: address, pairingCode: ` ${issued.code.toLowerCase()} `, guildDiscordId: "" });
    expect(paired).toMatchObject({ ok: true, personal: false, guildDiscordId: DISCORD, wowGuildName: "Alpha" });
    const secret = pairedCredential(paired);
    expect(secret).toHaveLength(43);
    expect(world.credentials).toHaveLength(1);
    expect(world.credentials[0]?.["tokenHash"]).toBe(hashCompanionSecret(secret));
    expect(JSON.stringify(world.credentials)).not.toContain(secret);
    expect(world.pairings[0]?.["consumedAt"]).toBeInstanceOf(Date);

    const again = await postPair({ code: issued.code });
    expect(again.status).toBe(401);
    expect(again.json.error).toMatch(/invalid, expired, or already used/);
    expect(world.credentials).toHaveLength(1);
  });

  it("expires a code at fifteen minutes and lets a new code connect another device without revoking the first", async () => {
    const issuedAt = new Date("2026-11-03T12:00:00Z");
    const first = await issueCharacterPairingCode(db, "g1", "m1", issuedAt);
    const boundary = new Date(issuedAt.getTime() + 15 * 60_000);
    await expect(exchangeCharacterPairingCode(db, DISCORD, first.code, boundary)).rejects.toThrow(/invalid, expired, or already used/);
    expect(world.credentials).toHaveLength(0);
    const live = await exchangeCharacterPairingCode(db, DISCORD, first.code, new Date(boundary.getTime() - 1));
    expect(live.discordUserId).toBe("user-ray");

    const replacement = await issueCharacterPairingCode(db, "g1", "m1", issuedAt);
    expect(replacement.code).not.toBe(first.code);
    expect(world.pairings).toHaveLength(1);
    expect(world.pairings[0]?.["consumedAt"]).toBeNull();
    await expect(exchangeCharacterPairingCode(db, DISCORD, first.code, issuedAt)).rejects.toThrow(/invalid, expired, or already used/);
    const second = await exchangeCharacterPairingCode(db, DISCORD, replacement.code, issuedAt);
    expect(second.companionCredential).not.toBe(live.companionCredential);
    expect(world.credentials.map((row) => row["revokedAt"])).toEqual([null, null]);

    const raced = await issueCharacterPairingCode(db, "g1", "m2", issuedAt);
    const both = await Promise.allSettled([
      exchangeCharacterPairingCode(db, DISCORD, raced.code, issuedAt),
      exchangeCharacterPairingCode(db, DISCORD, raced.code, issuedAt)
    ]);
    expect(both.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(world.credentials.filter((row) => row["memberId"] === "m2")).toHaveLength(1);
  });

  it("refuses an ambiguous code, a code presented to the wrong server, and an unknown server", async () => {
    const code = "ABCDEF012345";
    const expiresAt = new Date(Date.now() + 60_000);
    world.pairings.push(
      { id: "pair-a", guildId: "g1", memberId: "m1", codeHash: hashCompanionSecret(code), expiresAt, consumedAt: null },
      { id: "pair-b", guildId: "g2", memberId: "m3", codeHash: hashCompanionSecret(code), expiresAt, consumedAt: null }
    );
    const ambiguous = await postPair({ code });
    expect(ambiguous.status).toBe(409);
    expect(ambiguous.json.error).toMatch(/more than one server/);
    expect(world.credentials).toHaveLength(0);

    world.pairings.splice(0, world.pairings.length);
    const issued = await issueCharacterPairingCode(db, "g1", "m1");
    const wrong = await postPair({ code: issued.code, guildDiscordId: OTHER });
    expect(wrong.status).toBe(401);
    const unknown = await postPair({ code: issued.code, guildDiscordId: "999999999999999999" });
    expect(unknown.status).toBe(404);
    expect(unknown.json.error).toMatch(/not initialized/);
    const right = await postPair({ code: issued.code, guildDiscordId: DISCORD });
    expect(right.status).toBe(200);
    expect(right.json.discordUserId).toBe("user-ray");
  });

  it("rejects a malformed pairing body and locks the address out after repeated failures", async () => {
    expect((await postPair({})).status).toBe(400);
    expect((await postPair({ code: 12 })).status).toBe(400);
    for (let attempt = 0; attempt < 10; attempt++) expect((await postPair({ code: "NOPE" })).status).toBe(401);
    const issued = await issueCharacterPairingCode(db, "g1", "m1");
    const locked = await postPair({ code: issued.code });
    expect(locked.status).toBe(429);
    expect(world.pairings[0]?.["consumedAt"]).toBeNull();
  });

  it("stops a verify code from relinking after unlink, and stops the companion too (the member's own unlink and an officer's)", async () => {
    const code = await verifyCodeFor(db, "g1", "m1");
    const digest = () => parseAddonSnapshot({
      source: "Guilded", exportedAt: "2026-11-03T16:00:00Z",
      characters: [{ name: "Ray", realm: "Forever", class: "PRIEST", level: 60, verify: code }]
    }).characters;
    await linkVerifiedCharacters(db, "g1", { officer: true }, digest());
    world.characters.splice(0, world.characters.length);
    await blockVerifiedCharacter(db, "g1", "m1", "Ray", "Forever", "forever", false);
    expect(await linkVerifiedCharacters(db, "g1", { officer: true }, digest())).toEqual([]);
    await expect(linkPairedCharacter(db, "g1", "m1", self())).resolves.toBe("blocked-by-member");

    world.characters.splice(0, world.characters.length);
    await blockVerifiedCharacter(db, "g1", "m1", "Ray", "Forever", "forever", true);
    await expect(linkPairedCharacter(db, "g1", "m1", self())).resolves.toBe("removed-by-officer");
    expect(await linkVerifiedCharacters(db, "g1", { officer: true }, digest())).toEqual([]);
    expect(world.characters).toHaveLength(0);
    expect(world.claims.map((row) => row["status"])).toContain("REMOVED");
  });

  it("claims, relinks and refuses conflicts for unclaimed characters, including edition and realm", async () => {
    world.unclaimed.push({ id: "u-ray", guildId: "g1", name: "Ray", realm: "Forever", nameKey: "ray", className: "Priest", gameEdition: "forever", level: 60, professions: [{ name: "Tailoring", skillLevel: 300 }], lastSeenAt: new Date("2026-11-01T00:00:00Z") });
    const claimed = await claimCharacter(db, "g1", "m1", " ray ");
    expect(claimed.isMain).toBe(true);
    expect(world.unclaimed).toHaveLength(0);
    expect(world.characters[0]).toMatchObject({ memberId: "m1", name: "Ray", isMain: true, lastSeenAt: new Date("2026-11-01T00:00:00Z") });
    expect(world.professions[0]).toMatchObject({ profession: "Tailoring", skillLevel: 300 });
    await expect(claimCharacter(db, "g1", "m1", "Ray")).rejects.toThrow(/already linked to you/);

    world.unclaimed.push({ id: "u-ray-2", guildId: "g1", name: "Ray", realm: "Other", nameKey: "ray", className: "Mage", gameEdition: "forever", professions: [] });
    await expect(claimCharacter(db, "g1", "m2", "u-ray-2")).rejects.toThrow(/already linked to someone/);
    expect(world.unclaimed.map((row) => row["id"])).toEqual(["u-ray-2"]);

    world.unclaimed.push({ id: "u-retail", guildId: "g1", name: "Zed", realm: "Stormrage", nameKey: "zed", className: "Warrior", gameEdition: "retail", professions: [] });
    await expect(claimCharacter(db, "g1", "m1", "Zed")).rejects.toThrow(/different WoW edition/);
    expect(world.unclaimed.some((row) => row["id"] === "u-retail")).toBe(true);

    world.characters.push({ id: "c-zed", memberId: "m3", guildId: "g2", name: "Zed", realm: "Area 52", className: "Warrior", gameEdition: "retail", isMain: true });
    world.unclaimed.push({ id: "u-storm", guildId: "g2", name: "Zed", realm: "Stormrage", nameKey: "zed", className: "Warrior", gameEdition: "retail", professions: [] });
    const alt = await claimCharacter(db, "g2", "m3", "u-storm");
    expect(alt.isMain).toBe(false);
    expect(world.characters.filter((row) => row["name"] === "Zed")).toHaveLength(2);
    world.unclaimed.push({ id: "u-same", guildId: "g2", name: "Zed", realm: "Stormrage", nameKey: "zed", className: "Warrior", gameEdition: "retail", professions: [] });
    await expect(claimCharacter(db, "g2", "m3", "Zed")).rejects.toThrow(/already linked to someone/);
    await expect(claimCharacter(db, "g1", "m1", "Nobody")).rejects.toThrow(/No unclaimed character/);
  });

  it("auto-links a Forever character whose name is a Discord nickname, and skips conflicts, alts of other editions and a failed member list", async () => {
    const person = (id: string, displayName: string, username = displayName, bot = false) => ({ id, displayName, user: { bot, username, globalName: null as string | null } });
    const ray = person("d-ray", "[GOLD] Ray", "rayuser");
    const cache = new Map<string, ReturnType<typeof person>>([
      ["d-ray", ray],
      ["d-bot", person("d-bot", "Ray", "raybot", true)],
      ["d-bob1", person("d-bob1", "Bob")],
      ["d-bob2", person("d-bob2", "Bob | Tank")]
    ]);
    world.unclaimed.push(
      { id: "u-ray", guildId: "g1", name: "Ray", realm: "Forever", nameKey: "ray", className: "Priest", gameEdition: "forever", professions: [] },
      { id: "u-bob", guildId: "g1", name: "Bob", realm: "Forever", nameKey: "bob", className: "Warrior", gameEdition: "forever", professions: [] },
      { id: "u-retail", guildId: "g1", name: "Ray", realm: "Stormrage", nameKey: "ray-stormrage", className: "Priest", gameEdition: "retail", professions: [] }
    );
    const list = vi.fn(async () => new Map());
    const guild = { memberCount: cache.size + 5, members: { cache, list } };
    const linked = await autoLinkUnclaimed(guild as never, db, "g1");
    expect(list).toHaveBeenCalled();
    expect(linked).toEqual([{ character: "Ray", member: "[GOLD] Ray", memberId: "m1" }]);
    expect(world.characters.map((row) => row["name"])).toEqual(["Ray"]);
    expect(world.unclaimed.map((row) => row["id"]).sort()).toEqual(["u-bob", "u-retail"]);

    world.unclaimed.push({ id: "u-stale", guildId: "g1", name: "Ray", realm: "Forever", nameKey: "ray", className: "Mage", gameEdition: "forever", professions: [] });
    const full = { memberCount: cache.size, members: { cache, list: vi.fn() } };
    expect(await autoLinkUnclaimed(full as never, db, "g1")).toEqual([]);
    expect(world.unclaimed.some((row) => row["id"] === "u-stale")).toBe(false);
    expect(world.characters.filter((row) => row["name"] === "Ray")).toHaveLength(1);

    const failing = { memberCount: 50, members: { cache: new Map(), list: vi.fn(async () => { throw Object.assign(new Error("You are being rate limited."), { status: 429 }); }) } };
    world.unclaimed.push({ id: "u-amy", guildId: "g1", name: "Amy", realm: "Forever", nameKey: "amy", className: "Mage", gameEdition: "forever", professions: [] });
    await expect(autoLinkUnclaimed(failing as never, db, "g1")).rejects.toThrow(/rate limited/);
    expect(world.characters.some((row) => row["name"] === "Amy")).toBe(false);
  });

  it("pairs a website account with a personal code and reports the saved link status", async () => {
    const store = prismaPersonalStore(db);
    const issuedAt = new Date("2026-11-03T12:00:00Z");
    const expired = await issuePersonalCode(store, "acc1", new Date(issuedAt.getTime() - 16 * 60_000));
    expect(await exchangePersonalCode(store, expired.code, issuedAt)).toBeNull();
    // The HTTP exchange uses the server clock, so this code has to be issued now.
    const { code } = await issuePersonalCode(store, "acc1");
    expect(JSON.stringify(world.webPairings)).not.toContain(code);
    const paired = await pairAccount({ uploadUrl: address, pairingCode: code });
    expect(paired).toMatchObject({ ok: true, personal: true });
    const secret = pairedCredential(paired);
    expect(await personalAccess(store, secret)).toEqual({ accountId: "acc1", username: "ray" });
    expect((await postPair({ code })).status).toBe(401);
    expect(await personalAccess(store, secret)).toEqual({ accountId: "acc1", username: "ray" });

    const raced = await issuePersonalCode(store, "acc1", issuedAt);
    const both = await Promise.allSettled([
      exchangePersonalCode(store, raced.code, issuedAt),
      exchangePersonalCode(store, raced.code, issuedAt)
    ]);
    expect(both.filter((result) => result.status === "fulfilled" && result.value)).toHaveLength(1);

    expect(await memberLinkStatus(db, "user-ray")).toMatchObject({ battleNet: false, companion: true, characters: 0, lastSynced: null });
    // A device that synced counts as "Last synced", even before any character is linked (8.5 fresh-PC test).
    world.webCredentials[0]!["lastUsedAt"] = new Date("2026-11-01T12:00:00Z");
    expect(await memberLinkStatus(db, "user-ray")).toMatchObject({ companion: true, characters: 0, lastSynced: new Date("2026-11-01T12:00:00Z") });
    delete world.webCredentials[0]!["lastUsedAt"];
    world.battleNet.push({ id: "bn1", discordUserId: "user-ray" });
    world.members.push({ id: "m4", guildId: "g2", discordUserId: "user-ray", displayName: "Ray", status: "ACTIVE" });
    world.characters.push(
      { id: "c1", memberId: "m1", guildId: "g1", name: "Ray", realm: "Forever", isMain: true, lastSeenAt: new Date("2026-11-02T00:00:00Z") },
      { id: "c2", memberId: "m4", guildId: "g2", name: "Zed", realm: "Stormrage", isMain: true, lastSeenAt: new Date("2026-11-03T00:00:00Z") }
    );
    const issued = await issueCharacterPairingCode(db, "g1", "m1", issuedAt);
    await exchangeCharacterPairingCode(db, DISCORD, issued.code, issuedAt);
    const status = await memberLinkStatus(db, "user-ray");
    expect(status).toMatchObject({ battleNet: true, companion: true, characters: 2, lastSynced: new Date("2026-11-03T00:00:00Z") });
    expect(await memberLinkStatus(db, "user-ray", "g1")).toMatchObject({ characters: 1, lastSynced: new Date("2026-11-02T00:00:00Z") });

    await revokeCompanionCredentials(db, "m1");
    for (const row of world.webCredentials) row["revokedAt"] = new Date();
    expect(await memberLinkStatus(db, "user-ray", "g1")).toMatchObject({ companion: false, characters: 1 });
    const left = membersLeft();
    left["status"] = "LEFT";
    expect(await memberLinkStatus(db, "user-ray", "g1")).toMatchObject({ characters: 0, lastSynced: null, companion: false });
  });

  it("stores a cleaned device name and keeps the credential hash", async () => {
    expect(cleanDeviceName(" \n Ray's PC \u0000")).toBe("Ray's PC");
    expect(cleanDeviceName("   ")).toBe("Paired companion");
    expect(cleanDeviceName("a".repeat(90))).toHaveLength(80);
    const secret = await issueMemberCredential(db, "m1", " \n Ray's PC \u0007");
    expect(world.credentials[0]).toMatchObject({ memberId: "m1", deviceName: "Ray's PC", tokenHash: hashCompanionSecret(secret), revokedAt: null });
    expect(JSON.stringify(world.credentials)).not.toContain(secret);
  });
});

function pairedCredential(result: { ok: boolean; message: string }): string {
  const secret = (result as { companionCredential?: unknown }).companionCredential;
  if (!result.ok || typeof secret !== "string") throw new Error(result.message);
  return secret;
}

function membersLeft() {
  const member = world.members.find((row) => row["id"] === "m1");
  if (!member) throw new Error("seed member missing");
  return member;
}
