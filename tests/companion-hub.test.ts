import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCompanionHub, plainText } from "../src/services/companion-hub.js";
import type { ManageAccess } from "../src/services/companion-manage.js";

const db = vi.hoisted(() => ({
  guild: { findUniqueOrThrow: vi.fn(), findUnique: vi.fn() },
  guildSettings: { findUnique: vi.fn(), update: vi.fn() },
  member: { findMany: vi.fn() },
  reserveList: { findUnique: vi.fn() },
  itemReserve: { findMany: vi.fn() },
  raidCore: { findMany: vi.fn() }
}));
const baseline = vi.fn();
vi.mock("../src/database.js", () => ({ prisma: db }));
vi.mock("../src/config.js", () => ({ config: { COMPANION_API_PORT: 0, COMPANION_API_HOST: "127.0.0.1" } }));

const member: ManageAccess = { memberId: "m1", actorId: "discord-1", officer: false, raidLeader: false };
const officer: ManageAccess = { ...member, officer: true, raidLeader: true };
const hub = createCompanionHub(db as never, { baselineAchievements: baseline });
const settings = { guildId: "g1", language: "en", publicDungeonRuns: true, achievementAnnounceEnabled: false, achievementChannelId: null, raidReminderMinutes: 0, weeklyReportEnabled: false, autoApplyImports: false, welcomeDelivery: "CHANNEL", welcomeChannelId: null, coreLootOnly: false, lootMode: "EPGP" };

beforeEach(() => {
  vi.clearAllMocks();
  db.guild.findUniqueOrThrow.mockResolvedValue({ name: "Quebec Gold", gameEdition: "forever" });
  db.guild.findUnique.mockResolvedValue({ officerSyncAt: null });
  db.guildSettings.findUnique.mockResolvedValue(settings);
  db.guildSettings.update.mockResolvedValue(settings);
  db.raidCore.findMany.mockResolvedValue([]);
  db.reserveList.findUnique.mockResolvedValue(null);
  db.itemReserve.findMany.mockResolvedValue([]);
  db.member.findMany.mockResolvedValue([]);
});

describe("hub: my characters", () => {
  it("looks characters up by the proven Discord account and lists guild and core per character", async () => {
    db.member.findMany.mockResolvedValue([
      { guild: { id: "g2", name: "Other Guild", gameEdition: "forever" }, characters: [{ id: "c2", name: "Alt", displayName: null, realm: "R", className: "Mage", spec: null, level: 60, isMain: true, gameEdition: "forever", coreSpots: [], coreBackups: [] }] },
      { guild: { id: "g1", name: "Quebec Gold", gameEdition: "forever" }, characters: [{ id: "c1", name: "Thrall", displayName: "Thrall Stormrage", realm: "R", className: "Shaman", spec: "Enhancement", level: 60, isMain: true, gameEdition: "forever",
        coreSpots: [{ role: "DPS", bench: false, trial: false, core: { id: "k1", name: "Tuesday", lootMode: null } }],
        coreBackups: [{ role: "HEALER", spot: { bench: false, trial: false, core: { id: "k2", name: "Thursday", lootMode: "RESERVE" } } }] }] }
    ]);
    const view = await hub.view("g1", member, null);
    expect(db.member.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { discordUserId: "discord-1", status: "ACTIVE", isTest: false } }));
    expect(view.characters.map((c) => [c.name, c.guild.name, c.guild.current])).toEqual([["Thrall", "Quebec Gold", true], ["Alt", "Other Guild", false]]);
    expect(view.characters[0]!.cores.map((c) => [c.name, c.role, c.backup])).toEqual([["Tuesday", "DPS", false], ["Thursday", "HEALER", true]]);
  });
});

