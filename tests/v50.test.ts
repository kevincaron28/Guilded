import { ChannelType, Collection } from "discord.js";
import { describe, expect, it } from "vitest";
import { ARCHIVE_CATEGORY, archiveCoreDiscord, setupCoreDiscord } from "../src/services/core-channels.js";
import {
  activePollAnswer, aiMessages, applicationStatusAnswer, askAi, createAnswerLimiter, foldText, looksLikeActivePollQuestion,
  looksLikeApplicationStatusQuestion, looksLikeBankRequestQuestion, looksLikeCraftRequestQuestion, looksLikeLootRulesQuestion,
  looksLikeMyCharactersQuestion, looksLikeOpenGroupsQuestion, looksLikePersonalStandingQuestion, looksLikeQuestion,
  looksLikeScheduleQuestion, lootRulesAnswer, matchFaq, myBankRequestAnswer, myCharactersAnswer, myCraftRequestAnswer,
  openGroupsAnswer, parseTriggers, personalStandingAnswer, scheduleAnswer, USER_COOLDOWN_MS
} from "../src/services/answers.js";
import { buildGuildedReference } from "../src/services/guilded-reference.js";
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

  it("does not consume the cooldown or daily quota until an answer is recorded", () => {
    const limiter = createAnswerLimiter(() => 1_000);
    expect(limiter.canAnswerUser("g:a")).toBe(true);
    expect(limiter.canUseAi("g", 1)).toBe(true);
    expect(limiter.canAnswerUser("g:a")).toBe(true);
    expect(limiter.canUseAi("g", 1)).toBe(true);
    limiter.recordUserAnswer("g:a");
    limiter.recordAiAnswer("g");
    expect(limiter.canAnswerUser("g:a")).toBe(false);
    expect(limiter.canUseAi("g", 1)).toBe(false);
  });

  it("recognizes English and French help questions even without punctuation", () => {
    expect(looksLikeQuestion("how do I link my character", false)).toBe(true);
    expect(looksLikeQuestion("Comment utiliser la carte", false)).toBe(true);
    expect(looksLikeQuestion("help with the addon", false)).toBe(true);
    expect(looksLikeQuestion("I was raiding last night", false)).toBe(false);
    expect(looksLikeQuestion("anything", true)).toBe(true);
  });

  it("recognizes raid-timing questions but not unrelated raid chatter", () => {
    expect(looksLikeScheduleQuestion("raid night?")).toBe(true);
    expect(looksLikeScheduleQuestion("when is the next raid")).toBe(true);
    expect(looksLikeScheduleQuestion("quand est le raid ce soir")).toBe(true);
    expect(looksLikeScheduleQuestion("what's the core schedule")).toBe(true);
    expect(looksLikeScheduleQuestion("I was raiding last night")).toBe(false);
    expect(looksLikeScheduleQuestion("what are the raid loot rules")).toBe(false);
  });
});

describe("answer channel: raid-schedule fast path", () => {
  function fakeScheduleDatabase(options: { cores?: { name: string; schedule: string }[]; raids?: { title: string; scheduledAt: Date; core: { name: string } | null }[] } = {}) {
    return {
      raidCore: { findMany: async () => options.cores ?? [] },
      raid: { findMany: async () => options.raids ?? [] }
    };
  }

  it("returns null when the guild has no core schedule and no planned raid", async () => {
    const database = fakeScheduleDatabase();
    expect(await scheduleAnswer(database as never, "g1", "America/New_York", "en")).toBeNull();
  });

  it("lists each core's schedule and the next planned raids", async () => {
    const database = fakeScheduleDatabase({
      cores: [{ name: "Tuesday MC", schedule: "Tuesdays 8pm" }],
      raids: [{ title: "MC Week 3", scheduledAt: new Date("2025-01-07T20:00:00-05:00"), core: { name: "Tuesday MC" } }]
    });
    const answer = await scheduleAnswer(database as never, "g1", "America/New_York", "en", new Date("2025-01-01T00:00:00-05:00"));
    expect(answer).not.toBeNull();
    expect(answer).toContain("Raid schedule:");
    expect(answer).toContain("**Tuesday MC** — Tuesdays 8pm");
    expect(answer).toContain("Next raid:");
    expect(answer).toContain("MC Week 3 [Tuesday MC]");
  });

  it("answers in French when the guild's language is fr", async () => {
    const database = fakeScheduleDatabase({ cores: [{ name: "Coeur Mardi", schedule: "Mardis 20h" }] });
    const answer = await scheduleAnswer(database as never, "g1", "America/New_York", "fr");
    expect(answer).toContain("Horaire de raid :");
    expect(answer).toContain("**Coeur Mardi** — Mardis 20h");
  });
});

