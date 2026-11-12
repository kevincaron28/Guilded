import { describe, expect, it, vi } from "vitest";
vi.mock("../src/config.js", () => ({ config: { DISCORD_CLIENT_ID: "1552633893587394590", HOSTED_PILOT: false } }));
const logged = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../src/services/housekeeping.js", () => ({ postToLogChannel: logged }));

import { hideDetached } from "../src/database.js";
import { parseAddonSnapshot } from "../src/integrations/addon.js";
import {
  contestCharacter, DETACHED, detachCharacter, evidenceOf, evidenceRank, HOLDING_MEMBER_PREFIX, moveCharacter,
  officerMoveCharacter, undoMove, WITH_DETACHED
} from "../src/services/character-move.js";
import { linkPairedCharacter } from "../src/services/character-pairing.js";
import { handleLinkMoveButton, tellLinkConflicts } from "../src/services/link-conflict-dm.js";
import { t } from "../src/i18n.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

// In-memory persistence boundary that honours the filters the services use; the services are real.
function newGuild() {
  const characters: Row[] = [];
  const members: { id: string; guildId: string; discordUserId: string; displayName: string; status: string }[] = ["ray", "kev", "sam"].map((id) => ({ id, guildId: "guild", discordUserId: `user-${id}`, displayName: id, status: "ACTIVE" }));
  const claims: { guildId: string; memberId: string; nameKey: string; status: string }[] = [];
  const conflicts: (Record<string, unknown> & { id: string; characterId: string; claimantMemberId: string; status: string; notifiedAt: Date | null })[] = [];
  const history: { characterId: string; profession: string }[] = [];
  const matches = (row: Row, where: Record<string, unknown> = {}): boolean => Object.entries(where).every(([key, value]) => {
    if (key === "member") return true;
    if (key === "OR") return (value as Record<string, unknown>[]).some((part) => matches(row, part));
    if (key === "AND") return (value as Record<string, unknown>[]).every((part) => matches(row, part));
    if (key === "detachedAt") return value === null ? !row.detachedAt : Boolean(row.detachedAt);
    if (value && typeof value === "object" && "in" in value) return (value.in as unknown[]).includes(row[key]);
    return row[key] === value;
  });
  const db = {
    character: {
      // Like production (database.ts): detached rows are hidden unless the query names detachedAt.
      findMany: vi.fn(async (args: { where?: Record<string, unknown> } = {}) => characters.filter((row) => matches(row, hideDetached(args).where as Record<string, unknown>)).map((row) => ({ ...row, member: members.find((member) => member.id === row.memberId) }))),
      findFirst: vi.fn(async (args: { where?: Record<string, unknown> }) => characters.filter((row) => matches(row, hideDetached(args).where as Record<string, unknown>)).sort((a, b) => Number(b.level ?? 0) - Number(a.level ?? 0))[0] ?? null),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => { const row = characters.find((item) => item.id === where.id); return row ? { ...row, member: members.find((member) => member.id === row.memberId) } : null; }),
      count: vi.fn(async (args: { where?: Record<string, unknown> }) => characters.filter((row) => matches(row, hideDetached(args).where as Record<string, unknown>)).length),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: `character-${characters.length}`, detachedAt: null, ...data } as Row; characters.push(row); return row; }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(characters.find((row) => row.id === where.id)!, data)),
      delete: vi.fn()
    },
    member: {
      upsert: vi.fn(async ({ where, create }: { where: { guildId_discordUserId: { guildId: string; discordUserId: string } }; create: Record<string, unknown> }) => {
        const found = members.find((member) => member.discordUserId === where.guildId_discordUserId.discordUserId);
        if (found) return found;
        const row = { id: "holding", ...create } as typeof members[number];
        members.push(row);
        return row;
      }),
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => members.filter((member) => where.id.in.includes(member.id)))
    },
    characterVerifyClaim: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findFirst: vi.fn(async ({ where }: { where: any }) => claims.find((row) => row.memberId === where.memberId && row.nameKey === where.nameKey
        && (typeof where.status === "string" ? row.status === where.status : (where.status as { in: string[] } | undefined)?.in.includes(row.status) ?? true)) ?? null),
      findMany: vi.fn(async ({ where }: { where: { nameKey: { in: string[] } } }) => claims.filter((row) => where.nameKey.in.includes(row.nameKey))),
      upsert: vi.fn(async ({ where, create, update }: { where: { guildId_memberId_nameKey: { memberId: string; nameKey: string } }; create: typeof claims[number]; update: object }) => {
        const key = where.guildId_memberId_nameKey;
        const found = claims.find((row) => row.memberId === key.memberId && row.nameKey === key.nameKey);
        if (found) return Object.assign(found, update);
        claims.push(create);
        return create;
      }),
      deleteMany: vi.fn(async ({ where }: { where: { memberId: string; nameKey: string; status: { in: string[] } } }) => {
        for (let index = claims.length - 1; index >= 0; index--) {
          const row = claims[index]!;
          if (row.memberId === where.memberId && row.nameKey === where.nameKey && where.status.in.includes(row.status)) claims.splice(index, 1);
        }
      })
    },
    characterLinkConflict: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; characterId_claimantMemberId?: { characterId: string; claimantMemberId: string } } }) => {
        const row = conflicts.find((item) => where.id ? item.id === where.id
          : item.characterId === where.characterId_claimantMemberId!.characterId && item.claimantMemberId === where.characterId_claimantMemberId!.claimantMemberId);
        return row ? { ...row, character: characters.find((item) => item.id === row.characterId) } : null;
      }),
      findMany: vi.fn(async ({ where }: { where: { notifiedAt?: null; status?: { in: string[] } } }) => conflicts
        .filter((row) => (where.notifiedAt === undefined || row.notifiedAt === null) && (!where.status || where.status.in.includes(row.status)))
        .map((row) => ({ ...row, character: characters.find((item) => item.id === row.characterId) }))),
      upsert: vi.fn(async ({ where, create, update }: { where: { characterId_claimantMemberId: { characterId: string; claimantMemberId: string } }; create: Record<string, unknown>; update: object }) => {
        const key = where.characterId_claimantMemberId;
        const found = conflicts.find((row) => row.characterId === key.characterId && row.claimantMemberId === key.claimantMemberId);
        if (found) return Object.assign(found, update);
        const row = { id: `conflict-${conflicts.length}`, ...create } as typeof conflicts[number];
        conflicts.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: object }) => Object.assign(conflicts.find((row) => row.id === where.id)!, data)),
      updateMany: vi.fn(async ({ where, data }: { where: { characterId?: string; id?: { in: string[] }; status?: { in: string[] } }; data: object }) => {
        for (const row of conflicts) {
          if ((where.characterId === undefined || row.characterId === where.characterId) && (!where.id || where.id.in.includes(row.id)) && (!where.status || where.status.in.includes(row.status))) Object.assign(row, data);
        }
      })
    },
    guild: { findUnique: vi.fn(async () => ({ discordId: "discord-guild", settings: { language: "en" } })) },
    professionSkill: { upsert: vi.fn() },
    unclaimedCharacter: { deleteMany: vi.fn() }
  };
  const database = { ...db, $transaction: async (callback: (tx: typeof db) => unknown) => callback(db) };
  const add = (name: string, memberId: string, extra: Record<string, unknown> = {}) => {
    const row = { id: `character-${characters.length}`, guildId: "guild", name, realm: "Forever", gameEdition: "forever", className: "Mage", memberId, isMain: false, level: 10, detachedAt: null, ...extra } as Row;
    characters.push(row);
    return row;
  };
  return { db, tx: db as never, database: database as never, characters, claims, conflicts, history, add };
}

