/* eslint-disable @typescript-eslint/no-explicit-any -- small fakes of Discord interactions */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Commands restructure (November 2026): /leaderboard, /character link, and the "moved" answers.
const mocks = vi.hoisted(() => ({
  language: "en" as string,
  dungeon: vi.fn(async () => undefined),
  community: vi.fn(async () => undefined),
  epgp: vi.fn(async () => undefined),
  bg: vi.fn(async () => undefined),
  wow: vi.fn(async () => undefined),
  help: vi.fn(async () => ({ embeds: ["how to link"] })),
  importCharacter: vi.fn(async () => ({ action: "created", name: "Ray Stone", isMain: true })),
  applySelfExport: vi.fn(async () => ({ action: "updated", name: "Ray Stone", isMain: false, status: "OK", attunements: 0 }))
}));
vi.mock("../companion/active-games.mjs", async (original) => (await import("./helpers/focus-switches.js")).poeTrackingOn(await original()));
vi.mock("../src/database.js", () => ({ prisma: {} }));
vi.mock("../src/commands/context.js", () => ({
  requireGuildContext: async () => ({ guildId: "g1", memberId: "m1" }),
  guildService: { ensureGuild: async () => ({ id: "g1" }), getSettings: async () => ({ language: mocks.language }) }
}));
vi.mock("../src/commands/dungeon.js", async (original) => ({ ...await original<object>(), executeDungeon: mocks.dungeon }));
vi.mock("../src/commands/community.js", async (original) => ({ ...await original<object>(), executeCommunity: mocks.community }));
vi.mock("../src/commands/epgp.js", async (original) => ({ ...await original<object>(), executeEpgp: mocks.epgp }));
vi.mock("../src/commands/battleground.js", async (original) => ({ ...await original<object>(), executeBattleground: mocks.bg }));
vi.mock("../src/commands/wow.js", async (original) => ({ ...await original<object>(), executeWow: mocks.wow }));
vi.mock("../src/services/character-link-prompt.js", async (original) => ({ ...await original<object>(), characterLinkHelp: mocks.help }));
vi.mock("../src/services/character-import.js", async (original) => ({ ...await original<object>(), importCharacter: mocks.importCharacter }));
vi.mock("../src/services/self-export.js", async (original) => ({ ...await original<object>(), applySelfExport: mocks.applySelfExport,
  parseSelfExport: () => ({ findings: [], consumables: [] }) }));

import { commands } from "../src/commands/index.js";
import { executeLeaderboard, leaderboardBoard, leaderboardCommand } from "../src/commands/leaderboard.js";
import { executeCharacterLink } from "../src/commands/character.js";
import { RETIRED_COMMANDS, retiredHandler } from "../src/commands/moved.js";
import { serverWideCommand } from "../src/services/interaction-gate.js";

type Option = { name: string; description: string; type: number; options?: Option[] };

function slash(commandName: string, sub: string | null, strings: Record<string, string | null> = {}, group: string | null = null) {
  const replies: any[] = [];
  const value: any = {
    commandName, guildId: "123", guild: { name: "Quebec Gold" }, member: {}, user: { id: "u1" }, locale: "en-US", deferred: false, replied: false,
    options: {
      getSubcommand: (required = true) => { if (sub === null && required) throw new Error("none"); return sub; },
      getSubcommandGroup: () => group,
      getString: (name: string) => strings[name] ?? null,
      getBoolean: () => null
    },
    reply: vi.fn(async (r: any) => { replies.push(r); value.replied = true; }),
    followUp: vi.fn(async (r: any) => { replies.push(r); }),
    deferReply: vi.fn(async () => { value.deferred = true; }),
    editReply: vi.fn(async (r: any) => { replies.push(r); })
  };
  return { value, replies };
}

