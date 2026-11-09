import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelType } from "discord.js";

const mocks = vi.hoisted(() => ({
  pug: vi.fn(), honors: vi.fn(), seasons: vi.fn(), cores: vi.fn()
}));
vi.mock("../src/database.js", () => ({
  prisma: {
    wowGuild: { count: async () => 0 },
    pugBoardGuild: { findUnique: mocks.pug },
    communityHonors: { findUnique: mocks.honors },
    communitySeason: { findMany: mocks.seasons },
    raidCore: { findMany: mocks.cores },
    member: { count: async () => 0 }, character: { count: async () => 0 }, raid: { count: async () => 0 },
    epgpTransaction: { count: async () => 0 }, lootAward: { count: async () => 0 }, addonImport: { count: async () => 0 }, dungeonRun: { count: async () => 0 }
  }
}));
import { gatherImpact } from "../src/commands/uninstall.js";

type Fake = { id: string; name: string; type: ChannelType; parentId: string | null };
function makeGuild(channels: Fake[]) {
  const cache = new Map(channels.map(channel => [channel.id, channel]));
  return {
    id: "discord", name: "Test",
    channels: { cache, fetch: async (id?: string) => { if (!id) return cache; const found = cache.get(id); if (!found) throw Object.assign(new Error("Unknown Channel"), { code: 10003 }); return found; } },
    roles: { fetch: async () => undefined, cache: new Map() }
  };
}
const text = (id: string, name: string, parentId: string | null = null): Fake => ({ id, name, type: ChannelType.GuildText, parentId });
const category = (id: string, name: string): Fake => ({ id, name, type: ChannelType.GuildCategory, parentId: null });
const settings = (extra: Record<string, unknown> = {}) => ({ welcomeRoleIds: [], applicantRoleId: null, memberRoleId: null, ...extra }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pug.mockResolvedValue(null); mocks.honors.mockResolvedValue(null); mocks.seasons.mockResolvedValue([]); mocks.cores.mockResolvedValue([]);
});

describe("uninstall preview covers every channel Guilded creates", () => {
  it("includes the community, PvP, race, PUG board and core attendance channels, and their empty categories", async () => {
    const guild = makeGuild([
      category("community", "Community"), text("act", "activities", "community"), text("chat", "community-chat", "community"),
      text("lb", "🏆・leaderboard", "community"), text("hof", "🏅・hall-of-fame", "community"), text("adm", "discord-admin", "community"),
      { id: "voice", name: "Community voice", type: ChannelType.GuildVoice, parentId: "community" },
      category("pvp", "⚔️ PvP · Test · Forever"), text("g", "pvp-groups", "pvp"), text("r", "pvp-results", "pvp"), text("bg", "bg-ladder", "pvp"), text("duel", "duel-ladder", "pvp"),
      text("race", "race-to-60"), text("pug", "pug-board"),
      category("core", "⚔️ test-core"), text("presence", "test-core-presences", "core")
    ]);
    mocks.cores.mockResolvedValue([{ name: "test-core", categoryId: "core", attendanceChannelId: "presence" }]);
    mocks.pug.mockResolvedValue({ channelId: "pug" });
    mocks.honors.mockResolvedValue({ channelId: "hof" });
    mocks.seasons.mockResolvedValue([{ channelId: "lb", announcementChannelId: "act" }]);
    const impact = await gatherImpact(guild as never, "g1", settings({
      bgCategoryId: "pvp", bgGroupsChannelId: "g", bgResultsChannelId: "r", bgStatsChannelId: "bg", duelBoardChannelId: "duel", raceBoardChannelId: "race", adminChannelId: "adm"
    }));
    const removed = impact.removableChannels.map(row => row.id).sort();
    expect(removed).toEqual(["act", "adm", "bg", "chat", "duel", "g", "hof", "lb", "presence", "pug", "r", "race", "voice"].sort());
    expect(impact.coreCategories.sort()).toEqual(["community", "core", "pvp"]);
    expect(impact.keptChannels).toEqual([]);
    expect(impact.roleNames).toEqual([]);
  });

  it("finds them by name when no id is stored, but never touches a renamed or unrelated channel", async () => {
    const guild = makeGuild([
      category("community", "Communauté"), text("mine", "chat-communauté", "community"), text("theirs", "memes", "community"),
      text("outside", "activities"), text("race", "course-au-60")
    ]);
    const impact = await gatherImpact(guild as never, "g1", settings());
    const removed = impact.removableChannels.map(row => row.id).sort();
    expect(removed).toEqual(["mine"]);
    expect(impact.coreCategories).toEqual(["community"]);
  });

  it("keeps a stored channel that was renamed instead of deleting it", async () => {
    const guild = makeGuild([text("race", "my-own-leveling-race")]);
    const impact = await gatherImpact(guild as never, "g1", settings({ raceBoardChannelId: "race" }));
    expect(impact.removableChannels).toEqual([]);
    expect(impact.keptChannels).toEqual(["<#race>"]);
  });

  it("ignores stored ids whose channels are already gone", async () => {
    const impact = await gatherImpact(makeGuild([]) as never, "g1", settings({ raceBoardChannelId: "gone", bgGroupsChannelId: "gone", answerChannelId: "gone" }));
    expect(impact.removableChannels).toEqual([]);
    expect(impact.keptChannels).toEqual([]);
  });
});
