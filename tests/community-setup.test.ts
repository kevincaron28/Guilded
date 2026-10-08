import { describe, expect, it, vi } from "vitest";
import { ChannelType, Collection, PermissionFlagsBits, type Guild } from "discord.js";
import type { PrismaClient } from "@prisma/client";
import { communitySetupState, ensureCommunitySetup } from "../src/services/community-setup.js";
import { setupChecks, type SetupFacts } from "../src/services/setup-status.js";

type Row = Record<string, unknown>;
interface FakeChannel { id: string; type: ChannelType; name: string; parentId: string | null; permissionOverwrites: { cache: Collection<string, Row> }; permissionsFor: () => { has: () => boolean }; options?: Row }

function fakeGuild(existing: Partial<FakeChannel>[] = [], voiceOpen = true) {
  const cache = new Collection<string, FakeChannel>();
  let next = 1;
  const add = (data: Partial<FakeChannel> & { options?: Row }) => {
    const channel: FakeChannel = { id: data.id ?? `new-${next++}`, type: data.type ?? ChannelType.GuildText, name: data.name ?? "", parentId: data.parentId ?? null,
      permissionOverwrites: { cache: new Collection() }, permissionsFor: () => ({ has: () => voiceOpen }), ...(data.options ? { options: data.options } : {}) };
    cache.set(channel.id, channel);
    return channel;
  };
  existing.forEach(add);
  const create = vi.fn(async (options: { name: string; type: ChannelType; parent?: string } & Row) => add({ name: options.name, type: options.type, parentId: options.parent ?? null, options }));
  const officer = { id: "officer-role", name: "Officer" };
  const roles = new Collection<string, { id: string; name: string }>([[officer.id, officer]]);
  const createRole = vi.fn(async (options: { name: string }) => { const role = { id: `role-${next++}`, name: options.name }; roles.set(role.id, role); return role; });
  const guild = { id: "discord", afkChannelId: null, client: { rest: {} }, members: { me: { id: "bot" } },
    roles: { everyone: { id: "discord" }, cache: roles, fetch: vi.fn(async () => undefined), create: createRole },
    channels: { cache, fetch: vi.fn(async () => undefined), create } };
  return { guild: guild as unknown as Guild, cache, create, createRole };
}

function fakeDatabase(seasons: Row[] = [], configs: Row[] = []) {
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    guildSettings: { findUnique: vi.fn(async () => ({ timezone: "America/Toronto" })) },
    auditLog: { create: vi.fn(async () => ({})) },
    communityActivity: { findMany: vi.fn(async () => []) },
    communitySeasonCounter: { upsert: vi.fn(async () => ({ nextNumber: 2 })) },
    communitySeason: {
      findFirst: vi.fn(async ({ where }: { where: Row }) => {
        const found = seasons.find(row => (!where["id"] || row["id"] === where["id"]) && (!where["status"] || row["status"] === where["status"]) && (!where["game"] || row["game"] === where["game"])
          && (!("audienceRoleId" in where) || row["audienceRoleId"] === where["audienceRoleId"]));
        return found ? { ...found, participation: configs.find(config => config["seasonId"] === found["id"]) ?? null } : null;
      }),
      create: vi.fn(async ({ data }: { data: Row }) => { const row = { id: "season-1", status: "ACTIVE", announcementChannelId: null, ...data }; seasons.push(row); return row; }),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => Object.assign(seasons.find(row => row["id"] === where["id"])!, data))
    },
    communityParticipationConfig: { upsert: vi.fn(async ({ create }: { create: Row }) => { configs.push(create); return create; }) }
  };
  const honors: Row[] = [];
  const communityHonors = {
    findUnique: vi.fn(async () => honors[0] ?? null),
    upsert: vi.fn(async ({ create, update }: { create: Row; update: Row }) => { if (honors[0]) Object.assign(honors[0], update); else honors.push(create); return honors[0]; })
  };
  const database = { ...tx, communityHonors, $transaction: <T>(work: (transaction: typeof tx) => Promise<T>) => work(tx) };
  return { database: database as unknown as PrismaClient, tx, seasons, configs, honors };
}

const refreshFor = (cache: Collection<string, FakeChannel>) => vi.fn(async (_rest: unknown, _db: unknown, _guild: string, _bot: string, provision?: { categoryId: string }) => {
  if (provision && !cache.some(channel => channel.name === "🏆・leaderboard")) cache.set("board", { id: "board", type: ChannelType.GuildText, name: "🏆・leaderboard", parentId: provision.categoryId, permissionOverwrites: { cache: new Collection() }, permissionsFor: () => ({ has: () => true }) });
  return { channelId: "board", messageId: "podium" };
});

