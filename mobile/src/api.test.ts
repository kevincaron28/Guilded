import { afterEach, describe, expect, it, vi } from "vitest";
import { GuildedClient, apiOrigin, discordEventLink, parseGrant, parseHub, parseManage, parseStandings, withMine } from "./api";
import { notificationId, planReminders, soonRaids } from "./reminders";
import { sampleHubBody, sampleManageBody, sampleStandingsBody } from "./sample";

afterEach(() => vi.unstubAllGlobals());

describe("mobile companion client", () => {
  it("accepts the public site and a loopback bot, and refuses passwords and plain http", () => {
    expect(apiOrigin("https://guilded.kcaron.top/api/v1/hub")).toBe("https://guilded.kcaron.top");
    expect(apiOrigin("http://127.0.0.1:8787")).toBe("http://127.0.0.1:8787");
    expect(() => apiOrigin("http://guilded.example")).toThrow(/https/);
    expect(() => apiOrigin("https://user:secret@guilded.kcaron.top")).toThrow(/password/);
  });

  it("reads a guild grant and a personal grant", () => {
    expect(parseGrant({ companionCredential: "a".repeat(43), guildDiscordId: "123456789", wowGuildName: "Northwind", gameEdition: "retail" })).toMatchObject({
      personal: false, guildDiscordId: "123456789", guildName: "Northwind"
    });
    expect(parseGrant({ companionCredential: "b".repeat(43), personal: true })?.personal).toBe(true);
    expect(parseGrant({ companionCredential: "short" })).toBeNull();
  });

  it("keeps guild rank and spec from the hub, and wishlist priority from manage", () => {
    const hub = parseHub(sampleHubBody);
    expect(hub.characters.map((character) => [character.name, character.rank, character.spec])).toEqual([
      ["Aelira", "Raider", "Restoration"],
      ["Borin", "Raider", "Protection"],
      ["Cindra", null, "Frost"]
    ]);
    expect(hub.reserves.mineCount).toBe(1);
    expect(hub.reserves.writable).toBeUndefined();
    const manage = parseManage(sampleManageBody);
    expect(manage.characters[0]?.wishlist.map((wish) => wish.priority)).toEqual([1, 2]);
    const standings = parseStandings(sampleStandingsBody);
    expect(standings.nextRaid?.players).toHaveLength(2);
    expect(withMine(standings.standings, [{ name: "Aelira", realm: "Silvermoon" }]).find((row) => row.mine)?.character).toBe("Aelira-Silvermoon");
    expect(discordEventLink(standings.raids[1]?.note ?? "")).toBe("https://discord.com/events/100/200");
    expect(discordEventLink("see https://example.com/events/1/2")).toBeNull();
  });

  it("schedules a reminder an hour before, and skips a raid that is already inside that hour", () => {
    const now = Date.parse("2026-11-03T12:00:00.000Z");
    const raids = [
      { id: "past", title: "Past", at: "2026-11-03T11:00:00.000Z", core: null },
      { id: "soon", title: "Soon", at: "2026-11-03T12:20:00.000Z", core: "Thursday" },
      { id: "later", title: "Later", at: "2026-11-05T12:00:00.000Z", core: "Sunday" }
    ];
    expect(planReminders(raids, now).map((reminder) => reminder.id)).toEqual(["later"]);
    expect(planReminders(raids, now)[0]?.fireAt).toBe("2026-11-05T11:00:00.000Z");
    expect(soonRaids(raids, now).map((raid) => raid.id)).toEqual(["soon"]);
    expect(notificationId("discord:raid/1")).toBe("guilded-raid-discordraid1");
    const standings = parseStandings(sampleStandingsBody);
    expect(soonRaids(standings.raids).length + planReminders(standings.raids).length).toBe(standings.raids.length);
  });

  it("sends the companion credential to the hub and refuses a sign-in page on another site", async () => {
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(String(url).includes("/hub") ? sampleHubBody : sampleManageBody), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new GuildedClient("https://guilded.kcaron.top", "credential-value-0123456789");
    expect((await client.hub("123456")).characters[0]?.rank).toBe("Raider");
    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(String(url)).toBe("https://guilded.kcaron.top/api/v1/hub?guild=123456");
    expect(init.headers["x-companion-credential"]).toBe("credential-value-0123456789");
    await client.setWishlist("123456", "char-aelira", "Sulfuras", 1);
    const post = fetchMock.mock.calls[1] as [string, { method: string; body: string }];
    expect(post[1].method).toBe("POST");
    expect(JSON.parse(post[1].body)).toEqual({ guildDiscordId: "123456", change: { action: "wishlist.set", characterId: "char-aelira", item: "Sulfuras", priority: 1 } });

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      requestId: "r".repeat(40), confirm: "ABC-DEF", expiresAt: "2026-11-03T12:10:00.000Z", url: "https://evil.example/me/companion?request=1"
    }), { status: 200 })));
    await expect(client.startSignIn()).rejects.toThrow(/configured Guilded server/);
  });

  it("explains a missing hub instead of showing an empty character list", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Not found" }), { status: 404 })));
    await expect(new GuildedClient("https://guilded.kcaron.top", "credential-value-0123456789").hub("123")).rejects.toThrow(/guild hub/);
  });
});

