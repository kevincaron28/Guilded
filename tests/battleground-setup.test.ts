/* eslint-disable @typescript-eslint/no-explicit-any -- Partial Discord/Prisma fixtures intentionally model only setup operations. */
import { describe, it, expect, vi } from "vitest";
import { Collection, ChannelType, PermissionFlagsBits } from "discord.js";
import { readFileSync } from "node:fs";
import { ensureBattlegroundSetup, bgSetupPanel, BG_SETUP_PARTS, QG_BG_ADOPTION } from "../src/services/battleground-setup.js";
vi.mock("../src/permissions.js", () => ({ hasPermission: (actor: { officer: boolean }) => actor.officer }));

function fixture(options: { manage?: boolean; role?: string | null; discordId?: string; scopeKey?: string } = {}) {
  const discordId = options.discordId ?? "server";
  const settings: Record<string, unknown> = { guildId: "scope", memberRoleId: options.role === undefined ? "members" : options.role };
  const channels = new Collection<string, any>();
  const actor = { id: "officer", officer: true, visible: true };
  const me = { id: "bot", permissions: { has: () => options.manage !== false } };
  let sequence = 0;
  const posted: any[] = [];
  const channel = (id: string, type: number, parentId: string | null = null, name = id) => {
    const messages = new Collection<string, any>();
    const item: any = { id, type, parentId, name, guild: { id: discordId }, permissionOverwrites: { cache: new Collection() },
      permissionsFor: (member: any) => ({ has: () => member === actor ? actor.visible : true }),
      send: vi.fn(async (payload: any) => {
        const m: any = { id: `message${++sequence}`, author: { id: "bot" }, embeds: payload.embeds, pinned: false,
          edit: vi.fn(async (p: any) => { m.embeds = p.embeds; }), pin: vi.fn(async () => { m.pinned = true; }) };
        messages.set(m.id, m); posted.push(m); return m;
      }), messages: {
        fetch: vi.fn(async (arg: any) => { if (typeof arg !== "string") return messages; if (!messages.has(arg)) throw { code: 10008 }; return messages.get(arg); }),
        fetchPins: vi.fn(async () => ({ items: [...messages.values()].filter(m => m.pinned).map(message => ({ message })) }))
      }
    };
    channels.set(id, item); return item;
  };
  const guild: any = { id: discordId, members: { fetch: vi.fn(async () => actor), fetchMe: vi.fn(async () => me) },
    roles: { fetch: vi.fn(), cache: new Collection([["members", {}]]) }, channels: {
      cache: channels, fetch: vi.fn(async (id?: string) => id ? channels.get(id) : channels),
      create: vi.fn(async (data: any) => { const c = channel(`channel${++sequence}`, data.type, data.parent ?? null, data.name); c.permissionOverwrites.cache = new Collection((data.permissionOverwrites ?? []).map((o: any) => [o.id, { ...o, type: o.type ?? 0, allow: { bitfield: Array.isArray(o.allow) ? o.allow.reduce((a: bigint, b: bigint) => a | b, 0n) : o.allow ?? 0n }, deny: { bitfield: Array.isArray(o.deny) ? o.deny.reduce((a: bigint, b: bigint) => a | b, 0n) : o.deny ?? 0n } }])); return c; })
    } };
  const db: any = { guild: { findFirst: vi.fn(async () => ({ id: "scope", name: "Test Guild", gameEdition: "FOREVER", discordId, scopeKey: options.scopeKey ?? "default", wowSpace: null })) },
    guildSettings: { findUniqueOrThrow: vi.fn(async () => ({ ...settings })), update: vi.fn(async ({ data }: any) => { Object.assign(settings, data); return { ...settings }; }), findFirst: vi.fn(async () => null) },
    raidCore: { findFirst: vi.fn(async () => null) }, activityCore: { findFirst: vi.fn(async () => null) },
    wowGuildChannel: { findUnique: vi.fn(async () => null) } };
  return { settings, channels, actor, me, guild, db, channel, posted, run: (selection?: any, lang: "en" | "fr" = "en") => ensureBattlegroundSetup(guild, db, "scope", lang, "officer", selection) };
}

