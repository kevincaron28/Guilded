import { describe, expect, it } from "vitest";
import { ApplicationStatus } from "@prisma/client";
import { applicationDecisionRows, createApplicationService } from "../src/services/application.js";
import { coreRosterEmbed, createRaidCoreService } from "../src/services/raid-core.js";
import { classLeaderRoleName, hasPermission, isPermissionRoleName } from "../src/permissions.js";
import { guildRoleOf } from "../src/services/housekeeping.js";
import { applyAddonItemPrices, parseItemValues, priceDraft } from "../src/services/item-values.js";

// 4.5: trial applications, trial members on the roster, per-class leader roles, the officer
// log's guild-role filter, and item prices (prefilled list, prices set in game).

const buttonIds = (status: ApplicationStatus) =>
  applicationDecisionRows("app1", status).flatMap((row) => row.components.map((button) => (button.toJSON() as { custom_id: string }).custom_id));

describe("application card buttons", () => {
  it("offers all three while pending", () => {
    expect(buttonIds(ApplicationStatus.PENDING)).toEqual(["apply-form:decide:approve:app1", "apply-form:decide:trial:app1", "apply-form:decide:reject:app1"]);
  });
  it("keeps Approve and Reject after Trial, so the trial can be settled later", () => {
    expect(buttonIds(ApplicationStatus.TRIAL)).toEqual(["apply-form:decide:approve:app1", "apply-form:decide:reject:app1"]);
  });
  it("has none once approved or rejected", () => {
    expect(buttonIds(ApplicationStatus.APPROVED)).toEqual([]);
    expect(buttonIds(ApplicationStatus.REJECTED)).toEqual([]);
  });
  it("lets a trial application be approved (and nothing after that)", async () => {
    const row = { id: "app1", guildId: "g", status: ApplicationStatus.TRIAL as ApplicationStatus };
    const db = { application: {
      findFirst: async () => row,
      update: async ({ data }: { data: { status: ApplicationStatus } }) => Object.assign(row, data)
    } } as never;
    const service = createApplicationService(db);
    expect((await service.transition("g", "app1", ApplicationStatus.APPROVED, "officer")).status).toBe(ApplicationStatus.APPROVED);
    await expect(service.transition("g", "app1", ApplicationStatus.REJECTED, "officer")).rejects.toThrow("cannot be changed");
  });
  it("saves the raid role picked before the form", async () => {
    let saved: Record<string, unknown> = {};
    const db = { application: { create: async ({ data }: { data: Record<string, unknown> }) => (saved = data) } } as never;
    await createApplicationService(db).create({
      guildId: "g", memberId: "m", character: "Thrall", className: "Shaman", spec: "Enhancement",
      experience: "MC", availability: "Tue/Thu", coreId: "c1", role: "HEALER"
    });
    expect(saved["role"]).toBe("HEALER");
  });
});

describe("trial members in a core", () => {
  function fakeCoreMembers() {
    const rows: { coreId: string; memberId: string; role: string; bench: boolean; trial: boolean }[] = [];
    const db = { raidCoreMember: {
      upsert: async ({ where, create, update }: { where: { coreId_memberId: { coreId: string; memberId: string } }; create: typeof rows[number]; update: Partial<typeof rows[number]> }) => {
        const found = rows.find((row) => row.coreId === where.coreId_memberId.coreId && row.memberId === where.coreId_memberId.memberId);
        if (found) return Object.assign(found, update);
        const row = Object.assign({ bench: false, trial: false }, create);
        rows.push(row);
        return row;
      },
      deleteMany: async ({ where }: { where: { coreId: string; memberId: string; trial: boolean } }) => {
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i--) {
          const row = rows[i]!;
          if (row.coreId === where.coreId && row.memberId === where.memberId && row.trial === where.trial) rows.splice(i, 1);
        }
        return { count: before - rows.length };
      }
    } } as never;
    return { rows, service: createRaidCoreService(db) };
  }

  it("Trial adds them with their role, Approve clears the mark and keeps the role", async () => {
    const { rows, service } = fakeCoreMembers();
    await service.settleApplicant("c1", "m1", "TRIAL", "TANK");
    expect(rows).toEqual([{ coreId: "c1", memberId: "m1", role: "TANK", bench: false, trial: true }]);
    await service.settleApplicant("c1", "m1", "APPROVED", "DPS");
    expect(rows[0]).toMatchObject({ role: "TANK", trial: false });
  });

  it("Reject takes a trial member off, but never a full member", async () => {
    const { rows, service } = fakeCoreMembers();
    await service.settleApplicant("c1", "m1", "TRIAL", "HEALER");
    expect(await service.settleApplicant("c1", "m1", "REJECTED", null)).toBe(true);
    expect(rows).toEqual([]);
    await service.settleApplicant("c1", "m2", "APPROVED", "DPS");
    expect(await service.settleApplicant("c1", "m2", "REJECTED", null)).toBe(false);
    expect(rows).toHaveLength(1);
  });

  it("the roster shows trial members apart and counts them in the footer", () => {
    const embed = coreRosterEmbed({
      name: "Tuesday MC", description: null,
      members: [
        { role: "TANK", bench: false, member: { displayName: "Ann" } },
        { role: "HEALER", bench: false, trial: true, member: { displayName: "Newbie" } },
        { role: "DPS", bench: true, member: { displayName: "Sub" } }
      ]
    }).toJSON();
    const fields = embed.fields ?? [];
    expect(fields.find((field) => field.name.startsWith("🧪"))?.value).toBe("Newbie (Healer)");
    expect(fields.find((field) => field.name.includes("Healer") && !field.name.startsWith("🧪"))?.value).toBe("—");
    expect(embed.footer?.text).toContain("1 core member + 1 on trial + 1 on the bench");
  });
});

