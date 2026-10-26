import { describe, expect, it, vi } from "vitest";
import { withTransactionMock } from "./helpers/transaction.js";
import { createRaidService as createService, SignupsClosedError } from "../src/services/raid.js";
import { buildSignupEmbed } from "../src/services/signup-embed.js";

const createRaidService = (database: Parameters<typeof createService>[0]) => createService(withTransactionMock(database));
const HOUR = 3_600_000;

describe("signup deadline", () => {
  it("stores the deadline the chosen hours before the start, and refuses impossible ones", async () => {
    const start = new Date(Date.now() + 48 * HOUR);
    const create = vi.fn(async ({ data }) => data);
    const service = createRaidService({ raid: { create } } as never);
    await service.create({ guildId: "g", title: "Molten Core", scheduledAt: start, createdBy: "o", signupsCloseHours: 12 });
    expect(create.mock.calls[0]![0].data.signupsCloseAt).toEqual(new Date(start.getTime() - 12 * HOUR));
    await expect(service.create({ guildId: "g", title: "Molten Core", scheduledAt: start, createdBy: "o", signupsCloseHours: 72 }))
      .rejects.toThrow(/already past/);
    await expect(service.create({ guildId: "g", title: "Molten Core", scheduledAt: start, createdBy: "o", signupsCloseHours: 0 }))
      .rejects.toThrow(/1 to 168 hours/);
  });

  it("refuses a member's own signup after the deadline, but not imports or calendar sync", async () => {
    const raid = { id: "r", guildId: "g", status: "PLANNED", tankLimit: null, healerLimit: null, dpsLimit: null, signupsCloseAt: new Date(Date.now() - 60_000) };
    const upsert = vi.fn(async ({ create }) => create);
    const service = createRaidService({ raid: { findFirst: vi.fn().mockResolvedValue(raid) }, raidSignup: { findUnique: vi.fn().mockResolvedValue(null), upsert } } as never);
    const closed = await service.signup("r", "g", "m", "DPS", "AVAILABLE", null, true).catch((error: unknown) => error);
    expect(closed).toBeInstanceOf(SignupsClosedError);
    expect((closed as SignupsClosedError).closedAt).toEqual(raid.signupsCloseAt);
    expect(upsert).not.toHaveBeenCalled();
    await expect(service.signup("r", "g", "m", "DPS")).resolves.toMatchObject({ status: "SIGNED_UP" });
  });

  it("removes the deadline with 0 and keeps it the same hours before a moved start", async () => {
    const start = new Date(Date.now() + 48 * HOUR);
    const raid = { id: "r", guildId: "g", status: "PLANNED", scheduledAt: start, signupsCloseAt: new Date(start.getTime() - 6 * HOUR) };
    const update = vi.fn(async ({ data }) => ({ ...raid, ...data }));
    const database = { raid: { findFirst: vi.fn().mockResolvedValue(raid), findUnique: vi.fn().mockResolvedValue(null), update } } as never;
    await createRaidService(database).edit("r", "g", { signupsCloseHours: 0 });
    expect(update.mock.calls[0]![0].data.signupsCloseAt).toBeNull();
    const moved = new Date(start.getTime() + 24 * HOUR);
    await createRaidService(database).edit("r", "g", { scheduledAt: moved });
    expect(update.mock.calls[1]![0].data.signupsCloseAt).toEqual(new Date(moved.getTime() - 6 * HOUR));
    await createRaidService(database).edit("r", "g", { title: "Blackwing Lair" });
    expect(update.mock.calls[2]![0].data).not.toHaveProperty("signupsCloseAt");
  });

  it("carries the deadline to next week's raid", async () => {
    const start = new Date(Date.now() - HOUR);
    const raid = { id: "r", guildId: "g", title: "Onyxia", scheduledAt: start, signupsCloseAt: new Date(start.getTime() - 2 * HOUR), repeatWeekly: true, isTest: false, weeklyOccurrence: null, createdBy: "o", description: null, tankLimit: 2, healerLimit: 8, dpsLimit: 30, coreId: null, bosses: [] };
    const create = vi.fn(async ({ data }) => data);
    const service = createRaidService({ raid: { findFirst: vi.fn().mockResolvedValueOnce(raid).mockResolvedValueOnce(null), create } } as never);
    const next = await service.createNextRepeat("r", "g");
    expect(next?.signupsCloseAt).toEqual(new Date(start.getTime() + 7 * 24 * HOUR - 2 * HOUR));
  });
});

