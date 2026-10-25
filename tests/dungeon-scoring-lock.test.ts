import { beforeEach, expect, it, vi } from "vitest";
import { MessageFlags } from "discord.js";

const { write, post, updateBoard } = vi.hoisted(() => ({ write: vi.fn(), post: vi.fn(), updateBoard: vi.fn() }));
vi.mock("../src/database.js", () => ({ prisma: {
  guildSettings: { upsert: write, update: write }, dungeonSeason: { update: write }, auditLog: { create: write }
} }));
vi.mock("../src/commands/context.js", () => ({ requireGuildContext: async () => ({ guildId: "g" }) }));
vi.mock("../src/permissions.js", () => ({ hasPermission: () => true }));
vi.mock("../src/services/housekeeping.js", () => ({ postToLogChannel: post }));
vi.mock("../src/services/dungeon-leaderboard.js", () => ({ updateDungeonLeaderboard: updateBoard }));
import { dungeonAdminCommand, executeDungeonAdmin } from "../src/commands/dungeon-admin.js";

beforeEach(() => vi.clearAllMocks());

it.each([
  ["target", "minutes", 25], ["config", "rule", "completion"], ["config", "points", 0],
  ["config", "weekly", "100,100"], ["config", "dungeon_master", 1], ["recalibrate", "minutes", 28]
])("rejects cached officer commands %s/%s without writing or notifying", async (subcommand, option, value) => {
  const interaction = { member: {}, user: { id: "officer" }, guild: {}, reply: vi.fn(),
    options: { getSubcommand: () => subcommand, get: (name: string) => name === option ? { name, value } : null } };
  await executeDungeonAdmin(interaction as never);
  expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
    content: expect.stringContaining("locked for all guilds"), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] }
  }));
  expect(write).not.toHaveBeenCalled();
  expect(post).not.toHaveBeenCalled();
  expect(updateBoard).not.toHaveBeenCalled();
});

it("registers read-only scoring controls and still displays the shared policy", async () => {
  const options = dungeonAdminCommand.toJSON().options!;
  expect(options.some(o => o.name === "target")).toBe(false);
  const config = options.find(o => o.name === "config")!;
  expect("options" in config ? config.options ?? [] : []).toEqual([]);
  const evidence = options.find(o => o.name === "recalibrate")!;
  expect("options" in evidence ? evidence.options?.map(o => o.name) : []).toEqual(["route"]);
  const interaction = { member: {}, user: { id: "officer" }, reply: vi.fn(),
    options: { getSubcommand: () => "config", get: () => null } };
  await executeDungeonAdmin(interaction as never);
  expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("`completion` 50") }));
  expect(write).not.toHaveBeenCalled();
  expect(post).not.toHaveBeenCalled();
});

it("creates a late-joining guild with the official frozen rules and season start", async () => {
  const { activeSeason } = await import("../src/services/dungeon-import.js");
  const { publicRules, snapshotRules } = await import("../src/services/public-score.js");
  const { createBracketedDungeonRules } = await import("../src/services/dungeon-november-rules.js");
  const shared = publicRules();
  const frozen = createBracketedDungeonRules({ routes: shared.routes.map(r => ({ ...r, targetSec: 1800 })), brackets: shared.brackets });
  const startsAt = new Date("2026-11-04T23:00:00Z");
  const db = { dungeonSeason: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() },
    officialSeason: { findFirst: vi.fn().mockResolvedValue({ name: "Season 1", startsAt, rules: snapshotRules(frozen, startsAt) }) } };
  await activeSeason(db as never, "new-guild", new Date("2026-12-01T00:00:00Z"));
  expect(db.dungeonSeason.create).toHaveBeenCalledWith({ data: { guildId: "new-guild", name: "Season 1", startsAt, ratingRules: frozen } });
  db.dungeonSeason.create.mockClear();
  db.officialSeason.findFirst.mockResolvedValue({ name: "Season 1", startsAt, rules: null });
  await expect(activeSeason(db as never, "new-guild")).rejects.toThrow(/must be frozen/);
  expect(db.dungeonSeason.create).not.toHaveBeenCalled();
});
