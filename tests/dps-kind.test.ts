import { describe, expect, it, vi } from "vitest";
import { dpsKind, signupSpec, specsForRole } from "../src/services/dps-kind.js";
import { openKindSpots, type SignupRow } from "../src/services/signup-embed.js";
import { signupLayout, SIGNUP_TEXT_LIMIT, type SignupLayoutInput } from "../src/services/signup-layout.js";
import { listingMatches, parseRoles, roleLabel, type PublicListing } from "../src/services/recruitment.js";
import { withTransactionMock } from "./helpers/transaction.js";
import { createRaidService as createService, DpsKindFullError } from "../src/services/raid.js";
import { withEdition } from "../src/services/edition-context.js";

const createRaidService = (database: Parameters<typeof createService>[0]) => createService(withTransactionMock(database));

describe("melee and ranged DPS", () => {
  it("sorts every damage spec, with Survival melee on Retail only", () => {
    expect(dpsKind("Rogue", "Combat", "forever")).toBe("MELEE");
    expect(dpsKind("Mage", "Fire", "forever")).toBe("RANGED");
    expect(dpsKind("Druid", "Feral Combat", "classic-era")).toBe("MELEE");
    expect(dpsKind("Druid", "Balance", "retail")).toBe("RANGED");
    expect(dpsKind("Shaman", "Enhancement", "retail")).toBe("MELEE");
    expect(dpsKind("Shaman", "Élémentaire", "forever")).toBe("RANGED");
    expect(dpsKind("Priest", "Shadow", "classic-tbc")).toBe("RANGED");
    expect(dpsKind("Demon Hunter", "Devourer", "retail")).toBe("RANGED");
    expect(dpsKind("Hunter", "Survival", "retail")).toBe("MELEE");
    expect(dpsKind("Hunter", "Survival", "forever")).toBe("RANGED");
    expect(dpsKind("Hunter", "Survival", "classic-mists")).toBe("RANGED");
  });

  it("falls back to the class when the spec is unknown or not a damage spec", () => {
    expect(dpsKind("Warrior", null, "forever")).toBe("MELEE");
    expect(dpsKind("Warrior", "Protection", "forever")).toBe("MELEE");
    expect(dpsKind("Priest", "Holy", "forever")).toBe("RANGED");
    expect(dpsKind("Guerrier", "", "forever")).toBe("MELEE");
    // Druids and Shamans play both: without a damage spec it cannot be told.
    expect(dpsKind("Druid", null, "forever")).toBeNull();
    expect(dpsKind("Shaman", "Restoration", "forever")).toBeNull();
    expect(dpsKind(null, "Fire", "forever")).toBeNull();
  });

  it("offers the specs that fit the signup's role in that WoW edition", () => {
    expect(specsForRole("Rogue", "DPS", "forever").map(spec => spec.name)).toEqual(["Assassination", "Combat", "Subtlety"]);
    expect(specsForRole("Rogue", "DPS", "retail").map(spec => spec.name)).toEqual(["Assassination", "Outlaw", "Subtlety"]);
    expect(specsForRole("Druid", "DPS", "forever").map(spec => spec.name)).toEqual(["Balance", "Feral"]);
    expect(specsForRole("Druid", "TANK", "retail").map(spec => spec.name)).toEqual(["Guardian"]);
    expect(specsForRole("Priest", "HEALER", "forever").map(spec => spec.name)).toEqual(["Discipline", "Holy"]);
    expect(specsForRole("Demon Hunter", "DPS", "retail").map(spec => spec.name)).toEqual(["Havoc", "Devourer"]);
    expect(specsForRole(null, "DPS", "forever")).toEqual([]);
  });

  it("uses the spec picked for the raid before the character's own", () => {
    expect(signupSpec({ spec: "Fire" }, { spec: "Frost" })).toBe("Fire");
    expect(signupSpec({ spec: null }, { spec: "Frost" })).toBe("Frost");
    expect(signupSpec({}, null)).toBeNull();
  });

  it("counts free melee and ranged seats", () => {
    const rows = [
      { role: "DPS" as const, status: "SIGNED_UP", kind: "MELEE" as const },
      { role: "DPS" as const, status: "WAITLISTED", kind: "MELEE" as const },
      { role: "DPS" as const, status: "SIGNED_UP", kind: "RANGED" as const }
    ];
    expect(openKindSpots({ MELEE: 3, RANGED: 1 }, rows)).toEqual([{ kind: "MELEE", open: 2 }]);
    expect(openKindSpots({ MELEE: null, RANGED: undefined }, rows)).toEqual([]);
  });
});

