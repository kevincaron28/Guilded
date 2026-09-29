import { ChannelType, Collection } from "discord.js";
import { describe, expect, it } from "vitest";
import { ARCHIVE_CATEGORY, archiveCoreDiscord, setupCoreDiscord } from "../src/services/core-channels.js";
import { aiMessages, askAi, createAnswerLimiter, foldText, matchFaq, parseTriggers, USER_COOLDOWN_MS } from "../src/services/answers.js";
import { alertRecipients, dungeonLevelsFromTitle, fitsGroup, parseLevelRange, rolesFromTitle, type AlertGroup } from "../src/services/group-alerts.js";

// 5.0 on Discord: core channels made with the core and archived with it; group alerts; the answer channel.

type FakeChannel = {
  id: string; name: string; type: ChannelType; parentId: string | null;
  overwrites: Record<string, Record<string, boolean>>;
  permissionOverwrites: { cache: Collection<string, { id: string }>; edit: (id: string, value: Record<string, boolean>) => Promise<void> };
  edit: (value: { parent?: string | null }) => Promise<void>;
  delete: () => Promise<void>;
};

function fakeGuild(options: { canManageRoles?: boolean } = {}) {
  let next = 1;
  const channels = new Collection<string, FakeChannel>();
  const roles = new Collection<string, { id: string; name: string; mentionable: boolean }>();
  const makeChannel = (name: string, type: ChannelType, parentId: string | null = null, overwriteIds: string[] = []): FakeChannel => {
    const id = `c${next++}`;
    const channel: FakeChannel = {
      id, name, type, parentId, overwrites: {},
      permissionOverwrites: {
        cache: new Collection(overwriteIds.map((overwriteId) => [overwriteId, { id: overwriteId }])),
        edit: async (target, value) => { channel.overwrites[target] = { ...channel.overwrites[target], ...value }; }
      },
      edit: async (value) => { if ("parent" in value) channel.parentId = value.parent ?? null; },
      delete: async () => { channels.delete(id); }
    };
    channels.set(id, channel);
    return channel;
  };
  const guild = {
    id: "g",
    roles: {
      everyone: { id: "everyone" },
      cache: roles,
      fetch: async (id?: string) => {
        if (!id) return roles;
        const role = roles.get(id);
        return role ? { ...role, edit: async (value: { name: string; mentionable: boolean }) => { roles.set(id, { ...role, ...value }); }, setName: async () => undefined, delete: async () => { roles.delete(id); } } : null;
      },
      create: async ({ name }: { name: string }) => {
        if (options.canManageRoles === false) throw new Error("Missing Permissions");
        const role = { id: `r${next++}`, name, mentionable: true };
        roles.set(role.id, role);
        return role;
      }
    },
    members: { me: { id: "bot" } },
    channels: {
      cache: channels,
      fetch: async (id?: string) => (id ? channels.get(id) ?? null : channels),
      create: async ({ name, type, parent, permissionOverwrites }: { name: string; type: ChannelType; parent?: string; permissionOverwrites?: { id: string }[] }) =>
        makeChannel(name, type, parent ?? null, (permissionOverwrites ?? []).map((overwrite) => overwrite.id))
    }
  };
  return { guild, channels, roles, makeChannel };
}

function fakeDatabase(core: Record<string, unknown>) {
  const row = { ...core };
  return {
    row,
    raidCore: {
      findUniqueOrThrow: async () => ({ ...row }),
      findUnique: async () => ({ ...row }),
      update: async ({ data }: { data: Record<string, unknown> }) => { Object.assign(row, data); return { ...row }; }
    },
    raidCoreMember: {}
  };
}

const baseCore = { id: "k1", name: "Tuesday MC", roleId: null, categoryId: null, rosterChannelId: null, rosterMessageId: "m-old", signupChannelId: null, chatChannelId: null, voiceChannelId: null };

describe("core channels made with the core", () => {
  it("creates the role, category and four channels, and removes the roster left in the shared channel", async () => {
    const { guild, channels, roles } = fakeGuild();
    const database = fakeDatabase(baseCore);
    const removed: (string | null)[] = [];
    const result = await setupCoreDiscord(guild as never, database as never, "k1", async (messageId) => { removed.push(messageId); });
    expect(result.error).toBeUndefined();
    expect(result.created).toEqual(["⚔️ Tuesday MC", "#tuesday-mc-roster", "#tuesday-mc-signups", "#tuesday-mc-chat", "🔊 Tuesday MC"]);
    expect([...roles.values()].map((role) => role.name)).toEqual(["Tuesday MC"]);
    expect(channels.size).toBe(5);
    expect(database.row).toMatchObject({ categoryId: expect.any(String), chatChannelId: expect.any(String), rosterMessageId: null });
    expect(removed).toEqual(["m-old"]);
  });

  it("never throws: a missing Manage Roles permission comes back as the reason", async () => {
    const { guild, channels } = fakeGuild({ canManageRoles: false });
    const result = await setupCoreDiscord(guild as never, fakeDatabase(baseCore) as never, "k1", async () => undefined);
    expect(result.created).toEqual([]);
    expect(result.error).toContain("Manage Roles");
    expect(channels.size).toBe(0);
  });
});

