import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  core: vi.fn(),
  settings: vi.fn()
}));
vi.mock("../src/database.js", () => ({ prisma: { raidCore: { findFirst: mocks.core } } }));
vi.mock("../src/services/guild.js", () => ({
  createGuildService: () => ({ ensureGuild: async () => ({ id: "g1" }), getSettings: mocks.settings })
}));
import { resolveNotifyAddress } from "../src/services/notify.js";

const discordGuild = { id: "discord", name: "Quebec Gold" } as never;

describe("raid attendance channel", () => {
  beforeEach(() => {
    mocks.core.mockReset();
    mocks.settings.mockResolvedValue({ language: "fr", logChannelId: "officer-log", attendanceChannelId: null });
  });

  it("posts a core raid's attendance in that core's officers-only channel", async () => {
    mocks.core.mockResolvedValue({ attendanceChannelId: "pulliticiens-presences" });
    expect(await resolveNotifyAddress(discordGuild, "attendance", "core-1")).toMatchObject({ channelId: "pulliticiens-presences", lang: "fr" });
    expect(mocks.core).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "core-1", guildId: "g1" } }));
  });

  it("falls back to the guild's attendance channel, then the officer log", async () => {
    mocks.core.mockResolvedValue({ attendanceChannelId: null });
    expect(await resolveNotifyAddress(discordGuild, "attendance", "core-1")).toMatchObject({ channelId: "officer-log" });
    mocks.settings.mockResolvedValue({ language: "fr", logChannelId: "officer-log", attendanceChannelId: "presences-raid" });
    expect(await resolveNotifyAddress(discordGuild, "attendance", null)).toMatchObject({ channelId: "presences-raid" });
    expect(mocks.core).toHaveBeenCalledTimes(1);
  });
});