describe("answer channel: loot-rules fast path", () => {
  it("recognizes loot-rules questions but not unrelated loot chatter", () => {
    expect(looksLikeLootRulesQuestion("how does loot work")).toBe(true);
    expect(looksLikeLootRulesQuestion("epgp rules?")).toBe(true);
    expect(looksLikeLootRulesQuestion("comment fonctionne le loot")).toBe(true);
    expect(looksLikeLootRulesQuestion("nice loot last night")).toBe(false);
  });

  it("returns null without guild settings", () => {
    expect(lootRulesAnswer(null, "en")).toBeNull();
  });

  it("explains council loot with no numbers", () => {
    const answer = lootRulesAnswer({ lootMode: "COUNCIL", baseGp: 0, epgpDecayPercent: 0, epgpDecayIntervalHours: 0 }, "en");
    expect(answer).toBe("This guild uses council loot: officers decide who gets each drop. There is no bidding.");
  });

  it("explains the EPGP formula, adding decay only when it is enabled", () => {
    const noDecay = lootRulesAnswer({ lootMode: "EPGP", baseGp: 100, epgpDecayPercent: 0, epgpDecayIntervalHours: 0 }, "en");
    expect(noDecay).toContain("EP ÷ (GP + 100)");
    expect(noDecay).not.toContain("decay");

    const withDecay = lootRulesAnswer({ lootMode: "EPGP", baseGp: 100, epgpDecayPercent: 0.1, epgpDecayIntervalHours: 168 }, "en");
    expect(withDecay).toContain("decay by 10% every 168h");
    expect(withDecay).toContain("Check your own numbers with /epgp.");
  });
});

describe("answer channel: open-groups fast path", () => {
  function fakeGroupsDatabase(groups: { title: string; maxSize: number; signups: number }[] = []) {
    return {
      dungeonGroup: {
        findMany: async () => groups.map((g) => ({ title: g.title, maxSize: g.maxSize, _count: { signups: g.signups } }))
      }
    };
  }

  it("recognizes open-groups questions", () => {
    expect(looksLikeOpenGroupsQuestion("any groups open?")).toBe(true);
    expect(looksLikeOpenGroupsQuestion("des groupes ouverts?")).toBe(true);
    expect(looksLikeOpenGroupsQuestion("I joined a group yesterday")).toBe(false);
  });

  it("returns null when no group is open", async () => {
    expect(await openGroupsAnswer(fakeGroupsDatabase() as never, "g1", "en")).toBeNull();
  });

  it("lists open groups with their fill", async () => {
    const answer = await openGroupsAnswer(fakeGroupsDatabase([{ title: "Deadmines", maxSize: 5, signups: 3 }]) as never, "g1", "en");
    expect(answer).toContain("Open groups:");
    expect(answer).toContain("Deadmines (3/5)");
  });
});

describe("answer channel: active-poll fast path", () => {
  function fakePollDatabase(poll: { question: string; options: string[] } | null) {
    return { poll: { findFirst: async () => poll } };
  }

  it("recognizes active-poll questions", () => {
    expect(looksLikeActivePollQuestion("any poll open?")).toBe(true);
    expect(looksLikeActivePollQuestion("un sondage en cours?")).toBe(true);
    expect(looksLikeActivePollQuestion("I voted yesterday")).toBe(false);
  });

  it("returns null when no poll is open", async () => {
    expect(await activePollAnswer(fakePollDatabase(null) as never, "g1", "en")).toBeNull();
  });

  it("shows the open poll's question and options", async () => {
    const answer = await activePollAnswer(fakePollDatabase({ question: "Which raid next?", options: ["MC", "BWL"] }) as never, "g1", "en");
    expect(answer).toBe("Open poll: Which raid next? (MC, BWL)");
  });
});