const upload = (name: string) => parseAddonSnapshot({ source: "Guilded", exportedAt: "2026-11-10T20:00:00Z", characters: [{ name, realm: "Forever", class: "MAGE", level: 60 }] }).characters[0]!;

describe("proof order", () => {
  it("ranks named < companion < heard < officer", () => {
    expect(["named", "companion", "heard", "officer"].map((value) => evidenceRank(value as never))).toEqual([1, 2, 3, 4]);
  });

  it("reads the proof of rows linked before the column existed", () => {
    expect(evidenceOf({})).toBe("named");
    expect(evidenceOf({ confirmedAt: new Date() })).toBe("companion");
    expect(evidenceOf({ confirmedAt: new Date() }, "PROVISIONAL")).toBe("heard");
    expect(evidenceOf({}, "LINKED")).toBe("officer");
    // A stored proof wins over what the row could be guessed to be.
    expect(evidenceOf({ linkEvidence: "named", confirmedAt: new Date() }, "LINKED")).toBe("named");
  });
});

describe("moveCharacter", () => {
  it("keeps the row and its id, hands over the main flag and records the proof", async () => {
    const guild = newGuild();
    const main = guild.add("Ray One", "ray", { isMain: true, level: 60 });
    guild.add("Ray Two", "ray", { level: 40 });
    guild.add("Ray Three", "ray", { level: 55 });
    guild.history.push({ characterId: main.id, profession: "Cooking" });
    const moved = await moveCharacter(guild.tx, main.id, "kev", { evidence: "officer", by: "officer" });
    expect(moved).toMatchObject({ fromMemberId: "ray", wasDetached: false, character: { id: main.id, memberId: "kev", isMain: true } });
    expect(guild.characters).toHaveLength(3);
    expect(main).toMatchObject({ memberId: "kev", linkEvidence: "officer" });
    expect(main.confirmedAt).toBeInstanceOf(Date);
    // History hangs off the character id, which did not change.
    expect(guild.history).toEqual([{ characterId: main.id, profession: "Cooking" }]);
    expect(guild.db.character.delete).not.toHaveBeenCalled();
    // The previous owner's highest character becomes their main.
    expect(guild.characters.filter((row) => row.memberId === "ray").map((row) => [row.name, row.isMain])).toEqual([["Ray Two", false], ["Ray Three", true]]);
    // An officer's decision: the previous owner's uploads and code do not take it back.
    expect(guild.claims).toEqual(expect.arrayContaining([{ guildId: "guild", memberId: "ray", nameKey: "ray one", status: "REMOVED" }, { guildId: "guild", memberId: "kev", nameKey: "ray one", status: "LINKED" }]));
    await expect(linkPairedCharacter(guild.database, "guild", "ray", upload("Ray One"), { confirm: true })).resolves.toBe("owned-by-another");
  });

  it("is an alt for a member who already has a main, and a reported proof is not confirmed", async () => {
    const guild = newGuild();
    guild.add("Kev Main", "kev", { isMain: true });
    const row = guild.add("Shared", "ray", { confirmedAt: new Date() });
    await moveCharacter(guild.tx, row.id, "kev", { evidence: "heard", by: "proof" });
    expect(row).toMatchObject({ memberId: "kev", isMain: false, linkEvidence: "heard", confirmedAt: null });
  });

  it("answers null for a character that is gone", async () => {
    expect(await moveCharacter(newGuild().tx, "nope", "kev", { evidence: "officer", by: "officer" })).toBeNull();
  });
});

