import { describe, expect, it } from "vitest";
import { withTransactionMock } from "./helpers/transaction.js";
import { createRaidService as createService } from "../src/services/raid.js";
const createRaidService = (database: Parameters<typeof createService>[0]) => createService(withTransactionMock(database));
import { coreRosterEmbed, coreSpotLabel, createRaidCoreService } from "../src/services/raid-core.js";

type Signup = { id: string; raidId: string; memberId: string; role: string; status: string; signedUpAt: Date; member: { discordUserId: string; displayName: string } };

// A tiny in-memory stand-in for the raid tables.
function fakeDatabase(raid: Record<string, unknown>, coreMembers: string[]) {
  const signups: Signup[] = [];
  let clock = 0;
  const matches = (s: Signup, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => {
      const actual = (s as never as Record<string, unknown>)[key];
      if (value && typeof value === "object" && "not" in (value as object)) return actual !== (value as { not: unknown }).not;
      if (value && typeof value === "object" && "in" in (value as object)) return (value as { in: unknown[] }).in.includes(actual);
      return actual === value;
    });
  return {
    signups,
    raid: { findFirst: async () => raid, findUnique: async () => raid },
    raidCoreMember: { findMany: async () => coreMembers.map((memberId) => ({ memberId })) },
    raidSignup: {
      count: async ({ where }: { where: Record<string, unknown> }) => signups.filter((s) => matches(s, where)).length,
      findMany: async ({ where, orderBy }: { where: Record<string, unknown>; orderBy?: { signedUpAt: "asc" | "desc" } }) => {
        const rows = signups.filter((s) => matches(s, where));
        rows.sort((a, b) => (orderBy?.signedUpAt === "desc" ? -1 : 1) * (a.signedUpAt.getTime() - b.signedUpAt.getTime()));
        return rows;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Signup> }) => Object.assign(signups.find((s) => s.id === where.id)!, data),
      upsert: async ({ create, update, where }: { create: Partial<Signup>; update: Partial<Signup>; where: { raidId_memberId: { memberId: string } } }) => {
        const existing = signups.find((s) => s.memberId === where.raidId_memberId.memberId);
        if (existing) return Object.assign(existing, update);
        const row = { id: `s${signups.length + 1}`, signedUpAt: new Date(2026, 0, 1, 0, 0, ++clock), member: { discordUserId: `d-${create.memberId}`, displayName: String(create.memberId) }, ...create } as Signup;
        signups.push(row);
        return row;
      }
    }
  };
}

const raid = { id: "r1", guildId: "g", status: "PLANNED", coreId: "c1", tankLimit: null, healerLimit: null, dpsLimit: 2 };

describe("raid core signup priority", () => {
  it("a core member takes the slot of the latest non-core signup when the role is full", async () => {
    const database = fakeDatabase(raid, ["core1", "core2"]);
    const service = createRaidService(database as never);
    await service.signup("r1", "g", "pug1", "DPS");
    await service.signup("r1", "g", "pug2", "DPS");
    const result = await service.signup("r1", "g", "core1", "DPS");
    expect(result.status).toBe("SIGNED_UP");
    expect(result.bumped?.memberId).toBe("pug2");
    expect(database.signups.find((s) => s.memberId === "pug2")?.status).toBe("WAITLISTED");
    expect(database.signups.find((s) => s.memberId === "pug1")?.status).toBe("SIGNED_UP");
  });

  it("never bumps another core member, and a non-core player just waitlists", async () => {
    const database = fakeDatabase(raid, ["core1", "core2", "core3"]);
    const service = createRaidService(database as never);
    await service.signup("r1", "g", "core1", "DPS");
    await service.signup("r1", "g", "core2", "DPS");
    const third = await service.signup("r1", "g", "core3", "DPS");
    expect(third.status).toBe("WAITLISTED");
    expect(third.bumped).toBeNull();
    const pug = await service.signup("r1", "g", "pug", "DPS");
    expect(pug.status).toBe("WAITLISTED");
  });

  it("does nothing special for a raid without a core", async () => {
    const database = fakeDatabase({ ...raid, coreId: null }, ["core1"]);
    const service = createRaidService(database as never);
    await service.signup("r1", "g", "pug1", "DPS");
    await service.signup("r1", "g", "pug2", "DPS");
    const late = await service.signup("r1", "g", "core1", "DPS");
    expect(late.status).toBe("WAITLISTED");
    expect(late.bumped).toBeNull();
  });
});

describe("core roster embed", () => {
  it("groups members by role and counts them", () => {
    const embed = coreRosterEmbed({
      name: "Tuesday MC", description: "8pm", members: [
        { role: "TANK", bench: false, member: { displayName: "Bob" } }, { role: "DPS", bench: false, member: { displayName: "Zed" } }, { role: "DPS", bench: false, member: { displayName: "Amy" } }
      ]
    }).toJSON();
    expect(embed.title).toContain("Tuesday MC");
    expect(embed.fields?.map((f) => f.name)).toEqual(["🎲 Loot", "🛡️ Tanks (1)", "💚 Healers (0)", "⚔️ DPS (2)"]);
    expect(embed.fields?.find((f) => f.name.startsWith("⚔️"))?.value).toBe("Amy\nZed");
    expect(embed.footer?.text).toContain("3 core members");
  });
});

