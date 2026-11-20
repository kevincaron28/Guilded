import { describe, expect, it, vi } from "vitest";
import { armoryClientFromEnv, createArmoryClient, guildSlug, parseRoster, rosterUrl, summaryUrl } from "../src/services/blizzard-armory.js";
import { armoryRankHint, loadArmoryRosterView, syncArmoryGuild, syncAllArmoryGuilds } from "../src/services/armory-sync.js";
import { characterIdFromGuid, parsePlayerGuid } from "../src/services/guild-armory-id.js";
import { NOBODY_HIDDEN, type HiddenIdentity } from "../src/services/profile-privacy.js";
import { renderGuildPage, type GuildPageView } from "../src/services/guild-page.js";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const rosterBody = (name = "Québec Gold") => ({ guild: { name, faction: { type: "HORDE" } }, members: [
  { character: { name: "Slaiker", id: 100, level: 60, playable_class: { id: 4 }, playable_race: { id: 2 } }, rank: 0 },
  { character: { name: "Dude", id: 101, level: 42, playable_class: { id: 1 }, playable_race: { id: 1 } }, rank: 3 },
  { character: { name: "Walter", id: 102, level: 30, playable_class: { id: 2 }, playable_race: { id: 1 } }, rank: 4 },
  { character: { name: "Bad", id: "x" } }] });

function fakeFetch(handler: (url: string) => Response | undefined) {
  const urls: string[] = [];
  const fn = vi.fn(async (url: string) => {
    if (url.startsWith("https://oauth.battle.net/token")) return json({ access_token: "tok", expires_in: 3600 });
    urls.push(url);
    return handler(url) ?? json({}, 404);
  });
  return { fn: fn as unknown as (url: string, init?: RequestInit) => Promise<Response>, urls };
}
const client = (handler: (url: string) => Response | undefined) => {
  const f = fakeFetch(handler);
  return { ...f, client: createArmoryClient({ clientId: "id", clientSecret: "secret", fetch: f.fn, sleep: async () => {}, log: () => {} }) };
};

describe("Armory addressing", () => {
  it("keeps the accent, drops apostrophes, hyphenates spaces", () => {
    expect(guildSlug("Québec Gold")).toBe("québec-gold");
    expect(guildSlug("Quebec Gold")).toBe("quebec-gold");
    expect(guildSlug("  The  Knight's Watch ")).toBe("the-knights-watch");
  });
  it("uses the forever namespace and an empty realm segment, encoding the slug", () => {
    expect(rosterUrl("québec-gold")).toBe("https://us.api.blizzard.com/data/wow/guild//qu%C3%A9bec-gold/roster?namespace=profile-forever-us&locale=en_US");
    expect(summaryUrl("québec-gold")).toContain("/guild//qu%C3%A9bec-gold?namespace=profile-forever-us");
  });
});

describe("Armory client", () => {
  it("is absent without credentials", () => {
    expect(armoryClientFromEnv({})).toBeNull();
    expect(armoryClientFromEnv({ BATTLENET_CLIENT_ID: "x" })).toBeNull();
  });
  it("parses members and skips rows without a usable id", () => {
    const roster = parseRoster(rosterBody())!;
    expect(roster.guild).toEqual({ name: "Québec Gold", faction: "HORDE" });
    expect(roster.members.map((m) => m.id)).toEqual([100, 101, 102]);
    expect(roster.members[0]).toMatchObject({ name: "Slaiker", level: 60, classId: 4, raceId: 2, rank: 0 });
  });
  it("answers null on 404 and 403 without throwing, logging once", async () => {
    const log = vi.fn();
    const f = fakeFetch(() => json({}, 403));
    const c = createArmoryClient({ clientId: "id", clientSecret: "s", fetch: f.fn, sleep: async () => {}, log });
    expect(await c.fetchForeverGuildRoster("x")).toBeNull();
    expect(await c.fetchForeverGuildRoster("x")).toBeNull();
    expect(log).toHaveBeenCalledTimes(1);
    expect((await client(() => undefined).client.fetchForeverGuildSummary("x"))).toBeNull();
  });
  it("retries a 503 and then succeeds", async () => {
    let calls = 0;
    const { client: c } = client(() => (++calls === 1 ? json({}, 503) : json(rosterBody())));
    expect((await c.fetchForeverGuildRoster("québec-gold"))?.members).toHaveLength(3);
    expect(calls).toBe(2);
  });
});