describe("conflicts from a member's own companion", () => {
  it("stronger proof takes the character, history kept, and both members and the officers hear it once", async () => {
    const guild = newGuild();
    const row = guild.add("Squatted", "ray", { isMain: true }); // claimed by name
    await expect(linkPairedCharacter(guild.database, "guild", "kev", upload("Squatted"), { confirm: true })).resolves.toBe("linked");
    expect(row).toMatchObject({ memberId: "kev", linkEvidence: "companion", isMain: true });
    expect(guild.characters).toHaveLength(1);
    expect(guild.conflicts).toMatchObject([{ status: "MOVED", ownerMemberId: "ray", claimantMemberId: "kev", ownerEvidence: "named", claimantEvidence: "companion", notifiedAt: null }]);

    const send = vi.fn(async () => undefined);
    const client = { users: { send }, guilds: { fetch: vi.fn(async () => ({ name: "Québec Gold" })) } };
    logged.mockClear();
    expect(await tellLinkConflicts(client as never, guild.database, { id: "guild", discordId: "discord-guild" }, "en")).toBe(1);
    expect(send.mock.calls.map((call) => (call as unknown[])[0])).toEqual(["user-kev", "user-ray"]);
    const [gained, lost] = send.mock.calls.map((call) => (call as unknown[])[1] as { content: string; components: { components: { data: { custom_id: string; label: string } }[] }[] });
    expect(gained!.content).toContain("**Squatted** is now linked to you on **Québec Gold**");
    expect(gained!.components[0]!.components[0]!.data).toMatchObject({ custom_id: "linkmove:undo:conflict-0", label: "Not mine, undo" });
    expect(lost!.content).toContain("was moved from you to another member");
    expect(lost!.components[0]!.components[0]!.data.label).toBe("It is mine, undo");
    expect(logged).toHaveBeenCalledTimes(1);
    expect((logged.mock.calls[0] as unknown[])[1]).toContain("moved from <@user-ray> to <@user-kev>");
    // Told once.
    expect(await tellLinkConflicts(client as never, guild.database, { id: "guild", discordId: "discord-guild" }, "en")).toBe(0);
  });

  it("equal proof never moves: it waits for an officer, and is said once", async () => {
    const guild = newGuild();
    const row = guild.add("Shared", "ray", { linkEvidence: "companion", confirmedAt: new Date() });
    await expect(linkPairedCharacter(guild.database, "guild", "kev", upload("Shared"), { confirm: true })).resolves.toBe("owned-by-another");
    await expect(linkPairedCharacter(guild.database, "guild", "kev", upload("Shared"), { confirm: true })).resolves.toBe("owned-by-another");
    expect(row.memberId).toBe("ray");
    expect(guild.conflicts).toMatchObject([{ status: "OPEN", ownerEvidence: "companion", claimantEvidence: "companion" }]);
    const send = vi.fn(async () => undefined);
    logged.mockClear();
    await tellLinkConflicts({ users: { send }, guilds: { fetch: vi.fn(async () => ({ name: "QG" })) } } as never, guild.database, { id: "guild", discordId: "d" }, "fr");
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0] as unknown[])[0]).toBe("user-kev");
    expect(((send.mock.calls[0] as unknown[])[1] as { content: string }).content).toContain("Les officiers ont été avisés");
    expect((logged.mock.calls[0] as unknown[])[1]).toContain("/officer character move");
  });

  it("weaker proof leaves it alone and tells the claimant, not the officers", async () => {
    const guild = newGuild();
    const row = guild.add("Officer Linked", "ray", { linkEvidence: "officer", confirmedAt: new Date() });
    await expect(linkPairedCharacter(guild.database, "guild", "kev", upload("Officer Linked"), { confirm: true })).resolves.toBe("owned-by-another");
    expect(row.memberId).toBe("ray");
    expect(guild.conflicts).toMatchObject([{ status: "WEAKER" }]);
    const send = vi.fn(async () => undefined);
    logged.mockClear();
    await tellLinkConflicts({ users: { send }, guilds: { fetch: vi.fn(async () => ({ name: "QG" })) } } as never, guild.database, { id: "guild", discordId: "d" }, "en");
    expect(send).toHaveBeenCalledTimes(1);
    expect(logged).not.toHaveBeenCalled();
  });

  it("does nothing for a member who unlinked it or had it removed by an officer", async () => {
    const guild = newGuild();
    const row = guild.add("Named", "ray");
    guild.claims.push({ guildId: "guild", memberId: "kev", nameKey: "named", status: "REMOVED" });
    expect(await contestCharacter(guild.tx, { guildId: "guild", claimantMemberId: "kev", evidence: "officer", character: row as never })).toBe("declined");
    expect(row.memberId).toBe("ray");
    expect(guild.conflicts).toEqual([]);
  });
});