describe("per-class leader roles", () => {
  const member = (...names: string[]) => ({ permissions: { has: () => false }, roles: { cache: names.map((name) => ({ name })) } }) as never;
  it("names one role per class, in English or French", () => {
    expect(classLeaderRoleName("Warrior", "en")).toBe("Class Leader (Warrior)");
    expect(classLeaderRoleName("Warlock", "fr")).toBe("Chef de classe (Démoniste)");
  });
  it("counts each as Class Leader, and nothing more", () => {
    expect(isPermissionRoleName("classLeader", "Class Leader (Mage)")).toBe(true);
    expect(isPermissionRoleName("classLeader", "Chef de classe (Mage)")).toBe(true);
    expect(isPermissionRoleName("classLeader", "Class Leader of fun")).toBe(false);
    expect(hasPermission(member("Class Leader (Priest)"), "classLeader")).toBe(true);
    expect(hasPermission(member("Class Leader (Priest)"), "officer")).toBe(false);
  });
});

describe("officer log: guild roles only", () => {
  it("recognizes the Member role and every leadership role", () => {
    expect(guildRoleOf([{ id: "1", name: "Pinky" }], "99")).toBeNull();
    expect(guildRoleOf([{ id: "99", name: "Raider" }], "99")).toBe("Raider");
    expect(guildRoleOf([{ id: "2", name: "Loot Leader" }], null)).toBe("Loot Leader");
    expect(guildRoleOf([{ id: "3", name: "Class Leader (Druid)" }], null)).toBe("Class Leader (Druid)");
    expect(guildRoleOf([{ id: "4", name: "Officier" }], null)).toBe("Officier");
  });
});

describe("item prices", () => {
  it("skips 'Item = ?' lines from a prefilled list quietly", () => {
    const { values, problems } = parseItemValues("Sulfuras = 250\nOnyxia Scale Cloak = ?\nBindings =");
    expect(values).toEqual([{ name: "Sulfuras", id: null, gp: 250 }]);
    expect(problems).toEqual([]);
  });

  it("prefills current prices, then wishlisted or past items with the average paid", async () => {
    const db = {
      coreItemValue: { findMany: async ({ where }: { where: { coreId: unknown } }) => (
        typeof where.coreId === "string" ? [{ itemKey: "sulfuras", itemId: null, itemName: "Sulfuras", gp: 250, coreId: "c1" }]
          : [{ itemKey: "sulfuras", itemId: null, itemName: "Sulfuras", gp: 250, coreId: "c1" }]) },
      wishlistEntry: { findMany: async () => [{ itemName: "Onyxia Scale Cloak" }, { itemName: "Sulfuras" }] },
      lootAward: { findMany: async () => [{ itemName: "Band of Accuria", amount: 100 }, { itemName: "Band of Accuria", amount: 60 }] }
    } as never;
    const draft = await priceDraft(db, "g", "c1");
    expect(draft.text.split("\n")).toEqual(["Sulfuras = 250", "Band of Accuria = 80", "Onyxia Scale Cloak = ?"]);
    expect(draft.suggested).toBe(1);
  });

  it("keeps a price set in game unless Discord changed it more recently", async () => {
    const stored = new Map<string, { gp: number; updatedAt: Date }>([["c1:sulfuras", { gp: 200, updatedAt: new Date("2026-10-02T00:00:00Z") }]]);
    const db = {
      raidCore: { findMany: async () => [{ id: "c1" }] },
      coreItemValue: {
        findUnique: async ({ where }: { where: { guildId_coreId_itemKey: { coreId: string; itemKey: string } } }) =>
          stored.get(`${where.guildId_coreId_itemKey.coreId}:${where.guildId_coreId_itemKey.itemKey}`) ?? null,
        upsert: async ({ where, update }: { where: { guildId_coreId_itemKey: { coreId: string; itemKey: string } }; update: { gp: number } }) => {
          stored.set(`${where.guildId_coreId_itemKey.coreId}:${where.guildId_coreId_itemKey.itemKey}`, { gp: update.gp, updatedAt: new Date() });
        }
      }
    } as never;
    const saved = await applyAddonItemPrices(db, "g", [
      { name: "Sulfuras", gp: 300, coreId: "c1", at: new Date("2026-10-01T00:00:00Z") },   // older than Discord's: ignored
      { name: "Band of Accuria", gp: 90, coreId: "gone", at: new Date("2026-10-03T00:00:00Z") }  // unknown core: guild-wide
    ]);
    expect(saved).toBe(1);
    expect(stored.get("c1:sulfuras")?.gp).toBe(200);
    expect(stored.get(":band of accuria")?.gp).toBe(90);
  });
});
