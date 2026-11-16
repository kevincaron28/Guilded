import { PermissionFlagsBits } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { hierarchyError, MAX_TIMEOUT_MS, parseDuration, requireReason } from "../src/services/moderation.js";
import { createTagService, normalizeTagName } from "../src/services/tags.js";
import { createWishlistService, itemKey } from "../src/services/wishlist.js";
import { attendanceRate, createMeritService, meritScore } from "../src/services/merit.js";
import { selfRoleProblem } from "../src/services/selfrole.js";

describe("moderation helpers", () => {
  it("parses durations in s/m/h/d", () => {
    expect(parseDuration("30m")).toBe(30 * 60_000);
    expect(parseDuration("2h")).toBe(2 * 3_600_000);
    expect(parseDuration("1d")).toBe(86_400_000);
  });

  it("rejects malformed, zero, and over-cap durations", () => {
    expect(() => parseDuration("soon")).toThrow("Duration must look like");
    expect(() => parseDuration("0m")).toThrow("greater than zero");
    expect(() => parseDuration("29d")).toThrow("28 days");
    expect(parseDuration("28d")).toBe(MAX_TIMEOUT_MS);
  });

  it("requires a real reason", () => {
    expect(() => requireReason(" ab ")).toThrow("at least 3");
    expect(requireReason("  spamming  ")).toBe("spamming");
  });

  const base = { actorPosition: 5, targetPosition: 2, botPosition: 9, actorIsOwner: false, targetIsOwner: false };

  it("allows moderating someone below both the actor and the bot", () => {
    expect(hierarchyError(base)).toBeNull();
  });

  it("blocks the owner, equal/higher targets, and targets above the bot", () => {
    expect(hierarchyError({ ...base, targetIsOwner: true })).toContain("owner");
    expect(hierarchyError({ ...base, targetPosition: 5 })).toContain("equal to or above yours");
    expect(hierarchyError({ ...base, targetPosition: 9, actorPosition: 20 })).toContain("not high enough");
  });

  it("lets the server owner act on anyone below the bot regardless of their own position", () => {
    expect(hierarchyError({ ...base, actorPosition: 0, actorIsOwner: true })).toBeNull();
  });
});

describe("tags", () => {
  it("normalizes names and rejects bad ones", () => {
    expect(normalizeTagName("  Raid-Rules ")).toBe("raid-rules");
    expect(() => normalizeTagName("has space")).toThrow("Tag names use");
    expect(() => normalizeTagName("")).toThrow("Tag names use");
  });

  it("validates content before touching the database", () => {
    const service = createTagService({} as never);
    return Promise.all([
      expect(service.set("g", "rules", "   ", "u")).rejects.toThrow("cannot be empty"),
      expect(service.set("g", "rules", "x".repeat(1901), "u")).rejects.toThrow("limited to")
    ]);
  });

  it("upserts under the normalized name", async () => {
    const upsert = vi.fn().mockResolvedValue({ name: "rules" });
    const service = createTagService({ tag: { upsert } } as never);
    await service.set("guild1", "RULES", " be nice ", "officer");
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { guildId_name: { guildId: "guild1", name: "rules" } },
      create: expect.objectContaining({ content: "be nice" })
    }));
  });

  it("reports a missing tag on delete", async () => {
    const service = createTagService({ tag: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) } } as never);
    await expect(service.remove("g", "nope")).rejects.toThrow("No tag");
  });
});

describe("wishlist", () => {
  it("normalizes item keys for case/space-insensitive matching", () => {
    expect(itemKey("  Thunderfury,   Blessed Blade ")).toBe("thunderfury, blessed blade");
  });

  it("validates item name and priority", () => {
    const service = createWishlistService({} as never);
    expect(() => service.add("c", "x", 2)).toThrow("2-100");
    expect(() => service.add("c", "Some Item", 4)).toThrow("Priority must be");
  });

  it("upserts by normalized key and counts guild-wide wants", async () => {
    const upsert = vi.fn().mockResolvedValue({ itemName: "Sulfuras" });
    const count = vi.fn().mockResolvedValue(3);
    const service = createWishlistService({ wishlistEntry: { upsert, count } } as never);
    await service.add("char1", "Sulfuras", 1);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { characterId_itemKey: { characterId: "char1", itemKey: "sulfuras" } }
    }));
    await expect(service.countWanting("guild1", "  SULFURAS ")).resolves.toBe(3);
    expect(count).toHaveBeenCalledWith({ where: { itemKey: "sulfuras", character: { member: { guildId: "guild1" } } } });
  });
});

describe("merit", () => {
  it("gives Present full credit and Late half credit", () => {
    expect(attendanceRate(["PRESENT", "PRESENT", "LATE", "ABSENT"], 4)).toBe(0.625);
  });

  it("treats no raids as zero and caps at 100%", () => {
    expect(attendanceRate([], 0)).toBe(0);
    expect(attendanceRate(["PRESENT", "PRESENT"], 1)).toBe(1);
  });

  it("scales PR by attendance", () => {
    expect(meritScore(4, 0.5)).toBe(2);
    expect(meritScore(4, 0)).toBe(0);
  });

  it("computes per-member rates over completed raids in the window", async () => {
    const raid = { findMany: vi.fn().mockResolvedValue([{ id: "r1" }, { id: "r2" }]) };
    const raidAttendance = {
      findMany: vi.fn().mockResolvedValue([
        { memberId: "a", status: "PRESENT" },
        { memberId: "a", status: "PRESENT" },
        { memberId: "b", status: "LATE" }
      ])
    };
    const service = createMeritService({ raid, raidAttendance } as never);
    const rates = await service.getAttendanceRates("guild1", 30, new Date("2026-10-01T00:00:00Z"));
    expect(rates.get("a")).toBe(1);
    expect(rates.get("b")).toBe(0.25);
    expect(rates.has("c")).toBe(false);
  });

  it("returns no rates when there were no completed raids", async () => {
    const raid = { findMany: vi.fn().mockResolvedValue([]) };
    const service = createMeritService({ raid, raidAttendance: { findMany: vi.fn() } } as never);
    expect((await service.getAttendanceRates("guild1")).size).toBe(0);
  });
});

describe("self-assign role safety", () => {
  const safe = { id: "role1", managed: false, permissions: PermissionFlagsBits.SendMessages };

  it("allows a harmless role", () => {
    expect(selfRoleProblem(safe, "guild1")).toBeNull();
  });

  it("rejects @everyone, managed roles, and anything with management permissions", () => {
    expect(selfRoleProblem({ ...safe, id: "guild1" }, "guild1")).toContain("@everyone");
    expect(selfRoleProblem({ ...safe, managed: true }, "guild1")).toContain("integration");
    for (const permission of [PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageRoles, PermissionFlagsBits.BanMembers, PermissionFlagsBits.MentionEveryone]) {
      expect(selfRoleProblem({ ...safe, permissions: permission | PermissionFlagsBits.SendMessages }, "guild1")).toContain("cannot be self-assigned");
    }
  });

  it("rejects Guilded permission roles even when they have no Discord permissions", () => {
    for (const name of ["Raid Leader", "Chef de raid", "Officer", "Maître de guilde", "Class Leader", "Chef de classe (Guerrier)", "Class Leader (Warrior)"]) {
      expect(selfRoleProblem({ ...safe, name }, "guild1"), name).toContain("Guilded authority");
    }
    expect(selfRoleProblem({ ...safe, name: "Errant" }, "guild1")).toBeNull();
  });
});