describe("hub: reserves are read-only", () => {
  it("shows the addon's list and marks the member's own reserves, and offers no write", async () => {
    db.member.findMany.mockResolvedValue([{ guild: { id: "g1", name: "Quebec Gold", gameEdition: "forever" }, characters: [{ id: "c1", name: "Thrall", displayName: null, realm: "R", className: "Shaman", spec: null, level: 60, isMain: true, gameEdition: "forever", coreSpots: [], coreBackups: [] }] }]);
    db.reserveList.findUnique.mockResolvedValue({ active: true, open: true, title: "MC", perPlayer: 2, keeper: "Boss", syncedAt: new Date("2026-11-03T10:00:00Z") });
    db.itemReserve.findMany.mockResolvedValue([
      { character: "Thrall", realm: "r", itemId: 1, itemName: "Sulfuras" }, { character: "Other", realm: "R", itemId: 1, itemName: "Sulfuras" }, { character: "Other", realm: "R", itemId: 2, itemName: "Eye" }
    ]);
    const { reserves } = await hub.view("g1", member, null);
    expect(reserves.writable).toBe(false);
    expect(reserves.mineCount).toBe(1);
    expect(reserves.items.find((i) => i.itemId === 1)).toMatchObject({ mine: true, characters: ["Thrall", "Other"] });
    expect(reserves.items.find((i) => i.itemId === 2)!.mine).toBe(false);
  });
});

describe("hub: server page permissions", () => {
  it("gives the setup section to officers only", async () => {
    expect((await hub.view("g1", member, [{ label: "x", ok: true, optional: false, fix: "" }])).server).toBeNull();
    const view = await hub.view("g1", officer, [{ label: "**Roles**", ok: false, optional: false, fix: "Run `/setup` <#123> since <t:1700000000:R>" }]);
    expect(view.server?.checks).toEqual([{ label: "Roles", ok: false, optional: false, fix: "Run /setup a channel since 2023-11-14" }]);
    expect(view.server?.settings).toMatchObject({ language: "en", publicSharing: true, achievementAnnounce: false });
  });

  it("refuses every server change to a member, including a raid leader without the officer role", async () => {
    for (const who of [member, { ...member, raidLeader: true }]) {
      await expect(hub.applyServer("g1", who, { action: "server.language", value: "fr" })).rejects.toMatchObject({ status: 403 });
      await expect(hub.applyServer("g1", who, { action: "server.achievements", on: true })).rejects.toMatchObject({ status: 403 });
    }
    expect(db.guildSettings.update).not.toHaveBeenCalled();
  });

  it("changes only the caller's own server, and only a known setting", async () => {
    await hub.applyServer("g1", officer, { action: "server.language", value: "fr" });
    expect(db.guildSettings.update).toHaveBeenCalledWith({ where: { guildId: "g1" }, data: { language: "fr" } });
    await expect(hub.applyServer("g1", officer, { action: "server.language", value: "de" })).rejects.toThrow();
    await expect(hub.applyServer("g1", officer, { action: "server.token", value: "x" })).rejects.toThrow();
    expect(db.guildSettings.update).toHaveBeenCalledTimes(1);
  });

  it("can turn public sharing off but has no way to turn it on", async () => {
    await hub.applyServer("g1", officer, { action: "server.publicSharing.off" });
    expect(db.guildSettings.update).toHaveBeenCalledWith({ where: { guildId: "g1" }, data: { publicDungeonRuns: false } });
    await expect(hub.applyServer("g1", officer, { action: "server.publicSharing.on" })).rejects.toThrow();
  });

  it("needs a channel before achievement announcements, then marks earned ones as announced", async () => {
    await expect(hub.applyServer("g1", officer, { action: "server.achievements", on: true })).rejects.toMatchObject({ status: 409 });
    expect(db.guildSettings.update).not.toHaveBeenCalled();
    db.guildSettings.findUnique.mockResolvedValue({ ...settings, achievementChannelId: "chan" });
    await hub.applyServer("g1", officer, { action: "server.achievements", on: true });
    expect(baseline).toHaveBeenCalledWith("g1");
    expect(db.guildSettings.update).toHaveBeenCalledWith({ where: { guildId: "g1" }, data: { achievementAnnounceEnabled: true } });
    await hub.applyServer("g1", officer, { action: "server.achievements", on: false });
    expect(baseline).toHaveBeenCalledTimes(1);
  });

  it("strips Discord markup from the checklist", () => {
    expect(plainText("**Bold** `/cmd` <@&1>")).toBe("Bold /cmd someone");
  });
});
