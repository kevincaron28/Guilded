import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageFlags } from "discord.js";

// Live 26 Oct 2026: /setup testraid start and finish wrote their data but showed
// "The application did not respond", because they replied only after the slow work.
const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  db: { character: { findFirst: vi.fn() }, raid: { findMany: vi.fn() } },
  context: vi.fn(), officer: vi.fn(),
  start: vi.fn(), finish: vi.fn(), dungeon: vi.fn(), cleanup: vi.fn(),
  sync: vi.fn(), proposal: vi.fn()
}));
vi.mock("../src/database.js", () => ({ prisma: mocks.db }));
vi.mock("../src/permissions.js", () => ({ hasPermission: mocks.officer }));
vi.mock("../src/commands/context.js", () => ({ requireGuildContext: mocks.context }));
vi.mock("../src/commands/raid.js", () => ({ syncSignupEmbed: mocks.sync }));
vi.mock("../src/commands/ep-award.js", () => ({ showEpProposal: mocks.proposal }));
vi.mock("../src/services/simulation.js", () => ({
  SIM_CHARACTERS: ["Testalpha", "Testbravo", "Testcharlie"],
  startTestRaid: mocks.start, finishTestRaid: mocks.finish, simulateDungeonRun: mocks.dungeon, cleanupTestRaids: mocks.cleanup
}));

import { executeTestRaid } from "../src/commands/testraid.js";

function interaction(subcommand: string, options: Record<string, string | boolean | null> = {}) {
  const record = (name: string) => vi.fn(async () => { mocks.calls.push(name); });
  return {
    member: {}, guild: { id: "discord-guild" }, user: { id: "officer" },
    options: {
      getSubcommand: () => subcommand,
      getString: (name: string) => options[name] ?? null,
      getInteger: () => null, getNumber: () => null,
      getBoolean: (name: string) => options[name] ?? null
    },
    deferReply: record("deferReply"), editReply: record("editReply"), reply: record("reply")
  };
}
const run = (i: ReturnType<typeof interaction>) => executeTestRaid(i as never);
const raid = { id: "raid1", title: "[TEST] Simulated raid" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.calls.length = 0;
  mocks.context.mockResolvedValue({ guildId: "guild1", memberId: "member1" });
  mocks.officer.mockReturnValue(true);
  mocks.db.character.findFirst.mockResolvedValue({ realm: "WoW Forever" });
  mocks.db.raid.findMany.mockResolvedValue([]);
  mocks.start.mockImplementation(async () => { mocks.calls.push("start"); return { raid, members: 10, counts: { SIGNED_UP: 7, MAYBE: 2, WAITLISTED: 1 } }; });
  mocks.finish.mockImplementation(async () => { mocks.calls.push("finish"); return { raid, attending: 9, late: 0, noShow: 0, walkIn: 0, loot: [] }; });
  mocks.cleanup.mockImplementation(async () => { mocks.calls.push("cleanup"); return { raids: 1, dungeonRuns: 0, members: 10, auctions: 0, imports: 0 }; });
  mocks.sync.mockImplementation(async () => { mocks.calls.push("sync"); });
  mocks.proposal.mockImplementation(async () => { mocks.calls.push("proposal"); });
});

describe("/setup testraid acknowledges Discord before slow work", () => {
  it("defers start before creating fake raiders and posting the signup", async () => {
    const i = interaction("start");
    await run(i);
    expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(mocks.calls).toEqual(["deferReply", "start", "sync", "editReply"]);
    expect(i.reply).not.toHaveBeenCalled();
  });

  it("defers finish, and the EP proposal answers the deferred reply", async () => {
    const i = interaction("finish", { raid: "raid1" });
    await run(i);
    expect(mocks.calls).toEqual(["deferReply", "finish", "sync", "proposal"]);
    expect(i.reply).not.toHaveBeenCalled();
  });

  it("defers cleanup too", async () => {
    const i = interaction("cleanup");
    await run(i);
    expect(mocks.calls).toEqual(["deferReply", "cleanup", "editReply"]);
  });

  it("still refuses non-officers with a plain private reply, writing nothing", async () => {
    mocks.officer.mockReturnValue(false);
    const i = interaction("start");
    await run(i);
    expect(mocks.calls).toEqual(["reply"]);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("deletes only referenced bot posts and retains cleanup references on a permission or author failure", async () => {
    mocks.db.raid.findMany.mockResolvedValue([{ signupChannelId: "channel", signupMessageId: "message" }]);
    const remove = vi.fn(async () => { mocks.calls.push("deletePost"); });
    const fetchMessage = vi.fn().mockResolvedValue({ author: { id: "bot" }, delete: remove });
    const i = { ...interaction("cleanup"), client: { user: { id: "bot" } }, guild: {
      id: "discord-guild", channels: { fetch: vi.fn().mockResolvedValue({ isTextBased: () => true, messages: { fetch: fetchMessage } }) }
    } };
    await run(i);
    expect(mocks.db.raid.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { guildId: "guild1", isTest: true } }));
    expect(mocks.calls).toEqual(["deferReply", "deletePost", "cleanup", "editReply"]);
    mocks.cleanup.mockClear(); remove.mockClear();
    fetchMessage.mockResolvedValue({ author: { id: "human" }, delete: remove });
    await expect(run(i)).rejects.toThrow("author mismatch");
    expect(remove).not.toHaveBeenCalled(); expect(mocks.cleanup).not.toHaveBeenCalled();
    fetchMessage.mockRejectedValue({ code: 50013 });
    await expect(run(i)).rejects.toEqual({ code: 50013 });
    expect(mocks.cleanup).not.toHaveBeenCalled();
    fetchMessage.mockRejectedValue({ code: 10008 });
    await run(i);
    expect(mocks.cleanup).toHaveBeenCalledOnce();
  });
});