describe("Late button", () => {
  it("toggles the member's own late flag, and needs a signup first", async () => {
    const raid = { id: "r", guildId: "g", status: "PLANNED" };
    const update = vi.fn(async ({ data }) => ({ id: "s", ...data }));
    const findUnique = vi.fn().mockResolvedValueOnce({ id: "s", status: "SIGNED_UP", late: false }).mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "s", status: "CANCELLED", late: false });
    const service = createRaidService({ raid: { findFirst: vi.fn().mockResolvedValue(raid) }, raidSignup: { findUnique, update } } as never);
    await expect(service.toggleLate("r", "g", "m")).resolves.toMatchObject({ late: true });
    await expect(service.toggleLate("r", "g", "m")).resolves.toBeNull();
    await expect(service.toggleLate("r", "g", "m")).resolves.toBeNull();
  });

  it("clears late when the member cancels", async () => {
    const raid = { id: "r", guildId: "g", status: "PLANNED" };
    const update = vi.fn(async ({ data }) => data);
    const service = createRaidService({ raid: { findFirst: vi.fn().mockResolvedValue(raid) }, raidSignup: { findUnique: vi.fn().mockResolvedValue({ id: "s", status: "MAYBE", late: true }), update } } as never);
    await service.cancelSignup("r", "g", "m");
    expect(update.mock.calls[0]![0].data).toMatchObject({ status: "CANCELLED", late: false });
  });
});

describe("signup post", () => {
  const raid = { id: "r", title: "Molten Core", description: null, status: "PLANNED" as const, scheduledAt: new Date("2026-11-10T01:00:00Z"), tankLimit: 2, healerLimit: 2, dpsLimit: 6 };
  const signups = [
    { memberId: "a", displayName: "Alpha", role: "TANK" as const, status: "SIGNED_UP", late: true },
    { memberId: "b", displayName: "Bravo", role: "DPS" as const, status: "SIGNED_UP" }
  ];
  it("marks late players with ⏰ and explains it, in both languages", () => {
    const en = buildSignupEmbed({ lang: "en", raid, signups }).data;
    expect(en.fields!.find((field) => field.name.includes("Tank"))!.value).toContain("Alpha ⏰");
    expect(en.fields!.find((field) => field.name.includes("DPS"))!.value).not.toContain("⏰");
    expect(en.footer!.text).toContain("⏰ arriving late");
    expect(buildSignupEmbed({ lang: "fr", raid, signups }).data.footer!.text).toContain("⏰ arrivera en retard");
    expect(buildSignupEmbed({ lang: "en", raid, signups: [signups[1]!] }).data.footer!.text).not.toContain("⏰");
  });
  it("shows the deadline as a live Discord countdown while the raid is planned", () => {
    const closes = new Date("2026-11-09T19:00:00Z");
    const field = buildSignupEmbed({ lang: "en", raid: { ...raid, signupsCloseAt: closes }, signups }).data.fields!.find((row) => row.name === "Signups close");
    expect(field?.value).toBe(`<t:${closes.getTime() / 1000}:R>`);
    expect(buildSignupEmbed({ lang: "en", raid: { ...raid, status: "COMPLETED", signupsCloseAt: closes }, signups }).data.fields!.some((row) => row.name === "Signups close")).toBe(false);
  });
});