// A small in-memory database for the sync and the view.
function fakeDb(addon: Record<string, unknown>[] = []) {
  const tables = { entries: [] as Record<string, unknown>[], guild: new Map<string, Record<string, unknown>>() };
  const db = {
    armoryRosterEntry: {
      deleteMany: async ({ where }: { where: { guildId: string } }) => { tables.entries = tables.entries.filter((r) => r["guildId"] !== where.guildId); },
      createMany: async ({ data }: { data: Record<string, unknown>[] }) => { tables.entries.push(...data); },
      findMany: async ({ where }: { where: { guildId: string } }) => tables.entries.filter((r) => r["guildId"] === where.guildId),
      findUnique: async ({ where }: { where: { guildId_blizzardCharacterId: { guildId: string; blizzardCharacterId: number } } }) =>
        tables.entries.find((r) => r["guildId"] === where.guildId_blizzardCharacterId.guildId && r["blizzardCharacterId"] === where.guildId_blizzardCharacterId.blizzardCharacterId) ?? null
    },
    armoryGuild: {
      upsert: async ({ where, create, update }: { where: { guildId: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => { tables.guild.set(where.guildId, { ...(tables.guild.get(where.guildId) ?? create), ...update }); },
      findUnique: async ({ where }: { where: { guildId: string } }) => tables.guild.get(where.guildId) ?? null
    },
    guildRosterEntry: { findMany: async () => addon },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops)
  };
  return { db: db as never, tables };
}
const summary = { name: "Québec Gold", faction: { type: "HORDE" }, member_count: 341, achievement_points: 1200 };
const happy = (url: string) => url.includes("/roster") ? json(rosterBody()) : json(summary);
const NOW = new Date("2026-11-20T12:00:00Z");

describe("Armory snapshot", () => {
  it("stores the roster and the summary, replacing the earlier snapshot", async () => {
    const { db, tables } = fakeDb();
    const { client: c, urls } = client(happy);
    expect(await syncArmoryGuild(db, c, "g1", "Québec Gold", NOW)).toBe("synced");
    expect(urls[0]).toContain("guild//qu%C3%A9bec-gold/roster");
    expect(tables.entries).toHaveLength(3);
    expect(tables.guild.get("g1")).toMatchObject({ wowGuildName: "Québec Gold", faction: "HORDE", memberCount: 341, achievementPoints: 1200, fetchedAt: NOW });
    await syncArmoryGuild(db, c, "g1", "Québec Gold", new Date(NOW.getTime() + 1));
    expect(tables.entries).toHaveLength(3);
  });
  it("does nothing when the guild name is unknown, the guild 404s, or another guild answers to the slug", async () => {
    const a = fakeDb();
    expect(await syncArmoryGuild(a.db, client(happy).client, "g1", null, NOW)).toBe("no-guild-name");
    expect(await syncArmoryGuild(a.db, client(() => undefined).client, "g1", "Nowhere", NOW)).toBe("not-found");
    // "Quebec Gold" (no accent) is another guild: its answer is never stored for "Québec Gold".
    expect(await syncArmoryGuild(a.db, client(() => json(rosterBody("Quebec Gold"))).client, "g1", "Québec Gold", NOW)).toBe("wrong-guild");
    expect(a.tables.entries).toHaveLength(0);
  });
  it("a whole pass is a no-op without credentials and visits only servers with a known guild name", async () => {
    const guildDb = { ...fakeDb().db, guild: { findMany: async () => [{ id: "g1" }, { id: "g2" }] },
      wowGuild: { findMany: async ({ where }: { where: { guildId: string } }) => where.guildId === "g1" ? [{ name: "Québec Gold" }] : [] },
      companionDevice: { groupBy: async () => [] } } as never;
    expect(await syncAllArmoryGuilds(guildDb, null)).toEqual({ synced: 0, skipped: 0 });
    expect(await syncAllArmoryGuilds(guildDb, client(happy).client, { sleep: async () => {}, now: () => NOW })).toEqual({ synced: 1, skipped: 0 });
  });
});

describe("GUID to Blizzard character id", () => {
  it("reads the hex low part as decimal", () => {
    expect(parsePlayerGuid("Player-4408-0A1B2C3D")).toEqual({ realmId: 4408, characterId: 169_552_957 });
    expect(characterIdFromGuid("Player-4408-0000000F")).toBe(15);
    expect(characterIdFromGuid("Player-1-ff")).toBe(255);
  });
  it("refuses anything that is not a player GUID or does not fit", () => {
    for (const bad of ["Creature-0-1-2-3-4-5", "Player-1", "Player-1-xyz", "Player-1-0", "Player-1-FFFFFFFFFFFF", "", null, 5]) expect(characterIdFromGuid(bad)).toBeNull();
  });
});

const addonRow = (over: Record<string, unknown>) => ({ name: "Dude Lebowski", level: 50, className: "WARRIOR", rankName: "Veteran", rankIndex: 3, blizzardCharacterId: null, ...over });

describe("website roster from the Armory", () => {
  it("ties a row to an addon character only through the Blizzard character id; a same first name, level and class is NOT linked", async () => {
    const { db } = fakeDb([
      addonRow({ name: "Slaiker Moonbrook", level: 60, className: "ROGUE", rankName: "Guild Master", rankIndex: 0, blizzardCharacterId: 100 }),
      // Same first name, same level and class as Armory "Dude" (101) but no GUID known: stays Armory-only.
      addonRow({ name: "Dude Lebowski", level: 42, className: "WARRIOR", blizzardCharacterId: null })]);
    await syncArmoryGuild(db, client(happy).client, "g1", "Québec Gold", NOW);
    const view = (await loadArmoryRosterView(db, "g1", NOBODY_HIDDEN))!;
    const byName = (name: string) => view.rows.find((r) => r.name === name);
    expect(byName("Slaiker Moonbrook")).toMatchObject({ source: "addon", level: 60, className: "Rogue", rankLabel: "Guild Master" });
    expect(byName("Dude")).toMatchObject({ source: "armory", level: 42, className: "Warrior", rankLabel: "Veteran" });
    expect(view.rows.some((r) => r.name === "Dude Lebowski")).toBe(false);
    expect(byName("Walter")).toMatchObject({ source: "armory", rankLabel: "Rank 4" });
    expect(view.linked).toBe(1);
    expect(view.memberCount).toBe(341);
  });
  it("the addon's values win on a linked row, and a wrong first name refuses the id match", async () => {
    const { db } = fakeDb([addonRow({ name: "Dude Lebowski", level: 55, className: "WARRIOR", rankName: "Officer", rankIndex: 1, blizzardCharacterId: 101 }),
      addonRow({ name: "Someone Else", blizzardCharacterId: 102 })]);
    await syncArmoryGuild(db, client(happy).client, "g1", "Québec Gold", NOW);
    const view = (await loadArmoryRosterView(db, "g1", NOBODY_HIDDEN))!;
    expect(view.rows.find((r) => r.name === "Dude Lebowski")).toMatchObject({ level: 55, rankLabel: "Officer", source: "addon" });
    expect(view.rows.find((r) => r.name === "Walter")?.source).toBe("armory");
    expect(view.rows.some((r) => r.name === "Someone Else")).toBe(false);
  });
  it("leaves out hidden members, by first name for Armory-only rows", async () => {
    const { db } = fakeDb([]);
    await syncArmoryGuild(db, client(happy).client, "g1", "Québec Gold", NOW);
    const hidden: HiddenIdentity = { users: new Set(["u"]), keys: new Set(["dude lebowski|"]), firsts: new Set(["dude|"]), names: new Set(["dude lebowski", "dude|"]), blankRealm: new Set(["dude lebowski", "dude|"]) };
    const view = (await loadArmoryRosterView(db, "g1", hidden))!;
    expect(view.rows.map((r) => r.name).sort()).toEqual(["Slaiker", "Walter"]);
  });
  it("is null before any sync; the rank hint is read by id only", async () => {
    const { db } = fakeDb();
    expect(await loadArmoryRosterView(db, "g1", NOBODY_HIDDEN)).toBeNull();
    await syncArmoryGuild(db, client(happy).client, "g1", "Québec Gold", NOW);
    expect(await armoryRankHint(db, "g1", 101)).toBe(3);
    expect(await armoryRankHint(db, "g1", null)).toBeNull();
    expect(await armoryRankHint(db, "g1", 999)).toBeNull();
  });
  it("renders the roster with the Armory note, the update time and the Armory-only tag, escaped", () => {
    const base: GuildPageView = { slug: "qg", name: "Québec Gold", language: "en", indexable: true, intro: null, sections: ["rosters"], cores: [], recruitment: null };
    const armory = { fetchedAt: NOW, memberCount: 341, faction: "HORDE", achievementPoints: null, linked: 1, rows: [
      { name: "Slaiker Moonbrook", level: 60, className: "Rogue", rank: 0, rankLabel: "Guild Master", source: "addon" as const },
      { name: "<b>Dude</b>", level: 42, className: "Warrior", rank: 3, rankLabel: "Rank 3", source: "armory" as const }] };
    const html = renderGuildPage({ ...base, armory });
    expect(html).toContain("341 members. Updated 2026-11-20 12:00 UTC from the Blizzard Armory.");
    expect(html).toContain("Slaiker Moonbrook</td>");
    expect(html).toContain("&lt;b&gt;Dude&lt;/b&gt; <span class=\"tag\">from the Armory</span>");
    expect(renderGuildPage({ ...base, language: "fr", armory })).toContain("Mis à jour le 2026-11-20 12:00 UTC à partir de l'Armurerie Blizzard.");
    expect(renderGuildPage({ ...base, sections: ["cores"], armory })).not.toContain("Blizzard Armory");
  });
});