describe("undo", () => {
  const moved = async () => {
    const guild = newGuild();
    const row = guild.add("Squatted", "ray", { isMain: true });
    await linkPairedCharacter(guild.database, "guild", "kev", upload("Squatted"), { confirm: true });
    return { guild, row };
  };

  it("\"not mine\" gives it back and never offers it to that member again", async () => {
    const { guild, row } = await moved();
    expect(await undoMove(guild.database, "conflict-0", "user-kev")).toMatchObject({ status: "undone", characterName: "Squatted" });
    expect(row).toMatchObject({ memberId: "ray", linkEvidence: "named", isMain: true });
    expect(guild.conflicts[0]!.status).toBe("UNDONE");
    await expect(linkPairedCharacter(guild.database, "guild", "kev", upload("Squatted"), { confirm: true })).resolves.toBe("owned-by-another");
    expect(row.memberId).toBe("ray");
    // A second press, or anyone else's, changes nothing.
    expect(await undoMove(guild.database, "conflict-0", "user-kev")).toEqual({ status: "gone" });
  });

  it("the member who lost it takes it back and the officers decide: stronger proof does not move it twice", async () => {
    const { guild, row } = await moved();
    expect(await undoMove(guild.database, "conflict-0", "user-sam")).toEqual({ status: "not-yours" });
    expect(await undoMove(guild.database, "conflict-0", "user-ray")).toMatchObject({ status: "contested" });
    expect(row.memberId).toBe("ray");
    expect(guild.conflicts[0]!.status).toBe("OPEN");
    await expect(linkPairedCharacter(guild.database, "guild", "kev", upload("Squatted"), { confirm: true })).resolves.toBe("owned-by-another");
    expect(row.memberId).toBe("ray");
    // The officer decides, which closes the queue.
    await officerMoveCharacter(guild.database, row.id, "kev");
    expect(row).toMatchObject({ memberId: "kev", linkEvidence: "officer" });
    expect(guild.conflicts[0]!.status).toBe("RESOLVED");
  });

  it("the button answers, removes itself and writes one officer-log line", async () => {
    const { guild } = await moved();
    logged.mockClear();
    const interaction = {
      customId: "linkmove:undo:conflict-0", user: { id: "user-kev" }, locale: "en-US",
      deferReply: vi.fn(async () => undefined), editReply: vi.fn(async () => undefined), message: { edit: vi.fn(async () => undefined) },
      client: { guilds: { fetch: vi.fn(async () => ({ name: "QG" })) } }
    };
    await handleLinkMoveButton(interaction as never, guild.database);
    expect(interaction.editReply).toHaveBeenCalledWith({ content: t("en", "linkmove.undone", { name: "Squatted" }) });
    expect(interaction.message.edit).toHaveBeenCalledWith({ components: [] });
    expect((logged.mock.calls[0] as unknown[])[1]).toBe(t("en", "linkmove.logUndone", { name: "Squatted", from: "user-ray", to: "user-kev" }));
    await handleLinkMoveButton(interaction as never, guild.database);
    expect(interaction.editReply).toHaveBeenLastCalledWith({ content: t("en", "linkmove.tooLate") });
  });
});