describe("core channels archived when the core is deleted", () => {
  it("moves the text channels read-only to Archived cores, drops voice and category, renames the role", async () => {
    const { guild, channels, roles, makeChannel } = fakeGuild();
    roles.set("role1", { id: "role1", name: "Tuesday MC", mentionable: true });
    const category = makeChannel("⚔️ Tuesday MC", ChannelType.GuildCategory);
    const roster = makeChannel("tuesday-mc-roster", ChannelType.GuildText, category.id, ["everyone", "bot"]);
    const signups = makeChannel("tuesday-mc-signups", ChannelType.GuildText, category.id, ["everyone", "bot"]);
    const chat = makeChannel("tuesday-mc-chat", ChannelType.GuildText, category.id, ["everyone", "role1", "bot"]);
    const voice = makeChannel("🔊 Tuesday MC", ChannelType.GuildVoice, category.id);
    const core = { ...baseCore, roleId: "role1", categoryId: category.id, rosterChannelId: roster.id, signupChannelId: signups.id, chatChannelId: chat.id, voiceChannelId: voice.id };

    expect(await archiveCoreDiscord(guild as never, core)).toBe(3);
    const archive = [...channels.values()].find((channel) => channel.name === ARCHIVE_CATEGORY)!;
    expect(archive).toBeDefined();
    for (const channel of [roster, signups, chat]) expect(channel.parentId).toBe(archive.id);
    expect(chat.overwrites["role1"]).toEqual({ SendMessages: false });
    expect(chat.overwrites["bot"]).toBeUndefined();
    expect(channels.has(voice.id)).toBe(false);
    expect(channels.has(category.id)).toBe(false);
    expect(roles.get("role1")).toMatchObject({ name: "Tuesday MC (archived)", mentionable: false });
  });

  it("opens a second archive category when the first is full", async () => {
    const { guild, channels, makeChannel } = fakeGuild();
    const full = makeChannel(ARCHIVE_CATEGORY, ChannelType.GuildCategory);
    for (let i = 0; i < 49; i++) makeChannel(`old-${i}`, ChannelType.GuildText, full.id);
    const chat = makeChannel("wed-chat", ChannelType.GuildText, null, ["everyone"]);
    const signups = makeChannel("wed-signups", ChannelType.GuildText, null, ["everyone"]);
    await archiveCoreDiscord(guild as never, { ...baseCore, chatChannelId: chat.id, signupChannelId: signups.id });
    const second = [...channels.values()].find((channel) => channel.name === `${ARCHIVE_CATEGORY} 2`);
    expect(second).toBeDefined();
    expect(chat.parentId).toBe(second!.id);
  });
});

describe("group alerts: who gets pinged for a new group", () => {
  const group: AlertGroup = { kind: "DUNGEON", minLevel: 55, maxLevel: 60, rolesNeeded: ["HEALER"], leaderDiscordId: "lead" };
  const person = (id: string, over: Partial<{ kinds: string[]; roles: string[]; levels: (number | null)[] }> = {}) =>
    ({ discordUserId: id, kinds: ["DUNGEON"], roles: [], levels: [58], ...over });

  it("pings opted-in members whose kind, level and role fit, never the leader", () => {
    const recipients = alertRecipients(group, [
      person("fits"),
      person("healer", { roles: ["HEALER", "DPS"] }),
      person("tankOnly", { roles: ["TANK"] }),
      person("tooLow", { levels: [30] }),
      person("altFits", { levels: [22, 57] }),
      person("unknownLevel", { levels: [null] }),
      person("pvpOnly", { kinds: ["PVP"] }),
      person("lead")
    ]);
    expect(recipients).toEqual(["fits", "healer", "altFits", "unknownLevel"]);
  });

  it("ignores roles for kinds without role slots, and levels when the group has none", () => {
    expect(fitsGroup({ ...group, kind: "PVP" }, person("x", { kinds: ["PVP"], roles: ["TANK"] }))).toBe(true);
    expect(fitsGroup({ ...group, minLevel: null, maxLevel: null }, person("x", { levels: [12] }))).toBe(true);
  });

  it("skips members already pinged through the kind's LFG role, and caps the mentions", () => {
    expect(alertRecipients(group, [person("a"), person("b")], new Set(["a"]))).toEqual(["b"]);
    const many = Array.from({ length: 60 }, (_, i) => person(`p${i}`));
    expect(alertRecipients(group, many)).toHaveLength(40);
  });

  it("guesses the level range from the dungeon in the title, in English or French", () => {
    expect(dungeonLevelsFromTitle("Strat UD tonight need heal")).toEqual({ min: 58, max: 60 });
    expect(dungeonLevelsFromTitle("Mortemines ce soir")).toEqual({ min: 17, max: 26 });
    expect(dungeonLevelsFromTitle("Upper Blackrock Spire run")).toEqual({ min: 58, max: 60 });
    expect(dungeonLevelsFromTitle("Donjon d'Ombrecroc")).toEqual({ min: 22, max: 30 });
    expect(dungeonLevelsFromTitle("first quest run")).toBeNull();
  });

  it("reads the Levels box and the roles a title asks for", () => {
    expect(parseLevelRange("55-60")).toEqual({ min: 55, max: 60 });
    expect(parseLevelRange("60 à 55")).toEqual({ min: 55, max: 60 });
    expect(parseLevelRange("58+")).toEqual({ min: 58, max: 80 });
    expect(parseLevelRange("60")).toEqual({ min: 60, max: 60 });
    expect(parseLevelRange("soon")).toBeNull();
    expect(rolesFromTitle("Deadmines, need tank and healer")).toEqual(["TANK", "HEALER"]);
    expect(rolesFromTitle("BRD besoin d'un soigneur")).toEqual(["HEALER"]);
    expect(rolesFromTitle("Scholo tonight")).toEqual([]);
  });
});

