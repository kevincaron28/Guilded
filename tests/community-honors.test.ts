import { describe, expect, it, vi } from "vitest";
import { Collection, type Guild } from "discord.js";
import type { CommunityHonors, PrismaClient } from "@prisma/client";
import { adoptCommunityHonors, advanceCommunityHonors, honorsWeekDue, monthlyHonorsMessage, podiumPlaces, syncCommunityHonorRoles, weeklyHonorsMessage, weeklyMvps } from "../src/services/community-honors.js";

type Row = Record<string, unknown>;
const row = (userId: string, points: number) => ({ userId, points, balance: points });

describe("community honors rules", () => {
  it("gives the weekly role to everyone tied for the most points, and to nobody on a silent week", () => {
    expect(weeklyMvps([row("a", 40), row("b", 40), row("c", 10)])).toEqual(["a", "b"]);
    expect(weeklyMvps([row("a", 0)])).toEqual([]);
    expect(weeklyMvps([])).toEqual([]);
  });

  it("ranks the podium like the leaderboard: ties share a place", () => {
    expect(podiumPlaces([row("a", 50), row("b", 30), row("c", 20), row("d", 10)])).toEqual([["a"], ["b"], ["c"]]);
    expect(podiumPlaces([row("a", 50), row("b", 50), row("c", 20), row("d", 10)])).toEqual([["a", "b"], [], ["c"]]);
    expect(podiumPlaces([row("a", 5), row("b", 0)])).toEqual([["a"], [], []]);
  });

  it("announces each Monday-to-Sunday week once, in guild time", () => {
    // Monday 5 October 2026, 00:30 in Toronto: the week of 28 September is complete.
    const monday = new Date("2026-10-05T04:30:00Z");
    expect(honorsWeekDue(monday, "America/Toronto", null)).toBe("2026-09-28");
    expect(honorsWeekDue(monday, "America/Toronto", "2026-09-28")).toBeNull();
    expect(honorsWeekDue(monday, "America/Toronto", "2026-09-21")).toBe("2026-09-28");
    // Still Sunday evening in Toronto: the week is not over yet.
    expect(honorsWeekDue(new Date("2026-10-05T03:30:00Z"), "America/Toronto", "2026-09-21")).toBeNull();
  });

  it("writes the weekly post and the month's top 3 in both languages", () => {
    const recap = { points: 120, members: 3, messages: 80, reactions: 20, voiceHours: 5, activities: 2, raids: 1, bossKills: 9, dungeonRuns: 4, newMembers: 2 };
    const en = weeklyHonorsMessage("en", { week: "2026-09-28", board: [row("a", 70), row("b", 50)], mvps: ["a"], recap });
    expect(en.content).toContain("**…a**");
    expect(en.embeds[0]!.title).toContain("September 28");
    expect(JSON.stringify(en.embeds)).toContain("9 bosses down");
    const fr = weeklyHonorsMessage("fr", { week: "2026-09-28", board: [], mvps: [], recap: { ...recap, points: 0, members: 0 } });
    expect(fr.content).toBe("");
    expect(fr.embeds[0]!.description).toContain("rôle MVP reste libre");
    const month = monthlyHonorsMessage("fr", { name: "Septembre 2026", number: 3 }, [row("a", 90), row("b", 60), row("c", 30)]);
    expect(month.embeds[0]!.description).toContain("🥇 **…a** — **90 pts** · 🥇 Champion du mois");
    expect(month.embeds[0]!.title).toContain("Saison 3");
    expect(month.content).not.toContain("<@");
    // Embed and text show names, which every reader can see; no mention anywhere.
    const named = weeklyHonorsMessage("en", { week: "2026-09-28", board: [row("123456789012345678", 70), row("b", 50)], mvps: ["123456789012345678"], recap, names: new Map([["123456789012345678", "Aria Gold"]]) });
    expect(named.embeds[0]!.description).toContain("**Aria Gold**");
    expect(named.embeds[0]!.description).not.toContain("<@");
    expect(named.embeds[0]!.fields![0]!.value).toContain("**…b**");
    expect(named.content).toBe("⭐ Congratulations **Aria Gold**!");
  });
});