describe("/leaderboard", () => {
  beforeEach(() => { for (const fn of [mocks.dungeon, mocks.community, mocks.epgp, mocks.bg]) fn.mockClear(); });

  it("is one top-level command with a board choice and a French name", () => {
    const json = leaderboardCommand.toJSON() as any;
    expect(json.name_localizations.fr).toBe("classement");
    expect(json.options[0].choices.map((c: { value: string }) => c.value)).toEqual(["dungeon", "guild", "pvp", "community", "epgp"]);
    expect(commands.map((command) => command.name)).toContain("leaderboard");
  });

  it.each([
    [null, mocks.dungeon, "dungeon", "leaderboard"],
    ["dungeon", mocks.dungeon, "dungeon", "leaderboard"],
    ["guild", mocks.dungeon, "dungeon", "records"],
    ["pvp", mocks.bg, "bg", "duels"],
    ["community", mocks.community, "community", "leaderboard"],
    ["epgp", mocks.epgp, "epgp", "leaderboard"]
  ] as const)("board %s goes to the existing handler", async (board, handler, legacy, sub) => {
    const { value } = slash("leaderboard", null, { board });
    await executeLeaderboard(value);
    expect(handler).toHaveBeenCalledTimes(1);
    const seen = (handler.mock.calls[0] as unknown as [any])[0];
    expect(seen.commandName).toBe(legacy);
    expect(seen.options.getSubcommand()).toBe(sub);
  });

  it("falls back to the dungeon board for an unknown value", () => {
    expect(leaderboardBoard("nope")).toBe("dungeon");
  });

  it("community points run per Discord server, the other boards per in-game guild", () => {
    expect(serverWideCommand(commands, { commandName: "leaderboard", options: slash("leaderboard", null, { board: "community" }).value.options })).toBe(true);
    expect(serverWideCommand(commands, { commandName: "leaderboard", options: slash("leaderboard", null, { board: "dungeon" }).value.options })).toBe(false);
    expect(serverWideCommand(commands, { commandName: "character", options: slash("character", "guild").value.options })).toBe(true);
    expect(serverWideCommand(commands, { commandName: "setup", options: slash("setup", "add", {}, "guild").value.options })).toBe(true);
    expect(serverWideCommand(commands, { commandName: "organize", options: slash("organize", "create", {}, "poll").value.options })).toBe(false);
    expect(serverWideCommand(commands, { commandName: "organize", options: slash("organize", "start-season").value.options })).toBe(true);
  });
});

describe("/character link", () => {
  beforeEach(() => { mocks.help.mockClear(); mocks.importCharacter.mockClear(); mocks.applySelfExport.mockClear(); mocks.wow.mockClear(); });

  it("without a value explains the simple ways and shows the member's own characters (no pick-list)", async () => {
    const { value, replies } = slash("character", "link");
    await executeCharacterLink(value);
    expect(mocks.help).toHaveBeenCalledWith({}, "g1", "m1", "123", "en");
    expect(replies.at(-1)).toEqual({ embeds: ["how to link"] });
    expect(mocks.importCharacter).not.toHaveBeenCalled();
    // The link subcommand has no option that lists unclaimed or reported characters.
    const link = (commands.find((command) => command.name === "character")!.toJSON() as unknown as Option).options!.find((option) => option.name === "link")!;
    expect(link.options!.map((option) => option.name)).toEqual(["line_or_code", "main"]);
  });

  it("with an addon line links like /character import did", async () => {
    const { value, replies } = slash("character", "link", { line_or_code: "QG1|Bob|WoW-Forever|MAGE|Human|60|Frost|Tailoring:300" });
    await executeCharacterLink(value);
    expect(mocks.importCharacter).toHaveBeenCalledTimes(1);
    expect(replies.at(-1).content).toContain("Ray Stone");
    expect(replies.at(-1).content).toContain("Tailoring 300");
    expect(mocks.help).not.toHaveBeenCalled();
  });

  it("with a /guilded share code applies the self-export", async () => {
    const { value, replies } = slash("character", "link", { line_or_code: "QGEXP1:abc" });
    await executeCharacterLink(value);
    expect(mocks.applySelfExport).toHaveBeenCalledTimes(1);
    expect(replies.at(-1).content).toContain("Ray Stone");
  });

  it("/character guild lists the in-game guilds, or picks one", async () => {
    await executeCharacterLink(slash("character", "guild").value);
    await executeCharacterLink(slash("character", "guild", { guild: "abc" }).value);
    const seen = mocks.wow.mock.calls.map((call) => (call as unknown as [any])[0].options.getSubcommand());
    expect(seen).toEqual(["list", "use"]);
  });
});

describe("moved answers", () => {
  it("retired top-level commands answer where they went", async () => {
    expect(Object.keys(RETIRED_COMMANDS).sort()).toEqual(["delete-my-data", "import", "poll", "wow"]);
    for (const name of Object.keys(RETIRED_COMMANDS)) {
      expect(commands.map((command) => command.name)).not.toContain(name);
      const { value, replies } = slash(name, null);
      await retiredHandler(name)(value);
      expect(replies[0].content).toContain("moved");
    }
    const { value, replies } = slash("wow", null);
    await retiredHandler("wow")(value);
    expect(replies[0].content).toContain("`/character guild` or `/setup guild`");
  });
});

describe("the member commands", () => {
  it("members see fewer top-level commands than before the restructure (29)", () => {
    const hidden = commands.filter((command) => (command.toJSON() as { default_member_permissions?: string }).default_member_permissions);
    expect(commands.length).toBeLessThan(29);
    expect(commands.length - hidden.length).toBeLessThan(21);
    for (const name of ["help", "character", "promotion", "craft", "leaderboard", "raid", "report"]) expect(commands.map((command) => command.name)).toContain(name);
  });
});
