import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { assertBattlegroundCharacter, assertBattlegroundStart, battlegroundPlanSchema, battlegroundQueuePolicy, validateBattlegroundSlots } from "../src/services/battleground-policy.js";
import { createBattleground } from "../src/services/battleground-organization.js";

const plan = { version: 1 as const, edition: "retail" as const, realmType: "normal" as const, mode: "blitz" as const,
  map: "Random", minLevel: 90, maxLevel: 90, faction: "Alliance" as const };

describe("Battleground queue and identity boundaries", () => {
  it("does not confuse Blitz's eight-player match with a legal premade", () => {
    expect(battlegroundQueuePolicy(plan)?.partyLimit).toBe(2);
    expect(() => validateBattlegroundSlots(plan, { tanks: 0, healers: 2, dps: 6 })).toThrow();
    expect(() => validateBattlegroundSlots(plan, { tanks: 0, healers: 0, dps: 2 })).toThrow();
    expect(() => validateBattlegroundSlots(plan, { tanks: 0, healers: 1, dps: 1 })).not.toThrow();
    expect(() => assertBattlegroundStart(plan, [{ role: "DPS" }, { role: "DPS" }])).toThrow();
    expect(() => assertBattlegroundStart(plan, [{ role: "DPS" }])).not.toThrow();
    expect(() => assertBattlegroundStart(plan, [{ role: "HEALER" }, { role: "DPS" }])).not.toThrow();
    expect(() => assertBattlegroundStart(plan, [])).toThrow();
  });
  it("keeps unknown formats planning-only and rejects malformed or Hardcore metadata", () => {
    for (const edition of ["forever", "classic-era", "classic-tbc", "classic-mists", "retail"] as const) {
      const unknown = { ...plan, edition, mode: "casual" as const };
      expect(battlegroundQueuePolicy(unknown)).toBeNull();
      expect(() => assertBattlegroundStart(unknown, [{ role: "HEALER" }])).toThrow(/Planning only/);
    }
    for (const invalid of [{ realmType: "hardcore" }, { minLevel: 91 }, { minLevel: 80, maxLevel: 70 }, { version: 2 }, { publish: true }]) {
      expect(battlegroundPlanSchema.safeParse({ ...plan, ...invalid }).success).toBe(false);
    }
  });
  it("checks actual linked edition and level rather than the account's main", () => {
    expect(() => assertBattlegroundCharacter(plan, { gameEdition: "forever", level: 90 })).toThrow();
    expect(() => assertBattlegroundCharacter(plan, { gameEdition: "retail", level: null })).toThrow();
    expect(() => assertBattlegroundCharacter(plan, { gameEdition: "retail", level: 89 })).toThrow();
    expect(() => assertBattlegroundCharacter(plan, { gameEdition: "retail", level: 90 })).not.toThrow();
  });
});

it("creates an atomic one-off private plan with no roster, job, award or recurring schedule", async () => {
  const tx = { guild: { findUniqueOrThrow: vi.fn(async () => ({ gameEdition: "retail" })) },
    activityCore: { create: vi.fn(async () => ({ id: "core" })) },
    activitySession: { create: vi.fn(async () => ({ id: "session" })) } };
  const db = { $transaction: vi.fn(async (fn: (value: typeof tx) => unknown) => fn(tx)) } as unknown as PrismaClient;
  const input = { plan, name: "Blitz duo", channelId: "private", startsAt: new Date("2026-10-31T12:00:00Z"), tanks: 0, healers: 1, dps: 1, durationMinutes: 120 };
  await createBattleground(db, "guild", input, new Date("2026-10-30T12:00:00Z"));
  expect(tx.activityCore.create).toHaveBeenCalledWith({ data: expect.objectContaining({ battlegroundPlan: plan, weeklySchedule: null }) });
  expect(tx.activitySession.create).toHaveBeenCalledWith({ data: expect.objectContaining({ coreId: "core", openRecruitment: true, endsAt: new Date("2026-10-31T14:00:00Z") }) });
  tx.guild.findUniqueOrThrow.mockResolvedValue({ gameEdition: "forever" });
  await expect(createBattleground(db, "guild", input, new Date("2026-10-30T12:00:00Z"))).rejects.toThrow(/edition/);
  expect(tx.activityCore.create).toHaveBeenCalledTimes(1);
});