describe("community section of /setup", () => {
  it("builds the whole section on a fresh server and turns participation on with the default rules", async () => {
    const { guild, cache, create } = fakeGuild([{ id: "lobby", type: ChannelType.GuildVoice, name: "Lobby" }]);
    const { database, seasons, configs } = fakeDatabase();
    const refresh = refreshFor(cache);
    const text = await ensureCommunitySetup(guild, database, "guild", "fr", "officer", refresh as never);

    expect(create.mock.calls.map(([options]) => options.name)).toEqual(["Communauté", "activites", "chat-communaute", "🏅・palmares"]);
    const category = cache.find(channel => channel.type === ChannelType.GuildCategory)!;
    const hub = cache.find(channel => channel.name === "activites")!, chat = cache.find(channel => channel.name === "chat-communaute")!;
    expect([hub.parentId, chat.parentId]).toEqual([category.id, category.id]);
    // Members read the hub but cannot post; officers and the bot can.
    const overwrites = hub.options!["permissionOverwrites"] as { id: string; allow: bigint; deny: bigint }[];
    expect(overwrites.find(o => o.id === "discord")!.deny & PermissionFlagsBits.SendMessages).toBe(PermissionFlagsBits.SendMessages);
    expect(overwrites.find(o => o.id === "officer-role")!.allow & PermissionFlagsBits.SendMessages).toBe(PermissionFlagsBits.SendMessages);
    expect(overwrites.find(o => o.id === "bot")!.allow & PermissionFlagsBits.PinMessages).toBe(PermissionFlagsBits.PinMessages);

    expect(seasons).toHaveLength(1);
    expect(seasons[0]).toMatchObject({ game: "DISCORD", channelId: "board", audienceRoleId: null, announcementChannelId: hub.id, createdBy: "officer" });
    expect(configs).toHaveLength(1);
    expect(configs[0]).toMatchObject({ seasonId: "season-1", enabled: true });
    expect(configs[0]!["rules"]).toMatchObject({ textChannels: [], voiceChannels: [], allText: true, allVoice: true, messageDailyCap: 10, reactionDailyCap: 6, voiceDailyMinutes: 240, minimumMemberDays: 3, weeklyGoal: 10 });
    // Provision the podium first, then redraw it once the season and participation exist.
    expect(refresh.mock.calls.map(call => call[4])).toEqual([{ categoryId: category.id }, undefined]);
    expect(text).toContain("Première saison lancée");
  });

  it("adds a read-only hall of fame and the four recognition roles once", async () => {
    const { guild, cache, createRole } = fakeGuild([{ id: "lobby", type: ChannelType.GuildVoice, name: "Lobby" }]);
    const { database, honors } = fakeDatabase();
    const text = await ensureCommunitySetup(guild, database, "guild", "en", "officer", refreshFor(cache) as never);
    const fame = cache.find(channel => channel.name === "🏅・hall-of-fame")!;
    expect(fame.parentId).toBe(cache.find(channel => channel.type === ChannelType.GuildCategory)!.id);
    const overwrites = fame.options!["permissionOverwrites"] as { id: string; allow: bigint; deny: bigint }[];
    expect(overwrites.find(o => o.id === "discord")!.deny & PermissionFlagsBits.SendMessages).toBe(PermissionFlagsBits.SendMessages);
    expect(overwrites.find(o => o.id === "bot")!.allow & PermissionFlagsBits.SendMessages).toBe(PermissionFlagsBits.SendMessages);
    expect(createRole.mock.calls.map(([options]) => options.name)).toEqual(["⭐ MVP of the week", "🥇 Champion of the month", "🥈 Runner-up of the month", "🥉 Third of the month"]);
    expect(honors[0]).toMatchObject({ channelId: fame.id, weeklyRoleId: expect.any(String) });
    expect(honors[0]!["monthRoleIds"]).toHaveLength(3);
    expect(text).toContain(`<#${fame.id}>`);

    // A second run, even in French, finds the same channel and roles.
    await ensureCommunitySetup(guild, database, "guild", "fr", "officer", refreshFor(cache) as never);
    expect(createRole).toHaveBeenCalledTimes(4);
    expect(cache.filter(channel => channel.name.startsWith("🏅")).size).toBe(1);
  });

  it("creates a voice channel only when the server has none", async () => {
    const { guild, cache, create } = fakeGuild();
    const { database, configs } = fakeDatabase();
    await ensureCommunitySetup(guild, database, "guild", "en", "officer", refreshFor(cache) as never);
    const made = create.mock.calls.map(([options]) => options).find(options => options.type === ChannelType.GuildVoice)!;
    expect(made.name).toBe("Community voice");
    expect(cache.some(channel => channel.name === "Community voice")).toBe(true);
    expect((configs[0]!["rules"] as { allVoice: boolean }).allVoice).toBe(true);
  });

  it("reuses what exists and never overwrites a season or settings an officer chose", async () => {
    const { guild, cache, create } = fakeGuild([
      { id: "cat", type: ChannelType.GuildCategory, name: "🎉 Communauté" }, { id: "hub", name: "activites", parentId: "cat" },
      { id: "chat", name: "chat-communaute", parentId: "cat" }, { id: "board", name: "🏆・leaderboard", parentId: "cat" }, { id: "lobby", type: ChannelType.GuildVoice, name: "Lobby" },
      { id: "fame", name: "🏅・palmares", parentId: "cat" }
    ]);
    const { database, tx } = fakeDatabase([{ id: "live", game: "DISCORD", status: "ACTIVE", audienceRoleId: null, name: "Octobre 2026", channelId: "board" }], [{ seasonId: "live", enabled: false, rules: { textChannels: ["elsewhere"] } }]);
    const text = await ensureCommunitySetup(guild, database, "guild", "en", "officer", refreshFor(cache) as never);
    expect(create).not.toHaveBeenCalled();
    expect(tx.communitySeason.create).not.toHaveBeenCalled();
    expect(tx.communitySeason.update).not.toHaveBeenCalled();
    expect(tx.communityParticipationConfig.upsert).not.toHaveBeenCalled();
    expect(text).toContain("kept those settings");
  });

  it("enables participation on an existing open season that has none", async () => {
    const { guild, cache } = fakeGuild([
      { id: "cat", type: ChannelType.GuildCategory, name: "Community" }, { id: "hub", name: "activities", parentId: "cat" },
      { id: "chat", name: "community-chat", parentId: "cat" }, { id: "board", name: "🏆・leaderboard", parentId: "cat" }, { id: "lobby", type: ChannelType.GuildVoice, name: "Lobby" }
    ]);
    const { database, tx, configs } = fakeDatabase([{ id: "live", game: "DISCORD", status: "ACTIVE", audienceRoleId: null, name: "October 2026", channelId: "board" }]);
    await ensureCommunitySetup(guild, database, "guild", "en", "officer", refreshFor(cache) as never);
    expect(tx.communitySeason.create).not.toHaveBeenCalled();
    expect(configs[0]).toMatchObject({ seasonId: "live", enabled: true });
    expect(configs[0]!["rules"]).toMatchObject({ allText: true, allVoice: true });
  });

  it("leaves a role-restricted season alone and refuses several community categories", async () => {
    const restricted = fakeGuild([{ id: "lobby", type: ChannelType.GuildVoice, name: "Lobby" }]);
    const store = fakeDatabase([{ id: "gated", game: "DISCORD", status: "ACTIVE", audienceRoleId: "role", name: "Gated", channelId: "x" }]);
    const text = await ensureCommunitySetup(restricted.guild, store.database, "guild", "en", "officer", refreshFor(restricted.cache) as never);
    expect(store.tx.communityParticipationConfig.upsert).not.toHaveBeenCalled();
    expect(text).toContain("limited to one role");

    const twice = fakeGuild([{ id: "a", type: ChannelType.GuildCategory, name: "Community" }, { id: "b", type: ChannelType.GuildCategory, name: "Communauté" }]);
    await expect(ensureCommunitySetup(twice.guild, fakeDatabase().database, "guild", "en", "officer", refreshFor(twice.cache) as never)).rejects.toThrow(/several Community categories/);
    expect(twice.create).not.toHaveBeenCalled();
  });

  it("reports the section on the checklist as optional", async () => {
    expect(await communitySetupState(fakeDatabase().database, "guild")).toEqual({ season: false, participation: false });
    const live = fakeDatabase([{ id: "live", game: "DISCORD", status: "ACTIVE", audienceRoleId: null }], [{ seasonId: "live", enabled: true }]);
    expect(await communitySetupState(live.database, "guild")).toEqual({ season: true, participation: true });
    const facts: SetupFacts = { existingRoleNames: [], requiredRoleNames: [], notifyChannel: null, raidChannel: null, logChannel: null, welcomeChannel: null, autoRoles: [],
      epgpConfigured: true, remindersOn: true, weeklyReportOn: true, companionPaired: true, linkedCharacters: 1, community: { season: true, participation: false } };
    const check = setupChecks(facts, "en").find(row => row.label.startsWith("Community season"))!;
    expect(check).toMatchObject({ ok: false, optional: true });
    expect(check.fix).toContain("/participation settings");
    expect(setupChecks({ ...facts, community: { season: true, participation: true } }, "en").find(row => row.label.startsWith("Community season"))!.ok).toBe(true);
  });
});