describe("optional battleground installation", () => {
  it("creates once under concurrent installs, persists IDs and makes only new info channels readonly", async () => {
    const f = fixture();
    await Promise.all([f.run(), f.run()]);
    expect(f.guild.channels.create).toHaveBeenCalledTimes(5);
    expect(f.posted).toHaveLength(3);
    expect(f.posted.every(m => m.edit.mock.calls.length === 1)).toBe(true);
    expect(f.channels.get(f.settings["duelBoardChannelId"] as string).name).toBe("duel-ladder");
    expect(f.channels.get(f.settings["bgStatsChannelId"] as string).name).toBe("bg-ladder");
    for (const id of [f.settings["bgResultsChannelId"], f.settings["bgStatsChannelId"], f.settings["duelBoardChannelId"]]) {
      const c = f.channels.get(id as string);
      expect(c.permissionOverwrites.cache.get("members").deny.bitfield & PermissionFlagsBits.SendMessages).not.toBe(0n);
    }
    expect(f.settings["bgCategoryId"]).toBeTruthy();
    expect(Object.keys(f.settings).some(k => /capture|award|consent/i.test(k))).toBe(false);
  });
  it("creates no pvp-groups channel when the group finder exists, and reports an old one as merged", async () => {
    const f = fixture(); f.settings["dungeonSignupChannelId"] = "finder";
    const note = await f.run();
    expect(f.guild.channels.create).toHaveBeenCalledTimes(4); // category, results, ladder, duel ladder: no groups
    expect(f.settings["bgGroupsChannelId"]).toBeUndefined();
    expect(note).not.toContain("merged");
    const old = fixture(); old.settings["dungeonSignupChannelId"] = "finder";
    old.channel("cat", ChannelType.GuildCategory); old.settings["bgCategoryId"] = "cat"; old.channel("oldgroups", ChannelType.GuildText, "cat", "pvp-groups");
    const merged = await old.run();
    expect(merged).toContain("<#oldgroups> (merged into the group finder <#finder>, safe to archive)");
    expect(old.posted.some(m => m.embeds.some((e: any) => e.footer?.text?.endsWith("groups")))).toBe(false);
    expect((await old.run(undefined, "fr"))).toContain("peut être archivé");
  });

  it("keeps creating pvp-groups when the officers switched the merge off", async () => {
    const f = fixture(); f.settings["dungeonSignupChannelId"] = "finder"; f.settings["unifiedGroupFinder"] = false;
    await f.run();
    expect(f.guild.channels.create).toHaveBeenCalledTimes(5);
    expect(f.settings["bgGroupsChannelId"]).toBeTruthy();
  });

  it("repairs a deleted saved channel without replacing surviving panels", async () => {
    const f = fixture(); await f.run();
    const groups = f.settings["bgGroupsChannelId"];
    f.channels.delete(f.settings["bgResultsChannelId"] as string);
    await f.run();
    expect(f.settings["bgGroupsChannelId"]).toBe(groups);
    expect(f.guild.channels.create).toHaveBeenCalledTimes(6);
    expect(f.posted).toHaveLength(4);
  });
  it("updates language on saved panels without changing channels or overwrites", async () => {
    const f = fixture(); await f.run();
    const before = [...f.channels.values()].map(c => c.permissionOverwrites);
    await f.run(undefined, "fr");
    expect(f.guild.channels.create).toHaveBeenCalledTimes(5);
    expect([...f.channels.values()].map(c => c.permissionOverwrites)).toEqual(before);
    expect(f.posted[0].edit.mock.calls[0][0].content).toContain("Créez");
  });
  it("recovers bot-owned marker messages when message IDs were lost", async () => {
    const f = fixture(); await f.run();
    f.settings["bgGroupsMessageId"] = null; await f.run();
    expect(f.posted).toHaveLength(3);
    expect(f.settings["bgGroupsMessageId"]).toBe(f.posted[0].id);
  });
  it("requires manual selection without Manage Channels, then installs only the selected panel", async () => {
    const f = fixture({ manage: false });
    await expect(f.run()).rejects.toThrow("Manage Channels");
    const existing = f.channel("chosen", ChannelType.GuildText);
    await f.run({ part: "results", channelId: existing.id });
    expect(f.guild.channels.create).not.toHaveBeenCalled(); expect(f.posted).toHaveLength(1);
    expect(f.settings["bgResultsChannelId"]).toBe("chosen"); expect(f.settings["bgCategoryId"]).toBeUndefined();
  });
  it("without a member role creates the category visible to everyone and tells the officer", async () => {
    const f = fixture({ role: null });
    const note = await f.run();
    const calls = f.guild.channels.create.mock.calls as unknown as [{ type: number; permissionOverwrites: { id: string; deny?: bigint[] }[] }][];
    const category = calls.map(call => call[0]).find(options => options.type === ChannelType.GuildCategory);
    expect(category).toBeDefined();
    expect(category!.permissionOverwrites.some(overwrite => overwrite.id === f.guild.id && (overwrite.deny ?? []).length > 0)).toBe(false);
    expect(note).toContain("visible to everyone");
  });
  it("rejects a foreign guild scope before any mutation", async () => {
    const f = fixture(); f.db.guild.findFirst.mockResolvedValue(null);
    await expect(f.run()).rejects.toThrow("not available"); expect(f.guild.channels.create).not.toHaveBeenCalled();
  });
  it("checks fresh officer authorization", async () => {
    const f = fixture(); f.actor.officer = false;
    await expect(f.run()).rejects.toThrow("Officer"); expect(f.guild.channels.create).not.toHaveBeenCalled();
    expect(f.guild.members.fetch).toHaveBeenCalledWith({ user: "officer", force: true });
  });
  it("rejects selected channels inside another scope's category", async () => {
    const f = fixture(); f.channel("chosen", ChannelType.GuildText, "foreign");
    f.db.wowGuildChannel.findUnique.mockImplementation(async ({ where }: any) => where.discordId_channelId.channelId === "foreign" ? { scopeGuildId: "other" } : null);
    await expect(f.run({ part: "groups", channelId: "chosen" })).rejects.toThrow("another guild");
    expect(f.db.guildSettings.update).not.toHaveBeenCalled();
  });
  it.each(["guildSettings", "raidCore", "activityCore"])("rejects foreign %s ownership on selected channels", async table => {
    const f = fixture(); f.channel("chosen", ChannelType.GuildText);
    f.db[table].findFirst.mockResolvedValue({ guildId: "other" });
    await expect(f.run({ part: "groups", channelId: "chosen" })).rejects.toThrow("another guild");
    expect(f.db.guildSettings.update).not.toHaveBeenCalled();
  });
  it("does not adopt unsaved same-name categories", async () => {
    const f = fixture(); f.channel("orphan", ChannelType.GuildCategory, null, "🏴 Battlegrounds · Test Guild · FOREVER");
    await expect(f.run()).rejects.toThrow("unsaved category");
    expect(f.guild.channels.create).not.toHaveBeenCalled();
  });
  it("denies inherited posting on new info channels even when the category has no overwrites", async () => {
    const f = fixture(); const c = f.channel("empty-category", ChannelType.GuildCategory); f.settings["bgCategoryId"] = c.id;
    await f.run();
    for (const part of ["Results", "Stats"]) {
      const info = f.channels.get(f.settings[`bg${part}ChannelId`] as string);
      expect(info.permissionOverwrites.cache.get(f.guild.id).deny.bitfield & PermissionFlagsBits.SendMessages).not.toBe(0n);
    }
    expect(c.permissionOverwrites.cache.size).toBe(0);
  });
  it("preserves bot posting when creating readonly channels from role-granted category access", async () => {
    const f = fixture(); const c = f.channel("category", ChannelType.GuildCategory); f.settings["bgCategoryId"] = c.id;
    c.permissionOverwrites.cache.set("bot-role", { id: "bot-role", type: 0, allow: { bitfield: PermissionFlagsBits.SendMessages }, deny: { bitfield: 0n } });
    await f.run();
    const stats = f.channels.get(f.settings["bgStatsChannelId"] as string);
    expect(stats.permissionOverwrites.cache.get("bot").allow.bitfield & PermissionFlagsBits.SendMessages).not.toBe(0n);
    expect(c.permissionOverwrites.cache.has("bot")).toBe(false);
  });
  it("rejects hidden selected channels and channels bot cannot post in", async () => {
    const f = fixture(); const c = f.channel("chosen", ChannelType.GuildText); f.actor.visible = false;
    await expect(f.run({ part: "groups", channelId: "chosen" })).rejects.toThrow("cannot view");
    f.actor.visible = true; c.permissionsFor = (m: any) => ({ has: () => m === f.actor });
    await expect(f.run({ part: "groups", channelId: "chosen" })).rejects.toThrow("Choose a text channel");
    expect(f.db.guildSettings.update).not.toHaveBeenCalled();
  });
  it("adopts reviewed QG default IDs and panels without duplicate channels or messages", async () => {
    const f = fixture({ discordId: QG_BG_ADOPTION.discordId });
    f.channel(QG_BG_ADOPTION.category, ChannelType.GuildCategory);
    for (const part of BG_SETUP_PARTS.filter(p => p !== "duels")) {
      const legacy = QG_BG_ADOPTION[part]; const c = f.channel(legacy.channel, ChannelType.GuildText, QG_BG_ADOPTION.category);
      const msg = await c.send({ embeds: [] }); msg.id = legacy.message;
      c.messages.fetch.mockImplementation(async (id: any) => typeof id === "string" ? msg : new Collection([[msg.id, msg]]));
    }
    await f.run();
    // The existing statistics channel is adopted for the battleground ladder; only the separate duel channel is new.
    expect(f.guild.channels.create).toHaveBeenCalledTimes(1);
    expect(f.guild.channels.create.mock.calls[0][0]).toMatchObject({ name: "duel-ladder", parent: QG_BG_ADOPTION.category });
    expect(f.settings["bgStatsChannelId"]).toBe(QG_BG_ADOPTION.stats.channel);
    expect(f.settings["duelBoardChannelId"]).not.toBe(QG_BG_ADOPTION.stats.channel);
    expect(f.posted.filter(m => m.embeds.some((e: any) => e.footer?.text?.startsWith("Guilded BG setup")))).toHaveLength(3);
    await f.run(); // a re-run never duplicates a channel
    expect(f.guild.channels.create).toHaveBeenCalledTimes(1);
    expect(f.settings["bgGroupsChannelId"]).toBe(QG_BG_ADOPTION.groups.channel);
    expect(f.settings["bgGroupsMessageId"]).toBe(QG_BG_ADOPTION.groups.message);
  });
  it("never adopts legacy QG channels for another edition scope", async () => {
    const f = fixture({ discordId: QG_BG_ADOPTION.discordId, scopeKey: "retail" });
    f.channel(QG_BG_ADOPTION.category, ChannelType.GuildCategory);
    await f.run(); expect(f.settings["bgCategoryId"]).not.toBe(QG_BG_ADOPTION.category);
  });
  it("leaves non-bot saved messages untouched", async () => {
    const f = fixture(); await f.run(); f.posted[0].author.id = "person";
    await expect(f.run()).rejects.toThrow("not mine"); expect(f.posted).toHaveLength(3);
  });
  it("does not replace a panel when reading its saved message fails with missing access", async () => {
    const f = fixture(); await f.run(); const c = f.channels.get(f.settings["bgGroupsChannelId"] as string);
    c.messages.fetch.mockRejectedValue({ code: 50001 });
    await expect(f.run()).rejects.toEqual({ code: 50001 }); expect(f.posted).toHaveLength(3);
  });
  it("only emits supported, guild-bound buttons and suppresses mentions", () => {
    for (const part of BG_SETUP_PARTS.filter(p => p !== "duels")) for (const lang of ["en", "fr"] as const) {
      const panel = bgSetupPanel(part, "scope", lang);
      for (const b of panel.components[0]!.components) expect(b.toJSON()).toMatchObject({ custom_id: expect.stringMatching(/^bgui:scope:(create|looking|mine|upcoming|history|stats|privacy-help)$/) });
      expect(panel.allowedMentions).toEqual({ parse: [] });
    }
  });
  it("keeps optional fields out of baseline setup channel lists", () => {
    const names = readFileSync("src/setup-names.ts", "utf8");
    expect(names.slice(names.indexOf("export type ChannelField"), names.indexOf("// Access:"))).not.toContain("bgGroupsChannelId");
    const setup = readFileSync("src/commands/setup.ts", "utf8");
    expect(setup).toContain('action === "bg-install"');
    expect(setup).not.toMatch(/create-all-channels[^\n]*ensureBattlegroundSetup/);
  });
});