describe("signup post melee/ranged blocks", () => {
  const start = new Date("2026-12-10T01:00:00Z");
  const row = (id: string, role: SignupRow["role"], kind: "MELEE" | "RANGED" | null, className: string, spec: string): SignupRow =>
    ({ memberId: id, characterId: `c-${id}`, character: { name: id, className, spec }, displayName: id, role, status: "SIGNED_UP", kind });
  const input = (signups: SignupRow[], limits: { melee?: number | null; ranged?: number | null } = {}, lang: "en" | "fr" = "en"): SignupLayoutInput => ({
    lang, now: new Date("2026-12-09T12:00:00Z"), signups,
    raid: { id: "r", title: "Raid Night", description: null, status: "PLANNED", scheduledAt: start, tankLimit: 2, healerLimit: 4, dpsLimit: 14,
      meleeLimit: limits.melee ?? null, rangedLimit: limits.ranged ?? null }
  });
  const text = (layout: SignupLayoutInput) => JSON.stringify(signupLayout(layout, []).components[0]!.toJSON());

  it("splits DPS into melee, ranged and unknown once specs are known", () => {
    const out = text(input([row("Ana", "DPS", "MELEE", "Rogue", "Combat"), row("Bo", "DPS", "RANGED", "Mage", "Fire"),
      row("Cy", "DPS", "RANGED", "Warlock", "Affliction"), row("Di", "DPS", null, "Druid", ""), row("Ed", "TANK", null, "Warrior", "Protection")], { melee: 8 }));
    expect(out).toContain("🗡️ **`MELEE`** `1/8`");
    expect(out).toContain("🏹 **`RANGED`** `2`");
    expect(out).toContain("**`DPS · SPEC UNKNOWN`** `1`");
    expect(out).toContain("**DPS** ⚔️ 4/14");
    expect(out).not.toContain("**`DPS`**");
  });

  it("keeps a single DPS block while no spec is known and no limit is set", () => {
    const out = text(input([row("Di", "DPS", null, "Druid", "")]));
    expect(out).toContain("**`DPS`** `1/14`");
    expect(out).not.toContain("MELEE");
  });

  it("writes the blocks in French", () => {
    const out = text(input([row("Ana", "DPS", "MELEE", "Rogue", "Combat"), row("Bo", "DPS", "RANGED", "Mage", "Fire")], {}, "fr"));
    expect(out).toContain("**`MÊLÉE`**");
    expect(out).toContain("**`DISTANCE`**");
  });

  it("stays within Discord's limits for a full 40-player raid split three ways", () => {
    const signups = Array.from({ length: 60 }, (_, index) => row(`Player${index}`.padEnd(24, "x"), "DPS", index % 3 === 0 ? "MELEE" : index % 3 === 1 ? "RANGED" : null, "Mage", "Fire"));
    const payload = signupLayout(input(signups, { melee: 20, ranged: 20 }), []);
    const nodes: { type: number; content?: string; components?: unknown[] }[] = [];
    const walk = (node: { type: number; content?: string; components?: unknown[]; accessory?: unknown }) => {
      nodes.push(node); (node.components as typeof nodes | undefined)?.forEach(walk);
    };
    walk(payload.components[0]!.toJSON() as never);
    expect(nodes.filter(node => node.type === 10).map(node => node.content!).join("").length).toBeLessThanOrEqual(SIGNUP_TEXT_LIMIT);
    expect(nodes.length).toBeLessThanOrEqual(40);
  });
});

describe("recruitment melee and ranged needs", () => {
  const listing = (roles: string[]): PublicListing => ({ id: "l", guildName: "G", guildDiscordId: "1", pageSlug: null, inviteUrl: null, core: null, updatedAt: new Date(),
    open: true, classes: [], roles, raidDays: [], raidTimes: null, language: null, faction: null, realm: null, note: null });
  const filters = (role: "TANK" | "HEALER" | "DPS" | null) => ({ kind: "all" as const, className: null, role, faction: null, language: null, realm: null });

  it("reads melee and ranged (and French words) from /mod recruit", () => {
    expect(parseRoles("healer, ranged")).toEqual(["HEALER", "RANGED"]);
    expect(parseRoles("tank melee")).toEqual(["TANK", "MELEE"]);
    expect(parseRoles("distance")).toEqual(["RANGED"]);
    expect(() => parseRoles("bard")).toThrow("tank, healer, dps, melee or ranged");
    expect(roleLabel("MELEE", "fr")).toBe("DPS mêlée");
  });

  it("matches a melee or ranged need when a player looks for DPS", () => {
    expect(listingMatches(listing(["RANGED"]), filters("DPS"))).toBe(true);
    expect(listingMatches(listing(["RANGED"]), filters("TANK"))).toBe(false);
    expect(listingMatches(listing(["TANK"]), filters("DPS"))).toBe(false);
  });
});