// One member in several cores: a spot per core, each with its own role and, optionally, its own
// character (the same one in both cores, or an alt in one of them).
function fakeCoreDatabase() {
  const cores = [{ id: "c1", guildId: "g", name: "Tuesday MC" }, { id: "c2", guildId: "g", name: "Weekend BWL" }];
  const characters = [
    { id: "ch-main", memberId: "m1", name: "Thrall" }, { id: "ch-alt", memberId: "m1", name: "Jaina" },
    { id: "ch-other", memberId: "m2", name: "Uther" }
  ];
  type Spot = { id: string; coreId: string; memberId: string; role: string; bench: boolean; trial: boolean; characterId: string | null };
  const spots: Spot[] = [];
  type Backup = { id: string; spotId: string; characterId: string; role: string };
  const backups: Backup[] = [];
  const withRelations = (spot: Spot) => ({
    ...spot, member: { displayName: spot.memberId }, character: characters.find((c) => c.id === spot.characterId) ?? null,
    core: cores.find((c) => c.id === spot.coreId),
    backups: backups.filter((b) => b.spotId === spot.id).map((b) => ({ ...b, character: characters.find((c) => c.id === b.characterId)! }))
  });
  const lower = (value: string) => value.trim().toLowerCase();
  return {
    spots, backups,
    raidCoreBackup: {
      upsert: async ({ where, create, update }: { where: { spotId_characterId: { spotId: string; characterId: string } }; create: Omit<Backup, "id">; update: Partial<Backup> }) => {
        const existing = backups.find((b) => b.spotId === where.spotId_characterId.spotId && b.characterId === where.spotId_characterId.characterId);
        if (existing) return Object.assign(existing, update);
        const row = { id: `b${backups.length + 1}`, ...create };
        backups.push(row);
        return row;
      },
      delete: async ({ where }: { where: { id: string } }) => backups.splice(backups.findIndex((b) => b.id === where.id), 1)[0]
    },
    raidCore: {
      findFirst: async ({ where }: { where: { OR: [{ id: string }, { name: { equals: string } }] } }) => {
        const core = cores.find((c) => c.id === where.OR[0].id || lower(c.name) === lower(where.OR[1].name.equals));
        return core ? { ...core, members: spots.filter((s) => s.coreId === core.id).map(withRelations) } : null;
      }
    },
    character: {
      findFirst: async ({ where }: { where: { memberId: string; name: { equals: string } } }) =>
        characters.find((c) => c.memberId === where.memberId && lower(c.name) === lower(where.name.equals)) ?? null
    },
    raidCoreMember: {
      upsert: async ({ where, create, update }: { where: { coreId_memberId: { coreId: string; memberId: string } }; create: Partial<Spot>; update: Partial<Spot> }) => {
        const existing = spots.find((s) => s.coreId === where.coreId_memberId.coreId && s.memberId === where.coreId_memberId.memberId);
        if (existing) return Object.assign(existing, update);
        const row = { id: `s${spots.length + 1}`, bench: false, trial: false, characterId: null, role: "DPS", ...create } as Spot;
        spots.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id?: string; coreId_memberId?: { coreId: string; memberId: string } }; data: Partial<Spot> }) => {
        const row = spots.find((s) => where.id ? s.id === where.id : s.coreId === where.coreId_memberId?.coreId && s.memberId === where.coreId_memberId?.memberId);
        if (!row) throw new Error("no row");
        return Object.assign(row, data);
      },
      findMany: async ({ where }: { where: { memberId: string } }) => spots.filter((s) => s.memberId === where.memberId).map(withRelations)
    }
  };
}