describe("answer channel: officer answers", () => {
  const entries = [
    { id: "time", triggers: ["raid time", "quand raid"], answer: "Tuesday 8 pm" },
    { id: "loot", triggers: ["loot"], answer: "We use EPGP" },
    { id: "lootRules", triggers: ["loot rules"], answer: "See #rules" },
    { id: "apply", triggers: ["apply", "postuler"], answer: "Use /apply" }
  ];

  it("matches when the message has every word of a trigger, the most specific trigger winning", () => {
    expect(matchFaq(entries, "Hey, what TIME is the raid?")?.id).toBe("time");
    expect(matchFaq(entries, "Quand est le raid ce soir ?")?.id).toBe("time");
    expect(matchFaq(entries, "what are the loot rules")?.id).toBe("lootRules");
    expect(matchFaq(entries, "how does loot work")?.id).toBe("loot");
    expect(matchFaq(entries, "Comment postuler?")?.id).toBe("apply");
    expect(matchFaq(entries, "raiding is fun")).toBeNull();
    expect(matchFaq(entries, "??")).toBeNull();
  });

  it("reads triggers one per line or comma separated, folded, without duplicates", () => {
    expect(parseTriggers("Raid Time\nquand RAID, raid time;  x ; Équipe")).toEqual(["raid time", "quand raid", "equipe"]);
    expect(foldText("Où est l'Écran?")).toBe("ou est l ecran");
  });

  it("answers a member at most once per cooldown, and caps AI answers per guild per day", () => {
    let now = 0;
    const limiter = createAnswerLimiter(() => now);
    expect(limiter.allowUser("g:a")).toBe(true);
    expect(limiter.allowUser("g:a")).toBe(false);
    expect(limiter.allowUser("g:b")).toBe(true);
    now += USER_COOLDOWN_MS;
    expect(limiter.allowUser("g:a")).toBe(true);
    expect(limiter.allowAi("g", 2)).toBe(true);
    expect(limiter.allowAi("g", 2)).toBe(true);
    expect(limiter.allowAi("g", 2)).toBe(false);
    now += 86_400_000;
    expect(limiter.allowAi("g", 2)).toBe(true);
  });
});

describe("answer channel: AI answers", () => {
  it("calls an OpenAI-compatible endpoint with the guild facts and returns its text", async () => {
    let sent: { url: string; body: { model: string; messages: { role: string; content: string }[] }; auth: string | undefined } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      sent = { url, body: JSON.parse(String(init.body)), auth: (init.headers as Record<string, string>)["Authorization"] };
      return new Response(JSON.stringify({ choices: [{ message: { content: " Raid is Tuesday. " } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const messages = aiMessages("Guild: Quebec Gold.\nNext raids:\n- MC: Tuesday", "When is raid?", "Guilded");
    const answer = await askAi({ baseUrl: "https://ai.example/v1/", model: "m", apiKey: "k" }, messages, fetchImpl);
    expect(answer).toBe("Raid is Tuesday.");
    expect(sent!.url).toBe("https://ai.example/v1/chat/completions");
    expect(sent!.auth).toBe("Bearer k");
    expect(sent!.body.model).toBe("m");
    expect(sent!.body.messages[0]!.content).toContain("Guild: Quebec Gold.");
    expect(sent!.body.messages[0]!.content).toContain("never invent guild rules");
  });

  it("stays quiet (null) on an error, a bad answer or no key needed for a local model", async () => {
    const failing = (async () => new Response("nope", { status: 429 })) as unknown as typeof fetch;
    expect(await askAi({ baseUrl: "http://x", model: "m" }, [], failing)).toBeNull();
    const empty = (async () => new Response(JSON.stringify({ choices: [] }), { status: 200 })) as unknown as typeof fetch;
    expect(await askAi({ baseUrl: "http://x", model: "m" }, [], empty)).toBeNull();
    const throwing = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect(await askAi({ baseUrl: "http://x", model: "m" }, [], throwing)).toBeNull();
  });
});