function fakeDatabase(honors: Row | null, data: { points?: Row[]; ended?: Row | null } = {}) {
  const jobs: Row[] = [];
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    communityHonors: {
      findUnique: vi.fn(async () => honors),
      update: vi.fn(async ({ data: changes }: { data: Row }) => Object.assign(honors!, changes))
    },
    guildSettings: { findUnique: vi.fn(async () => ({ timezone: "America/Toronto", language: "en" })) },
    communityPoint: { findMany: vi.fn(async () => data.points ?? []) },
    communityParticipationDay: { findMany: vi.fn(async () => [{ messages: 30, reactions: 4, voiceMs: 7_200_000 }]) },
    communityActivity: { count: vi.fn(async () => 1) },
    raid: { findMany: vi.fn(async () => []) },
    dungeonRun: { count: vi.fn(async () => 0) },
    member: { count: vi.fn(async () => 0) },
    communitySeason: { findFirst: vi.fn(async () => data.ended ?? null) },
    discordJob: { upsert: vi.fn(async (args: Row) => { jobs.push(args); return args; }) }
  };
  const database = { ...tx, $transaction: <T>(work: (t: typeof tx) => Promise<T>) => work(tx) };
  return { database: database as unknown as PrismaClient, tx, jobs };
}

describe("advancing the honors", () => {
  const now = new Date("2026-10-06T12:00:00Z");
  const points = [{ userId: "a", kind: "AWARD", amount: 30 }, { userId: "b", kind: "AWARD", amount: 50 }, { userId: "b", kind: "SPEND", amount: -40 }];

  it("does nothing before /setup created the honors", async () => {
    const { database, tx } = fakeDatabase(null);
    expect(await advanceCommunityHonors(database, "guild", now)).toEqual({ week: null, seasonId: null });
    expect(tx.communityPoint.findMany).not.toHaveBeenCalled();
  });

  it("moves the weekly role to the week's top earner and posts once", async () => {
    const honors: Row = { guildId: "guild", channelId: "fame", week: "2026-09-21", weeklyHolderIds: ["old"], monthSeasonId: "sept" };
    const { database, tx, jobs } = fakeDatabase(honors, { points, ended: { id: "sept" } });
    const lookup = vi.fn(async (ids: string[]) => new Map(ids.map(id => [id, `Name ${id}`])));
    expect(await advanceCommunityHonors(database, "guild", now, lookup)).toEqual({ week: "2026-09-28", seasonId: null });
    expect(lookup).toHaveBeenCalledWith(["b", "a"]);
    // Spending lottery points never lowers the earned score.
    expect(honors).toMatchObject({ week: "2026-09-28", weeklyHolderIds: ["b"], rolesPending: true });
    expect(tx.communityPoint.findMany.mock.calls[0]).toMatchObject([{ where: { season: { guildId: "guild", game: "DISCORD", audienceRoleId: null } } }]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ where: { guildId_key: { guildId: "guild", key: "community-week:2026-09-28" } }, create: { kind: "MESSAGE", payload: { channelId: "fame" } } });
    expect(JSON.stringify(jobs[0])).toContain("2 h together in voice");
    expect(JSON.stringify(jobs[0])).toContain("**Name b**");

    // The next minute finds the week already handled.
    expect(await advanceCommunityHonors(database, "guild", now)).toEqual({ week: null, seasonId: null });
    expect(jobs).toHaveLength(1);
  });

  it("frees the weekly role without a post when the whole guild was silent", async () => {
    const honors: Row = { guildId: "guild", channelId: "fame", week: "2026-09-21", weeklyHolderIds: ["old"] };
    const { database, tx, jobs } = fakeDatabase(honors);
    tx.communityParticipationDay.findMany.mockResolvedValue([]);
    tx.communityActivity.count.mockResolvedValue(0);
    await advanceCommunityHonors(database, "guild", now);
    expect(honors).toMatchObject({ weeklyHolderIds: [], rolesPending: true });
    expect(jobs).toHaveLength(0);
  });

  it("hands the podium roles to the top 3 of the season that just ended", async () => {
    const honors: Row = { guildId: "guild", channelId: "fame", week: "2026-09-28", monthSeasonId: "aug" };
    const ended = { id: "sept", name: "Septembre 2026", number: 2, finalStandings: [row("a", 90), row("b", 60), row("c", 60), row("d", 10)] };
    const { database, tx, jobs } = fakeDatabase(honors, { ended });
    expect(await advanceCommunityHonors(database, "guild", now)).toEqual({ week: null, seasonId: "sept" });
    expect(tx.communitySeason.findFirst.mock.calls[0]).toMatchObject([{ where: { game: "DISCORD", audienceRoleId: null, monthly: true, status: "ENDED" } }]);
    expect(honors).toMatchObject({ monthSeasonId: "sept", monthHolderIds: [["a"], ["b", "c"], []], rolesPending: true });
    expect(jobs[0]).toMatchObject({ where: { guildId_key: { key: "community-month:sept" } } });
  });
});

