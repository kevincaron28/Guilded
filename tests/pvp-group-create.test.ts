/* eslint-disable @typescript-eslint/no-explicit-any -- Partial Discord fixtures. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const count = vi.fn(async () => 0), create = vi.fn(async ({ data }: any) => ({ id: "grp", ...data }));
vi.mock("../src/database.js", () => ({ prisma: { dungeonGroup: { count, create } } }));
const postGroup = vi.fn(async () => undefined);
vi.mock("../src/commands/dungeon-group.js", () => ({ postGroup }));
const settings = { language: "en", bgGroupsChannelId: "pvpchan" as string | null, dungeonSignupChannelId: null as string | null, unifiedGroupFinder: true };
vi.mock("../src/commands/context.js", () => ({ guildService: {
  ensureGuild: vi.fn(async () => ({ id: "scope" })), getSettings: vi.fn(async () => settings), ensureMember: vi.fn(async () => ({ id: "member1" })) } }));
vi.mock("../src/services/dungeon-group.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/services/dungeon-group.js")>();
  return { ...real, createDungeonGroupService: () => ({ create: (input: any) => create({ data: { ...input, maxSize: real.groupSize(input.kind, input.size) } }) }) };
});
const { createPvpGroupFromModal, pvpGroupModal } = await import("../src/commands/pvp-group.js");

const modal = (fields: Record<string, string>, channel: any = { id: "pvpchan", isTextBased: () => true, send: vi.fn() }) => {
  const interaction: any = { guild: { id: "d1", name: "QG", channels: { fetch: vi.fn(async () => channel) } }, user: { id: "u1", username: "aria" }, member: null,
    deferReply: vi.fn(), editReply: vi.fn(), fields: { getTextInputValue: (id: string) => fields[id] ?? "" } };
  return interaction;
};

describe("creating a PvP group from the form", () => {
  beforeEach(() => { vi.clearAllMocks(); count.mockResolvedValue(0); settings.bgGroupsChannelId = "pvpchan"; settings.dungeonSignupChannelId = null; settings.unifiedGroupFinder = true; });

  it("opens one form with what/when, size and levels, in both languages", () => {
    for (const fr of [false, true]) {
      const json = pvpGroupModal(fr, "scope").toJSON();
      expect(json.custom_id).toBe("bgui:scope:pvp-form");
      expect(json.components.map((row: any) => row.components[0].custom_id)).toEqual(["title", "size", "levels"]);
    }
  });
  it("posts one finder post in the pvp-groups channel as a PVP group the leader owns", async () => {
    const i = modal({ title: "WSG 9pm", size: "12", levels: "60" });
    await createPvpGroupFromModal(i);
    expect(create.mock.calls[0]![0].data).toMatchObject({ kind: "PVP", maxSize: 12, minLevel: 60, maxLevel: 60, leaderId: "member1", channelId: "pvpchan" });
    expect(postGroup).toHaveBeenCalledTimes(1);
    expect(i.editReply.mock.calls[0][0].content).toContain("<#pvpchan>");
  });
  it("posts in the group finder channel when one exists (the merged finder), and in pvp-groups when the merge is off", async () => {
    settings.dungeonSignupChannelId = "finder";
    const i = modal({ title: "WSG 9pm" }, { id: "finder", isTextBased: () => true, send: vi.fn() });
    await createPvpGroupFromModal(i);
    expect(i.guild.channels.fetch).toHaveBeenCalledWith("finder");
    expect(create.mock.calls[0]![0].data).toMatchObject({ kind: "PVP", activity: "battleground", channelId: "finder" });
    settings.unifiedGroupFinder = false;
    const j = modal({ title: "WSG 9pm" });
    await createPvpGroupFromModal(j);
    expect(j.guild.channels.fetch).toHaveBeenCalledWith("pvpchan");
  });
  it("refuses when the groups channel does not exist yet, or the leader has too many open groups", async () => {
    settings.bgGroupsChannelId = null;
    await expect(createPvpGroupFromModal(modal({ title: "WSG 9pm" }, null))).rejects.toThrow("/setup");
    settings.bgGroupsChannelId = "pvpchan"; count.mockResolvedValue(2);
    await expect(createPvpGroupFromModal(modal({ title: "WSG 9pm" }))).rejects.toThrow("already have 2 open PvP groups");
    expect(postGroup).not.toHaveBeenCalled();
  });
});