describe("answer channel: personal EPGP fast path", () => {
  function fakeEpgpDatabase(sum: { epAmount: number | null; gpAmount: number | null }) {
    return { epgpTransaction: { aggregate: async () => ({ _sum: sum }) } };
  }

  it("recognizes personal-standing questions but not the general loot-rules ones", () => {
    expect(looksLikePersonalStandingQuestion("what's my ep")).toBe(true);
    expect(looksLikePersonalStandingQuestion("combien j'ai de gp")).toBe(true);
    expect(looksLikePersonalStandingQuestion("how does epgp work")).toBe(false);
  });

  it("returns null when the member has never earned or spent any EP/GP", async () => {
    const database = fakeEpgpDatabase({ epAmount: null, gpAmount: null });
    expect(await personalStandingAnswer(database as never, "m1", 0, "en")).toBeNull();
  });

  it("reports EP, GP and PR", async () => {
    const database = fakeEpgpDatabase({ epAmount: 100, gpAmount: 50 });
    const answer = await personalStandingAnswer(database as never, "m1", 0, "en");
    expect(answer).toBe("Your EPGP: EP 100, GP 50, PR 2.00.");
  });
});

describe("answer channel: my-characters fast path", () => {
  function fakeCharactersDatabase(characters: { name: string; className: string; level: number | null; isMain: boolean }[] = []) {
    return { character: { findMany: async () => characters } };
  }

  it("recognizes my-characters questions", () => {
    expect(looksLikeMyCharactersQuestion("what are my characters")).toBe(true);
    expect(looksLikeMyCharactersQuestion("mes personnages?")).toBe(true);
    expect(looksLikeMyCharactersQuestion("that character is strong")).toBe(false);
  });

  it("returns null when the member has none linked yet", async () => {
    expect(await myCharactersAnswer(fakeCharactersDatabase() as never, "m1", "en")).toBeNull();
  });

  it("lists characters, marking the main", async () => {
    const database = fakeCharactersDatabase([
      { name: "Thrall", className: "Shaman", level: 60, isMain: true },
      { name: "Thralt", className: "Warrior", level: 45, isMain: false }
    ]);
    const answer = await myCharactersAnswer(database as never, "m1", "en");
    expect(answer).toBe("Your characters: Thrall (60 Shaman, main), Thralt (45 Warrior)");
  });
});

describe("answer channel: application-status fast path", () => {
  function fakeApplicationDatabase(application: { status: string; character: string } | null) {
    return { application: { findFirst: async () => application } };
  }

  it("recognizes application-status questions", () => {
    expect(looksLikeApplicationStatusQuestion("what's my application status")).toBe(true);
    expect(looksLikeApplicationStatusQuestion("statut de ma candidature")).toBe(true);
    expect(looksLikeApplicationStatusQuestion("that guild accepted new recruits")).toBe(false);
  });

  it("returns null when the member has never applied", async () => {
    expect(await applicationStatusAnswer(fakeApplicationDatabase(null) as never, "m1", "en")).toBeNull();
  });

  it("reports each status in plain language", async () => {
    const cases: [string, string][] = [
      ["PENDING", "still pending review"], ["APPROVED", "approved"], ["TRIAL", "on trial"], ["REJECTED", "not accepted"]
    ];
    for (const [status, expected] of cases) {
      const answer = await applicationStatusAnswer(fakeApplicationDatabase({ status, character: "Thrall" }) as never, "m1", "en");
      expect(answer).toBe(`Your application for Thrall is ${expected}.`);
    }
  });
});

describe("answer channel: bank-request fast path", () => {
  function fakeBankDatabase(request: { item: string; quantity: number; status: string; reply: string | null } | null) {
    return { bankRequest: { findFirst: async () => request } };
  }

  it("recognizes bank-request questions", () => {
    expect(looksLikeBankRequestQuestion("where's my bank request")).toBe(true);
    expect(looksLikeBankRequestQuestion("ma demande de banque")).toBe(true);
    expect(looksLikeBankRequestQuestion("the bank is closed")).toBe(false);
  });

  it("returns null when the member has never made one", async () => {
    expect(await myBankRequestAnswer(fakeBankDatabase(null) as never, "m1", "en")).toBeNull();
  });

  it("reports the status, appending the officer's reply when present", async () => {
    const database = fakeBankDatabase({ item: "Thorium Bar", quantity: 20, status: "APPROVED", reply: "Pick it up next raid." });
    const answer = await myBankRequestAnswer(database as never, "m1", "en");
    expect(answer).toBe("Your bank request for Thorium Bar x20 is approved, waiting to be handed out. Pick it up next raid.");
  });

  it("omits the trailing note when there is no reply", async () => {
    const database = fakeBankDatabase({ item: "Thorium Bar", quantity: 20, status: "PENDING", reply: null });
    const answer = await myBankRequestAnswer(database as never, "m1", "en");
    expect(answer).toBe("Your bank request for Thorium Bar x20 is waiting for an officer.");
  });
});

