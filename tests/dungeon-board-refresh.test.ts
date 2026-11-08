import { beforeEach, describe, expect, it, vi } from "vitest";
import { EmbedBuilder } from "discord.js";

const { settingsRow, updateSettings } = vi.hoisted(() => ({ settingsRow: { current: null as Record<string, unknown> | null }, updateSettings: vi.fn() }));
vi.mock("../src/database.js", () => ({ prisma: {
  $transaction: async (fn: (tx: unknown) => unknown) => fn({ $executeRaw: async () => 0 }),
  dungeonSeason: { findMany: async () => [{ id: "s1", name: "Season 1", status: "ACTIVE", startsAt: new Date("2026-11-04T23:00:00Z") }] }, discordJob: {}
} }));
vi.mock("../src/services/guild.js", () => ({ createGuildService: () => ({
  ensureGuild: async () => ({ id: "g1" }), getSettings: async () => settingsRow.current, updateSettings
}) }));
vi.mock("../src/services/dungeon-stats.js", () => ({ leaderboard: async () => [], formatLeaderboard: () => "rows" }));
vi.mock("../src/services/dungeon-import.js", () => ({ activeSeason: async () => ({ id: "s1", name: "Season 1", startsAt: new Date("2026-11-04T23:00:00Z"), ratingRules: null }) }));
vi.mock("../src/services/season-archive.js", () => ({ seasonRows: async () => [] }));
vi.mock("../src/services/dungeon-best-runs.js", () => ({ seasonBestRuns: async () => [], bestRunsEmbed: () => new EmbedBuilder().setTitle("Best runs").setDescription("x") }));
vi.mock("../src/services/dungeon-rating.js", () => ({ dungeonRating: async () => [], hasDungeonRating: () => false, ratingEmbed: () => new EmbedBuilder() }));
vi.mock("../src/services/discord-jobs.js", () => ({ deliverDiscordJob: async () => true, dispatchDiscordJob: async () => undefined, enqueueDiscordJob: async () => ({ id: "j" }) }));
import { seasonHeader, updateDungeonLeaderboard } from "../src/services/dungeon-leaderboard.js";

const bot = { id: "bot" };
const old = (id: string, title: string, over: Record<string, unknown> = {}) => ({ id, author: bot, embeds: [{ title, fields: [] }], deletable: true, editable: true, delete: vi.fn(async () => undefined), ...over });
function fixture(messages: ReturnType<typeof old>[], savedId: string | null) {
  settingsRow.current = { dungeonLeaderboardChannelId: "c1", dungeonLeaderboardMessageId: savedId, language: "fr" };
  const byId = new Map(messages.map(m => [m.id, m]));
  const channel = {
    isTextBased: () => true, send: vi.fn(async () => ({ id: "fresh" })),
    messages: { fetch: vi.fn(async (arg: unknown) => {
      if (typeof arg === "string") { const found = byId.get(arg); if (!found) throw new Error("gone"); return found; }
      return new Map(messages.map(m => [m.id, m]));
    }) }
  };
  return { channel, guild: { id: "d1", name: "QG", client: { user: bot }, channels: { fetch: async () => channel } } as never };
}

describe("dungeon leaderboard panel", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("names the current season at the top", () => {
    expect(seasonHeader({ name: "Season 1", startsAt: new Date("2026-11-04T23:00:00Z") }, "fr")).toBe("📅 Saison en cours : **Saison 1** · depuis le <t:1793833200:D>");
    expect(seasonHeader({ name: "Season 2", startsAt: new Date("2027-02-03T23:00:00Z") }, "en")).toContain("Current season: **Season 2**");
  });

  it("edits the saved board in place and deletes the bot's outdated panels (beta guide, old rating)", async () => {
    const edit = vi.fn(async () => ({ id: "board" }));
    const board = old("board", "🏅 Exploration · Season 1", { edit });
    const guide = old("guide", "Bêta Best 8 · comment les points fonctionnent");
    const stranger = old("human", "Exploration notes", { author: { id: "someone" } });
    const unrelated = old("welcome", "Bienvenue");
    const f = fixture([board, guide, stranger, unrelated], "board");
    expect(await updateDungeonLeaderboard(f.guild, true)).toBe(true);
    expect(edit).toHaveBeenCalledTimes(1);
    const payload = (edit.mock.calls[0] as unknown as [{ embeds: EmbedBuilder[] }])[0];
    expect(payload.embeds.map(e => e.toJSON().description).join("\n")).toContain("Saison en cours : **Saison 1**");
    expect(f.channel.send).not.toHaveBeenCalled();
    expect(guide.delete).toHaveBeenCalledTimes(1);
    expect(stranger.delete).not.toHaveBeenCalled();
    expect(unrelated.delete).not.toHaveBeenCalled();
    expect(board.delete).not.toHaveBeenCalled();
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("when the saved message is gone it edits the newest old panel instead of posting a duplicate", async () => {
    const edit = vi.fn(async () => ({ id: "p1" }));
    const p1 = old("p1", "🏅 Exploration · Season 1 · provisoire", { edit });
    const p2 = old("p2", "Bêta Best 8 · comment les points fonctionnent");
    const f = fixture([p1, p2], "deleted");
    expect(await updateDungeonLeaderboard(f.guild, true)).toBe(true);
    expect(edit).toHaveBeenCalledTimes(1);
    expect(f.channel.send).not.toHaveBeenCalled();
    expect(updateSettings).toHaveBeenCalledWith("g1", { dungeonLeaderboardMessageId: "p1" });
    expect(p2.delete).toHaveBeenCalledTimes(1);
  });

  it("posts a fresh board only when the channel holds no bot panel at all", async () => {
    const f = fixture([old("welcome", "Bienvenue")], null);
    expect(await updateDungeonLeaderboard(f.guild, true)).toBe(true);
    expect(f.channel.send).toHaveBeenCalledTimes(1);
    expect(updateSettings).toHaveBeenCalledWith("g1", { dungeonLeaderboardMessageId: "fresh" });
  });
});