describe("syncing the roles", () => {
  function fakeGuild(holders: Record<string, string[]>) {
    const members = new Collection<string, { id: string; roles: { cache: Collection<string, unknown>; add: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> } }>();
    const roles = new Collection<string, { id: string; members: typeof members }>();
    const member = (id: string) => {
      const cache = new Collection<string, unknown>();
      const self = { id, roles: { cache,
        add: vi.fn(async (role: { id: string }) => { cache.set(role.id, role); roles.get(role.id)!.members.set(id, self); }),
        remove: vi.fn(async (role: { id: string }) => { cache.delete(role.id); roles.get(role.id)!.members.delete(id); }) } };
      members.set(id, self);
      return self;
    };
    for (const id of ["mvp", "gold", "silver", "bronze"]) roles.set(id, { id, members: new Collection() });
    for (const id of ["old", "new", "a", "b"]) member(id);
    for (const [roleId, ids] of Object.entries(holders)) for (const id of ids) { members.get(id)!.roles.cache.set(roleId, roles.get(roleId)); roles.get(roleId)!.members.set(id, members.get(id)!); }
    const guild = { members: { fetch: vi.fn(async () => members), cache: members }, roles: { cache: roles, fetch: vi.fn(async () => null) } };
    return { guild: guild as unknown as Guild, members, roles };
  }

  it("takes the role from last week's MVP and gives it to the new one", async () => {
    const { guild, members, roles } = fakeGuild({ mvp: ["old"], gold: ["a"] });
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const honors = { guildId: "guild", weeklyRoleId: "mvp", weeklyHolderIds: ["new"], monthRoleIds: ["gold", "silver", "bronze"], monthHolderIds: [["a"], ["b"], ["gone"]], updatedAt: new Date(0) } as unknown as CommunityHonors;
    await syncCommunityHonorRoles(guild, { communityHonors: { updateMany } } as unknown as PrismaClient, honors);
    expect([...roles.get("mvp")!.members.keys()]).toEqual(["new"]);
    expect(members.get("old")!.roles.remove).toHaveBeenCalledOnce();
    // The gold holder keeps the role untouched; a member who left is skipped.
    expect(members.get("a")!.roles.add).not.toHaveBeenCalled();
    expect([...roles.get("silver")!.members.keys()]).toEqual(["b"]);
    expect(roles.get("bronze")!.members.size).toBe(0);
    expect(updateMany).toHaveBeenCalledWith({ where: { guildId: "guild", updatedAt: new Date(0) }, data: { rolesPending: false } });
  });
});

describe("adopting the honors on an existing server", () => {
  function setup(record: Row | null, season: Row | null, categories: string[]) {
    const channels = new Collection(categories.map((name, i) => [`cat-${i}`, { id: `cat-${i}`, type: 4, name }]));
    const guild = { id: "discord", members: { me: null }, channels: { cache: channels, fetch: vi.fn(async () => channels) }, roles: { fetch: vi.fn(async () => undefined) } };
    const database = { guild: { findUnique: vi.fn(async () => record) }, communitySeason: { findFirst: vi.fn(async () => season) } };
    return { guild: guild as unknown as Guild, database: database as unknown as PrismaClient };
  }

  it("skips servers already done, without a public season, or with no single Community category", async () => {
    const done = setup({ id: "g", communityHonors: { guildId: "g" } }, { id: "s" }, ["Community"]);
    expect(await adoptCommunityHonors(done.guild, done.database)).toBeNull();
    const noSeason = setup({ id: "g", communityHonors: null }, null, ["Community"]);
    expect(await adoptCommunityHonors(noSeason.guild, noSeason.database)).toBeNull();
    const twice = setup({ id: "g", communityHonors: null }, { id: "s" }, ["Community", "Communauté"]);
    expect(await adoptCommunityHonors(twice.guild, twice.database)).toBeNull();
  });

  it("provisions a server whose community section is ready", async () => {
    // members.me is null in this fake, so reaching provisioning shows up as its first check.
    const ready = setup({ id: "g", communityHonors: null, settings: { language: "fr" } }, { id: "s" }, ["Communauté"]);
    await expect(adoptCommunityHonors(ready.guild, ready.database)).rejects.toThrow("Bot member unavailable");
  });
});