describe("answer channel: craft-request fast path", () => {
  function fakeCraftDatabase(request: { item: string; quantity: number; status: string } | null) {
    return { craftRequest: { findFirst: async () => request } };
  }

  it("recognizes craft-request questions", () => {
    expect(looksLikeCraftRequestQuestion("is my craft request done")).toBe(true);
    expect(looksLikeCraftRequestQuestion("ma commande d'artisanat")).toBe(true);
    expect(looksLikeCraftRequestQuestion("that craft looks great")).toBe(false);
  });

  it("returns null when the member has never made one", async () => {
    expect(await myCraftRequestAnswer(fakeCraftDatabase(null) as never, "m1", "en")).toBeNull();
  });

  it("reports the status", async () => {
    const database = fakeCraftDatabase({ item: "Arcanite Rod", quantity: 1, status: "CLAIMED" });
    const answer = await myCraftRequestAnswer(database as never, "m1", "en");
    expect(answer).toBe("Your craft request for Arcanite Rod x1 is claimed by a crafter.");
  });
});

describe("answer channel: AI answers", () => {
  it("calls an OpenAI-compatible endpoint with the guild facts and returns its text", async () => {
    let sent: { url: string; body: { model: string; messages: { role: string; content: string }[] }; auth: string | undefined } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      sent = { url, body: JSON.parse(String(init.body)), auth: (init.headers as Record<string, string>)["Authorization"] };
      return new Response(JSON.stringify({ choices: [{ message: { content: " Raid is Tuesday. " } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const messages = aiMessages("Guild: Quebec Gold.\nNext raids:\n- MC: Tuesday", "When is raid?", "Guilded", "/raid create — Create a raid.");
    const answer = await askAi({ baseUrl: "https://ai.example/v1/", model: "m", apiKey: "k" }, messages, fetchImpl);
    expect(answer).toEqual({ answer: "Raid is Tuesday." });
    expect(sent!.url).toBe("https://ai.example/v1/chat/completions");
    expect(sent!.auth).toBe("Bearer k");
    expect(sent!.body.model).toBe("m");
    expect(sent!.body.messages[0]!.content).toContain("Guild: Quebec Gold.");
    expect(sent!.body.messages[0]!.content).toContain("Do not invent commands, options, permissions");
    expect(sent!.body.messages[0]!.content).toContain("/raid create");
  });

  it("classifies provider, network and malformed-response failures for a visible fallback", async () => {
    const failing = (async () => new Response("provider details are not logged", { status: 429 })) as unknown as typeof fetch;
    expect(await askAi({ baseUrl: "http://x", model: "m" }, [], failing)).toEqual({ answer: null, failure: { kind: "http", status: 429 } });
    const empty = (async () => new Response(JSON.stringify({ choices: [] }), { status: 200 })) as unknown as typeof fetch;
    expect(await askAi({ baseUrl: "http://x", model: "m" }, [], empty)).toEqual({ answer: null, failure: { kind: "empty-response" } });
    const malformed = (async () => new Response("not json", { status: 200 })) as unknown as typeof fetch;
    expect(await askAi({ baseUrl: "http://x", model: "m" }, [], malformed)).toEqual({ answer: null, failure: { kind: "invalid-response" } });
    const throwing = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect(await askAi({ baseUrl: "http://x", model: "m" }, [], throwing)).toEqual({ answer: null, failure: { kind: "network" } });
  });
});

describe("Guilded AI product reference", () => {
  it("includes the current slash command schema and the addon help essentials", () => {
    const command = {
      name: "raid",
      toJSON: () => ({
        name: "raid",
        description: "Raids and signups",
        options: [{
          type: 1,
          name: "create",
          description: "Create a raid",
          options: [{ name: "title", description: "Raid name", required: true }]
        }]
      })
    };
    const reference = buildGuildedReference([command]);
    expect(reference).toContain("/raid — Raids and signups");
    expect(reference).toContain("/raid create — Create a raid");
    expect(reference).toContain("title (required): Raid name");
    expect(reference).toContain("/guilded help");
    expect(reference).toContain("/guilded map share on|off");
    expect(reference).toContain("/guilded lfg");
  });
});
