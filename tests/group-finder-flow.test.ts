/* eslint-disable @typescript-eslint/no-explicit-any -- Partial Discord fixtures. */
import { Collection } from "discord.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const count = vi.fn(async () => 0), create = vi.fn(async ({ data }: any) => ({ id: "grp", status: "OPEN", ...data })), update = vi.fn(async () => ({}));
vi.mock("../src/database.js", () => ({ prisma: { dungeonGroup: { count, create, update, findUniqueOrThrow: vi.fn(async () => ({ id: "grp", guildId: "scope", title: "Deadmines tonight", kind: "DUNGEON", maxSize: 5, status: "OPEN", minLevel: null, maxLevel: null, leaderId: "member1", voiceChannelId: null })) }, dungeonGroupSignup: { findMany: vi.fn(async () => []) }, member: { findUnique: vi.fn(async () => ({ discordUserId: "1" })) }, groupAlert: { findMany: vi.fn(async () => []) } } }));
const settings: any = { language: "en", dungeonSignupChannelId: "finder", bgGroupsChannelId: "pvpchan", unifiedGroupFinder: true };
vi.mock("../src/commands/context.js", () => ({ guildService: {
  ensureGuild: vi.fn(async () => ({ id: "scope" })), getSettings: vi.fn(async () => settings), ensureMember: vi.fn(async () => ({ id: "member1" })) }, requireGuildContext: vi.fn() }));
vi.mock("../src/services/pvp-group-post.js", () => ({ pvpPostPayload: vi.fn(async () => ({ embeds: [], files: [] })) }));
const { handleDungeonGuideButton, handleDungeonGuideSelect, handleDungeonGuideModal } = await import("../src/commands/dungeon-group.js");

const send = vi.fn(async () => ({ id: "msg" }));
const guildWith = () => ({ id: "d1", name: "QG", roles: { cache: new Collection() }, channels: { fetch: vi.fn(async (id: string) => ({ id, isTextBased: () => true, send })) } });

describe("the merged group finder's pinned flow", () => {
  beforeEach(() => { vi.clearAllMocks(); Object.assign(settings, { language: "en", dungeonSignupChannelId: "finder", bgGroupsChannelId: "pvpchan", unifiedGroupFinder: true }); count.mockResolvedValue(0); });

  it("asks the activity first: dungeon, battleground, arena or world PvP", async () => {
    const i: any = { customId: "dguide:create", guild: guildWith(), reply: vi.fn(), showModal: vi.fn() };
    await handleDungeonGuideButton(i);
    expect(i.showModal).not.toHaveBeenCalled();
    const menu = i.reply.mock.calls[0][0].components[0].toJSON().components[0];
    expect(menu.custom_id).toBe("dguide:kind");
    expect(menu.options.map((o: any) => o.value)).toEqual(["DUNGEON", "BATTLEGROUND", "ARENA", "WORLDPVP"]);
    expect(menu.options.map((o: any) => o.label)).toEqual(["Dungeon", "Battleground", "Arena", "World PvP"]);
  });

  it("is in French, and opens the dungeon form at once when the merge is off", async () => {
    settings.language = "fr";
    const fr: any = { customId: "dguide:create", guild: guildWith(), reply: vi.fn(), showModal: vi.fn() };
    await handleDungeonGuideButton(fr);
    expect(fr.reply.mock.calls[0][0].components[0].toJSON().components[0].options.map((o: any) => o.label)).toEqual(["Donjon", "Champ de bataille", "Arène", "JcJ en monde ouvert"]);
    settings.language = "en"; settings.unifiedGroupFinder = false;
    const off: any = { customId: "dguide:create", guild: guildWith(), reply: vi.fn(), showModal: vi.fn() };
    await handleDungeonGuideButton(off);
    expect(off.reply).not.toHaveBeenCalled();
    expect(off.showModal.mock.calls[0][0].toJSON().custom_id).toBe("dguide:create:DUNGEON");
  });

  it("opens the matching form: PvP activities get a size box, dungeons do not", async () => {
    const open = async (value: string) => { const i: any = { customId: "dguide:kind", guild: guildWith(), values: [value], reply: vi.fn(), showModal: vi.fn() }; await handleDungeonGuideSelect(i); return i.showModal.mock.calls[0][0].toJSON(); };
    const dungeon = await open("DUNGEON"), arena = await open("ARENA");
    expect(dungeon.custom_id).toBe("dguide:create:DUNGEON");
    expect(dungeon.components.map((r: any) => r.components[0].custom_id)).toEqual(["title", "levels"]);
    expect(arena.custom_id).toBe("dguide:create:ARENA");
    expect(arena.title).toContain("Arena");
    expect(arena.components.map((r: any) => r.components[0].custom_id)).toEqual(["title", "size", "levels"]);
    expect(arena.components[1].components[0].placeholder).toBe("5");
  });

  const submit = (customId: string, fields: Record<string, string>) => ({ customId, guild: guildWith(), user: { id: "u1", username: "aria" }, member: null,
    deferReply: vi.fn(), editReply: vi.fn(), fields: { fields: new Map(Object.keys(fields).map(k => [k, 1])), getTextInputValue: (id: string) => fields[id] ?? "" } }) as any;

  it("posts an arena group in the finder channel with its activity and the default size 5", async () => {
    const i = submit("dguide:create:ARENA", { title: "3v3 push tonight", size: "", levels: "" });
    await handleDungeonGuideModal(i);
    expect(i.guild.channels.fetch).toHaveBeenCalledWith("finder");
    expect(create.mock.calls[0]![0].data).toMatchObject({ kind: "PVP", activity: "arena", maxSize: 5, signupChannelId: "finder" });
  });

  it("posts a battleground in the finder, keeps a dungeon a dungeon, and sends PvP to pvp-groups when the merge is off", async () => {
    await handleDungeonGuideModal(submit("dguide:create:BATTLEGROUND", { title: "WSG 9pm", size: "12", levels: "60" }));
    expect(create.mock.calls[0]![0].data).toMatchObject({ kind: "PVP", activity: "battleground", maxSize: 12, minLevel: 60, maxLevel: 60 });
    await handleDungeonGuideModal(submit("dguide:create:DUNGEON", { title: "Deadmines tonight", levels: "" }));
    expect(create.mock.calls[1]![0].data).toMatchObject({ kind: "DUNGEON", maxSize: 5 });
    expect(create.mock.calls[1]![0].data.activity ?? null).toBeNull();
    settings.unifiedGroupFinder = false;
    const off = submit("dguide:create:BATTLEGROUND", { title: "WSG 9pm", size: "", levels: "" });
    await handleDungeonGuideModal(off);
    expect(off.guild.channels.fetch).toHaveBeenCalledWith("pvpchan");
  });

  it("limits a leader to two open PvP groups, and refuses other kinds", async () => {
    count.mockResolvedValue(2);
    await expect(handleDungeonGuideModal(submit("dguide:create:WORLDPVP", { title: "Tarren Mill", size: "" }))).rejects.toThrow("already have 2 open PvP groups");
    expect(create).not.toHaveBeenCalled();
    count.mockResolvedValue(0);
    const other: any = submit("dguide:create:LEVELING", { title: "levelling" });
    other.reply = vi.fn();
    await handleDungeonGuideModal(other);
    expect(other.reply).toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});