import { groupSets, isNew, parseAlbum } from "./album";
import { classMix, parseBoards, parsePublicGuild } from "./publicApi";

describe("public boards and guild page", () => {
  it("reads the boards and drops malformed rows", () => {
    const boards = parseBoards({ season: "Season 1", brackets: [{ key: "60", name: "Level 60", characters: [{ rank: 1, name: "Aelira", realm: null, className: "Priest", role: "HEALER", points: 300 }, { rank: 2 }], guilds: [{ rank: 1, id: "g1", name: "Northwind", slug: "northwind", points: 900, rated: 5 }] }, { name: "no key" }] });
    expect(boards.brackets).toHaveLength(1);
    expect(boards.brackets[0]!.characters).toHaveLength(1);
    expect(boards.brackets[0]!.guilds[0]).toMatchObject({ slug: "northwind", points: 900 });
    expect(() => parseBoards(null)).toThrow();
  });

  it("reads a public guild and counts each character once in the class mix", () => {
    const guild = parsePublicGuild({ slug: "northwind", name: "Northwind", cores: [
      { name: "A", lootMode: "EPGP", roster: [{ name: "Aelira", className: "Priest", role: "HEALER" }, { name: "Borin", className: "Warrior", role: "TANK" }], ranking: [{ name: "Borin", ep: 10, gp: 5, pr: 2, belowMin: true }] },
      { name: "B", roster: [{ name: "aelira", className: "Priest", role: "HEALER" }, { name: "Cindra", className: "Mage", role: "bogus" }] }
    ] });
    expect(guild.cores[1]!.roster[1]!.role).toBe("DPS");
    expect(classMix(guild)).toEqual([{ className: "Mage", count: 1 }, { className: "Priest", count: 1 }, { className: "Warrior", count: 1 }]);
    expect(() => parsePublicGuild({})).toThrow();
  });
});

describe("badge album", () => {
  const body = { cards: [
    { id: "a", name: "First", description: "Do it.", tier: "bronze", tierLabel: "Bronze", tierColor: "#cd7f32", set: "Forever", rank: 1, threshold: 1, earnedAt: "2026-11-05T10:00:00.000Z" },
    { id: "b", name: "Second", description: "Do more.", tier: "weird", tierLabel: "", tierColor: "red", set: "Forever", rank: null, threshold: 5, earnedAt: null },
    { id: "c", name: "Guild one", description: "", tier: "gold", tierLabel: "Gold", tierColor: "#ffd100", set: "Guild", rank: null, threshold: 1, earnedAt: null },
    { name: "no id" }
  ] };

  it("reads cards, drops malformed ones and repairs an unknown tier or colour", () => {
    const album = parseAlbum(body);
    expect(album).toMatchObject({ earned: 1, total: 3 });
    expect(album.cards[1]).toMatchObject({ tier: "bronze", tierLabel: "bronze", tierColor: "#8a8a80" });
    expect(() => parseAlbum({})).toThrow();
  });

  it("groups by set with earned cards first, and can show only the unlocked ones", () => {
    const sets = groupSets(parseAlbum({ cards: [body.cards[1], body.cards[0], body.cards[2]] }).cards);
    expect(sets.map((set) => [set.name, set.earned, set.cards.map((card) => card.id)])).toEqual([["Forever", 1, ["a", "b"]], ["Guild", 0, ["c"]]]);
    expect(groupSets(parseAlbum(body).cards, true).map((set) => set.name)).toEqual(["Forever"]);
  });

  it("marks only cards earned in the last seven days as new", () => {
    const [first, second] = parseAlbum(body).cards;
    const day = 24 * 3600 * 1000, at = Date.parse(first!.earnedAt!);
    expect(isNew(first!, at + day)).toBe(true);
    expect(isNew(first!, at + 8 * day)).toBe(false);
    expect(isNew(second!, at)).toBe(false);
  });

  it("asks the signed-in route for the album with the credential", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const album = await new GuildedClient("https://guilded.kcaron.top", "c".repeat(43)).album("fr");
    expect(album.total).toBe(3);
    const call = fetchMock.mock.calls[0] as unknown as [URL, { headers: Record<string, string> }];
    expect(String(call[0])).toBe("https://guilded.kcaron.top/api/v1/companion/achievements?lang=fr");
    expect(call[1].headers["x-companion-credential"]).toBe("c".repeat(43));
  });
});