describe("melee and ranged limits on raids", () => {
  const raid = { id: "raid1", guildId: "guild", status: "PLANNED", tankLimit: null, healerLimit: null, dpsLimit: null, meleeLimit: 1, rangedLimit: null, coreId: null, signupsCloseAt: null };
  const kindRow = (id: string, memberId: string, className: string, spec: string | null, extra: object = {}) =>
    ({ id, memberId, role: "DPS", status: "SIGNED_UP", spec: null, signedUpAt: new Date(), characterId: null, character: { className, spec }, member: { characters: [] }, ...extra });

  it("waitlists a melee player when melee is full, and lets a ranged player in", async () => {
    const run = (className: string, spec: string) => withEdition("forever", () => {
      const database = {
        raid: { findFirst: vi.fn().mockResolvedValue(raid) },
        character: { findFirst: vi.fn().mockResolvedValue({ className, spec }) },
        raidSignup: {
          findUnique: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0),
          findMany: vi.fn().mockResolvedValue([kindRow("s1", "other", "Rogue", "Combat")]),
          upsert: vi.fn().mockImplementation(async ({ create }) => create)
        }
      } as never;
      return createRaidService(database).signup("raid1", "guild", "member2", "DPS");
    });
    await expect(run("Warrior", "Fury")).resolves.toMatchObject({ status: "WAITLISTED" });
    await expect(run("Mage", "Fire")).resolves.toMatchObject({ status: "SIGNED_UP" });
  });

  it("refuses a spec change into a full melee group and keeps the old spec", async () => {
    const update = vi.fn();
    const database = {
      raid: { findFirst: vi.fn().mockResolvedValue(raid) },
      raidSignup: {
        findUnique: vi.fn().mockResolvedValue(kindRow("s2", "member2", "Druid", "Balance")),
        findMany: vi.fn().mockResolvedValue([kindRow("s1", "other", "Rogue", "Combat")]),
        update
      }
    } as never;
    await expect(withEdition("forever", () => createRaidService(database).setSignupSpec("raid1", "guild", "member2", "Feral"))).rejects.toBeInstanceOf(DpsKindFullError);
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects a spec that does not fit the class and role", async () => {
    const database = {
      raid: { findFirst: vi.fn().mockResolvedValue(raid) },
      raidSignup: { findUnique: vi.fn().mockResolvedValue(kindRow("s2", "member2", "Mage", "Fire")), findMany: vi.fn().mockResolvedValue([]), update: vi.fn() }
    } as never;
    await expect(withEdition("forever", () => createRaidService(database).setSignupSpec("raid1", "guild", "member2", "Holy"))).rejects.toThrow("does not fit");
  });

  it("moves a waiting player up only into a free seat of their own kind", async () => {
    const full = { ...raid, dpsLimit: 5 };
    const update = vi.fn().mockImplementation(async ({ where, data }) => ({ id: where.id, ...data }));
    const waiting = [kindRow("w1", "melee-waiting", "Rogue", "Combat", { status: "WAITLISTED" }), kindRow("w2", "ranged-waiting", "Mage", "Fire", { status: "WAITLISTED" })];
    const database = {
      raid: { findFirst: vi.fn().mockResolvedValue(full), findUnique: vi.fn().mockResolvedValue(full) },
      raidSignup: {
        findUnique: vi.fn().mockResolvedValue({ id: "s9", status: "SIGNED_UP", role: "TANK" }),
        update,
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockImplementation(async ({ where }) => where.status === "WAITLISTED"
          ? (where.role === "DPS" ? waiting.map(row => ({ ...row, member: { ...row.member, displayName: row.memberId } })) : [])
          : where.status === "SIGNED_UP" ? [kindRow("s1", "other", "Rogue", "Combat")] : [])
      }
    } as never;
    const result = await withEdition("forever", () => createRaidService(database).cancelSignup("raid1", "guild", "member9"));
    expect(result.promoted.map(row => row.memberId)).toEqual(["ranged-waiting"]);
  });
});
