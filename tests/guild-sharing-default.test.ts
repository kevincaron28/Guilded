import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGuildService } from "../src/services/guild.js";
import { publicSharingNotice } from "../src/services/setup-status.js";

const pilot = vi.hoisted(() => ({ tier: vi.fn(() => "approved") }));
vi.mock("../src/hosted-pilot.js", () => ({ hostedPilot: pilot }));
beforeEach(() => pilot.tier.mockReturnValue("approved"));
afterEach(() => vi.useRealTimers());

describe("new-guild sharing default", () => {
  it("keeps Lite admission records private and refuses blocked servers", async () => {
    const upsert = vi.fn();
    const service = createGuildService({ guild: { upsert } } as never);
    pilot.tier.mockReturnValue("lite");
    await service.ensureGuild("lite", "Lite");
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { discordId: "lite", name: "Lite", settings: { create: {} } } }));
    upsert.mockClear();
    pilot.tier.mockReturnValue("blocked");
    expect(() => service.ensureGuild("blocked", "Blocked")).toThrow();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("sets a cutoff only in the new Guild branch, preserving both existing choices and missing legacy settings", async () => {
    const now = new Date("2026-11-10T12:00:00Z");
    vi.useFakeTimers(); vi.setSystemTime(now);
    type Settings = { publicDungeonRuns: boolean; publicDungeonRunsSince: Date | null };
    const rows = new Map<string, { name: string; settings: Settings | null }>([
      ["private", { name: "Old private", settings: { publicDungeonRuns: false, publicDungeonRunsSince: null } }],
      ["public", { name: "Old public", settings: { publicDungeonRuns: true, publicDungeonRunsSince: null } }],
      ["missing", { name: "Legacy missing", settings: null }]
    ]);
    const upsert = vi.fn(async ({ where, create, update }) => {
      const old = rows.get(where.discordId_scopeKey.discordId);
      const row = old ? { ...old, ...update } : { name: create.name, settings: create.settings.create };
      rows.set(where.discordId_scopeKey.discordId, row); return row;
    });
    const service = createGuildService({ guild: { upsert } } as never);
    for (const id of ["private", "public", "missing", "new"]) await service.ensureGuild(id, "Renamed");
    expect(rows.get("private")?.settings).toEqual({ publicDungeonRuns: false, publicDungeonRunsSince: null });
    expect(rows.get("public")?.settings).toEqual({ publicDungeonRuns: true, publicDungeonRunsSince: null });
    expect(rows.get("missing")?.settings).toBeNull();
    expect(rows.get("new")?.settings).toEqual({ publicDungeonRuns: true, publicDungeonRunsSince: now });
    vi.setSystemTime(new Date("2026-11-11T12:00:00Z"));
    await service.ensureGuild("new", "Renamed again");
    expect(rows.get("new")?.settings?.publicDungeonRunsSince).toEqual(now);
  });

  it("treats missing flags as private and describes the unchanged legacy opt-in window accurately", () => {
    expect(publicSharingNotice({})).toContain("sharing: OFF");
    expect(publicSharingNotice({ publicDungeonRuns: false })).not.toContain("sharing: ON");
    expect(publicSharingNotice({ publicDungeonRuns: true, publicDungeonRunsSince: null })).toContain("last 30 days");
  });
});
