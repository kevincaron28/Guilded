import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatInputCommandInteraction } from "discord.js";
const mocks = vi.hoisted(() => ({
  officer: true, allows: true,
  guild: { findUnique: vi.fn() }, raid: { findFirst: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
  guildSettings: { update: vi.fn() }
}));
vi.mock("../src/database.js", () => ({ prisma: mocks }));
vi.mock("../src/hosted-pilot.js", () => ({ hostedPilot: { allows: () => mocks.allows } }));
vi.mock("../src/permissions.js", () => ({ hasPermission: () => mocks.officer }));
import { executePug } from "../src/commands/pug.js";
function interaction(values: Record<string, string | boolean> = {}) {
  return { guildId: "discord", guild: { id: "discord" }, member: {},
    options: { getSubcommand: () => "share", getString: (name: string) => values[name] ?? null, getBoolean: (name: string) => values[name] ?? true },
    deferReply: vi.fn(), editReply: vi.fn() } as unknown as ChatInputCommandInteraction;
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.officer = true; mocks.allows = true;
  mocks.guild.findUnique.mockResolvedValue({ id: "g", settings: { language: "en" } });
  mocks.raid.findFirst.mockResolvedValue({ id: "r", status: "PLANNED", scheduledAt: new Date(Date.now() + 86_400_000), isTest: false,
    signupChannelId: "c", signupMessageId: "m", tankLimit: 2, healerLimit: 3, dpsLimit: 5 });
});
describe("sharing raids", () => {
  it("refuses members and unapproved servers before reading or changing data", async () => {
    mocks.officer = false;
    await expect(executePug(interaction())).rejects.toThrow("Only officers");
    expect(mocks.guild.findUnique).not.toHaveBeenCalled();
    mocks.officer = true; mocks.allows = false;
    await expect(executePug(interaction())).rejects.toThrow("approved");
    expect(mocks.raid.updateMany).not.toHaveBeenCalled();
  });
  it("scopes a share to the caller's guild and only the selected occurrence", async () => {
    await executePug(interaction({ raid: "r", open: true, realm: "Forever", faction: "HORDE", language: "fr", invite: "https://discord.gg/host" }));
    expect(mocks.raid.findFirst).toHaveBeenCalledWith({ where: { id: "r", guildId: "g" } });
    expect(mocks.raid.updateMany).toHaveBeenCalledWith({ where: { id: "r", guildId: "g" }, data: {
      publicPug: true, pugRealm: "Forever", pugFaction: "HORDE", pugLanguage: "fr", pugInviteUrl: "https://discord.gg/host"
    } });
  });
  it("requires public contact metadata, a signup post, and explicit capacity", async () => {
    await expect(executePug(interaction({ raid: "r" }))).rejects.toThrow("Provide realm");
    mocks.raid.findFirst.mockResolvedValueOnce({ status: "PLANNED", scheduledAt: new Date(Date.now() + 86_400_000), signupMessageId: null });
    await expect(executePug(interaction({ raid: "r" }))).rejects.toThrow("signup first");
    mocks.raid.findFirst.mockResolvedValueOnce({ status: "ACTIVE" });
    await expect(executePug(interaction({ raid: "r" }))).rejects.toThrow("upcoming");
    expect(mocks.raid.updateMany).not.toHaveBeenCalled();
  });
  it("can withdraw a raid even after its invite expired or the raid ended", async () => {
    mocks.raid.findFirst.mockResolvedValue({ status: "COMPLETED" });
    await executePug(interaction({ raid: "r", open: false }));
    expect(mocks.raid.updateMany).toHaveBeenCalledWith({ where: { id: "r", guildId: "g" }, data: { publicPug: false } });
  });
});