describe("one member in several raid cores", () => {
  it("keeps a spot in each core, with the same character in both", async () => {
    const database = fakeCoreDatabase();
    const service = createRaidCoreService(database as never);
    await service.addMember("g", "Tuesday MC", "m1", "TANK", false, "Thrall");
    await service.addMember("g", "Weekend BWL", "m1", "TANK", false, "thrall");
    const spots = await service.spotsOf("g", "m1");
    expect(spots.map((s) => [s.core?.name, s.role, s.character?.name])).toEqual([["Tuesday MC", "TANK", "Thrall"], ["Weekend BWL", "TANK", "Thrall"]]);
  });

  it("takes a different character and role per core, and a later change in one core leaves the other alone", async () => {
    const database = fakeCoreDatabase();
    const service = createRaidCoreService(database as never);
    await service.addMember("g", "c1", "m1", "TANK", false, "Thrall");
    await service.addMember("g", "c2", "m1", "DPS", true, "Jaina");
    // Moved to healer in core 1 without naming a character: Thrall stays.
    await service.addMember("g", "c1", "m1", "HEALER");
    const byCore = new Map((await service.spotsOf("g", "m1")).map((s) => [s.coreId, s]));
    expect(byCore.get("c1")).toMatchObject({ role: "HEALER", bench: false, characterId: "ch-main" });
    expect(byCore.get("c2")).toMatchObject({ role: "DPS", bench: true, characterId: "ch-alt" });
    const { character } = await service.setCharacter("g", "c1", "m1", "Jaina");
    expect(character?.name).toBe("Jaina");
    expect(database.spots.map((s) => s.characterId)).toEqual(["ch-alt", "ch-alt"]);
    await service.setCharacter("g", "c2", "m1", null);
    expect(database.spots.find((s) => s.coreId === "c2")?.characterId).toBeNull();
  });

  it("refuses a character that is not one of the player's own", async () => {
    const service = createRaidCoreService(fakeCoreDatabase() as never);
    await expect(service.addMember("g", "c1", "m1", "DPS", false, "Uther")).rejects.toThrow(/not one of that player's linked characters/);
    await expect(service.setCharacter("g", "c1", "m1", "Thrall")).rejects.toThrow(/not in Tuesday MC/);
  });

  it("an accepted application brings its character into that core only, without replacing one already set", async () => {
    const database = fakeCoreDatabase();
    const service = createRaidCoreService(database as never);
    await service.addMember("g", "c1", "m1", "TANK", false, "Thrall");
    await service.settleApplicant("c2", "m1", "TRIAL", "DPS", "Jaina");
    await service.settleApplicant("c1", "m1", "APPROVED", "DPS", "Jaina");
    const byCore = new Map(database.spots.map((s) => [s.coreId, s]));
    expect(byCore.get("c2")).toMatchObject({ trial: true, role: "DPS", characterId: "ch-alt" });
    expect(byCore.get("c1")).toMatchObject({ trial: false, role: "TANK", characterId: "ch-main" });
    // A character name that is not linked is ignored rather than failing the decision.
    await service.settleApplicant("c2", "m2", "APPROVED", "HEALER", "Nobody");
    expect(database.spots.find((s) => s.memberId === "m2")?.characterId).toBeNull();
  });

  it("the roster shows the character brought to the core", () => {
    const embed = coreRosterEmbed({
      name: "Weekend BWL", description: null, members: [
        { role: "DPS", bench: false, member: { displayName: "Kevin" }, character: { name: "Jaina" } },
        { role: "DPS", bench: false, member: { displayName: "Amy" } },
        { role: "TANK", bench: true, member: { displayName: "Bob" }, character: { name: "Garrosh" } }
      ]
    }).toJSON();
    expect(embed.fields?.find((f) => f.name.startsWith("⚔️"))?.value).toBe("Amy\nKevin · Jaina");
    expect(embed.fields?.find((f) => f.name.startsWith("🪑"))?.value).toBe("Bob · Garrosh (Tank)");
    expect(coreSpotLabel({ role: "DPS", bench: false, member: { displayName: "Kevin" }, character: null })).toBe("Kevin");
  });
});

describe("backup characters in the same core", () => {
  it("adds a backup with its own role, changes its role when added again, and removes it", async () => {
    const database = fakeCoreDatabase();
    const service = createRaidCoreService(database as never);
    await service.addMember("g", "c1", "m1", "TANK", false, "Thrall");
    await service.addBackup("g", "c1", "m1", "jaina", "HEALER");
    await service.addBackup("g", "c1", "m1", "Jaina", "DPS");
    expect(database.backups).toEqual([{ id: "b1", spotId: "s1", characterId: "ch-alt", role: "DPS" }]);
    await expect(service.addBackup("g", "c1", "m1", "Thrall", "DPS")).rejects.toThrow(/already their character/);
    await expect(service.addBackup("g", "c2", "m1", "Jaina", "DPS")).rejects.toThrow(/not in Weekend BWL/);
    await expect(service.addBackup("g", "c1", "m1", "Uther", "DPS")).rejects.toThrow(/linked characters/);
    const { character } = await service.removeBackup("g", "c1", "m1", "JAINA");
    expect(character.name).toBe("Jaina");
    expect(database.backups).toEqual([]);
    await expect(service.removeBackup("g", "c1", "m1", "Jaina")).rejects.toThrow(/not a backup/);
  });

  it("the roster lists backups apart and says which point pool the core uses", () => {
    const embed = coreRosterEmbed({
      name: "Tuesday MC", description: null, separatePool: true, members: [
        { role: "TANK", bench: false, member: { displayName: "Kevin" }, character: { name: "Thrall" }, backups: [{ role: "HEALER", character: { name: "Anduin" } }] }
      ]
    }).toJSON();
    expect(embed.fields?.find((f) => f.name.startsWith("💰"))?.value).toBe("This core's own pool");
    expect(embed.fields?.find((f) => f.name.startsWith("🔁"))).toEqual({ name: "🔁 Backup characters (1)", value: "Kevin · Anduin (Healer)", inline: false });
    const shared = coreRosterEmbed({ name: "X", description: null, separatePool: false, members: [] }).toJSON();
    expect(shared.fields?.find((f) => f.name.startsWith("💰"))?.value).toBe("Shared guild pool");
  });
});