describe("unlink detaches", () => {
  it("keeps the row under the holding member, hidden from ordinary reads", async () => {
    const guild = newGuild();
    const row = guild.add("Ray One", "ray", { isMain: true, linkEvidence: "companion" });
    guild.add("Ray Two", "ray");
    expect(await detachCharacter(guild.tx, row.id)).toEqual({ fromMemberId: "ray" });
    expect(guild.characters).toHaveLength(2);
    expect(row).toMatchObject({ memberId: "holding", isMain: false, detachedFromMemberId: "ray" });
    expect(row.detachedAt).toBeInstanceOf(Date);
    expect(guild.db.member.upsert.mock.calls[0]![0].create).toMatchObject({ discordUserId: `${HOLDING_MEMBER_PREFIX}guild`, status: "LEFT", isTest: true });
    expect((await guild.db.character.findMany({ where: { member: { guildId: "guild" } } })).map((item) => item.name)).toEqual(["Ray Two"]);
    expect(guild.characters[1]!.isMain).toBe(true);
    expect(await detachCharacter(guild.tx, row.id)).toBeNull();
  });

  it("comes back as the same row when the member's companion links it again", async () => {
    const guild = newGuild();
    const row = guild.add("Ray One", "ray", { isMain: true });
    await detachCharacter(guild.tx, row.id);
    await expect(linkPairedCharacter(guild.database, "guild", "kev", upload("Ray One"), { confirm: true })).resolves.toBe("linked");
    expect(guild.characters).toHaveLength(1);
    expect(guild.db.character.create).not.toHaveBeenCalled();
    expect(row).toMatchObject({ id: "character-0", memberId: "kev", detachedAt: null, detachedFromMemberId: null, linkEvidence: "companion", isMain: true, level: 60 });
  });

  it("an officer can move a detached character to the right member", async () => {
    const guild = newGuild();
    const row = guild.add("Ray One", "ray");
    await detachCharacter(guild.tx, row.id);
    expect(await officerMoveCharacter(guild.database, row.id, "sam")).toMatchObject({ wasDetached: true, character: { memberId: "sam" } });
    expect(row).toMatchObject({ memberId: "sam", detachedAt: null, linkEvidence: "officer" });
    // Nobody lost it this time: no REMOVED claim for the holding member.
    expect(guild.claims).toEqual([{ guildId: "guild", memberId: "sam", nameKey: "ray one", status: "LINKED" }]);
  });
});

describe("hideDetached (database.ts)", () => {
  it("adds detachedAt: null to character reads", () => {
    expect(hideDetached(undefined)).toEqual({ where: { detachedAt: null } });
    expect(hideDetached({ where: {} })).toEqual({ where: { detachedAt: null } });
    expect(hideDetached({ where: { member: { guildId: "g" } }, take: 5 })).toEqual({ where: { AND: [{ member: { guildId: "g" } }, { detachedAt: null }] }, take: 5 });
  });

  it("leaves a query that names detachedAt alone", () => {
    for (const where of [DETACHED, { guildId: "g", ...WITH_DETACHED }, { AND: [{ detachedAt: null }] }]) expect(hideDetached({ where })).toEqual({ where });
  });
});
