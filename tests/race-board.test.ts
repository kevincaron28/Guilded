import { describe, expect, it, vi } from "vitest";

vi.mock("../src/database.js", () => ({ prisma: {} }));
vi.mock("../src/services/guild.js", () => ({ createGuildService: () => ({}) }));
import { LEVEL_CAP, RACE_BOARD_MARKER, bestName, refreshHallNames, clampTop, hallEmbed, hallMode, loadRaceBoardData, nearLevel, nextEntry, orderRace, raceBoardEmbed, raceCard, syncHallOfFame, weekStart, type RaceBoardData, type RaceRow } from "../src/services/race-board.js";
import { bgLadderEmbed, bgLadders, BG_LADDER_MARKER } from "../src/services/bg-ladder.js";
import { ensurePvpModule, pvpChannelNames } from "../src/services/battleground-setup.js";

const row = (name: string, level: number, over: Partial<RaceRow> = {}): RaceRow => ({ key: name.toLowerCase(), name, className: "Mage", race: "Human", level, reachedMaxAt: null, firstSeenAt: new Date("2026-11-04T12:00:00Z"), weekGain: 0, memberId: null, discordId: null, professions: [], lastSeenAt: null, ...over });
const data = (rows: RaceRow[]): RaceBoardData => ({ rows, total: rows.length, finished: rows.filter(r => r.level >= LEVEL_CAP).length, edition: "forever" });

describe("race to 60 state", () => {
  const wed = new Date("2026-11-11T12:00:00Z"); // a Wednesday
  it("weeks start on Monday 00:00 UTC", () => {
    expect(weekStart(wed).toISOString()).toBe("2026-11-09T00:00:00.000Z");
    expect(weekStart(new Date("2026-11-15T23:59:00Z")).toISOString()).toBe("2026-11-09T00:00:00.000Z");
  });
  it("starts a new character at its level with no gain", () => {
    expect(nextEntry(null, 12, wed)).toEqual({ level: 12, reachedMaxAt: null, weekStartLevel: 12, weekStartedAt: weekStart(wed) });
  });
  it("records the moment a character reaches the cap, once", () => {
    const before = { level: 59, reachedMaxAt: null, weekStartLevel: 55, weekStartedAt: weekStart(wed) };
    const hit = nextEntry(before, 60, wed);
    expect(hit.reachedMaxAt).toEqual(wed);
    expect(nextEntry(hit, 60, new Date("2026-11-12T00:00:00Z")).reachedMaxAt).toEqual(wed);
  });
  it("rolls the weekly baseline on a new week and keeps it within a week", () => {
    const prev = { level: 30, reachedMaxAt: null, weekStartLevel: 20, weekStartedAt: new Date("2026-11-02T00:00:00Z") };
    expect(nextEntry(prev, 33, wed)).toMatchObject({ level: 33, weekStartLevel: 30 });
    expect(nextEntry({ ...prev, weekStartedAt: weekStart(wed) }, 33, wed)).toMatchObject({ weekStartLevel: 20 });
  });
  it("restarts the history when a name comes back at a lower level", () => {
    const prev = { level: 60, reachedMaxAt: wed, weekStartLevel: 58, weekStartedAt: weekStart(wed) };
    expect(nextEntry(prev, 4, wed)).toMatchObject({ level: 4, reachedMaxAt: null, weekStartLevel: 4 });
  });
  it("orders finishers by arrival, then racers by level", () => {
    const rows = [row("Low", 10), row("Late", 60, { reachedMaxAt: new Date("2026-11-08T00:00:00Z") }), row("Early", 60, { reachedMaxAt: new Date("2026-11-06T00:00:00Z") }), row("High", 59)];
    expect(orderRace(rows).map(r => r.name)).toEqual(["Early", "Late", "High", "Low"]);
  });
  it("finds partners near a level, skipping own characters and finished ones", () => {
    const rows = [row("Own", 30), row("Near", 31), row("Far", 50), row("Done", 60), row("Close", 30)];
    expect(nearLevel(rows, 30, new Set(["own"])).map(r => r.name)).toEqual(["Close", "Near"]);
  });
});

describe("race board embed and card", () => {
  it("has English and French empty states and the marker", () => {
    expect(raceBoardEmbed(data([]), "en", "g1").toJSON().description).toContain("No levelled character");
    const fr = raceBoardEmbed(data([]), "fr", "g1").toJSON();
    expect(fr.title).toBe("🏁 Course au niveau 60");
    expect(fr.footer?.text?.startsWith(`${RACE_BOARD_MARKER} • g1 •`)).toBe(true);
  });
  it("lists the top characters with class, race, level bar, professions, last seen and the linked member", () => {
    const rows = [row("Aria", 60, { reachedMaxAt: new Date("2026-11-06T12:00:00Z"), weekGain: 4, discordId: "42" }),
      row("Brom", 41, { weekGain: 9, professions: ["Mining 300", "Herbalism 225", "Cooking 100"], lastSeenAt: new Date("2026-11-06T10:00:00Z") }), row("Cy", 20)];
    const json = raceBoardEmbed(data(rows), "en", "g1", { image: "race.png" }).toJSON();
    expect(json.description).toContain("Top **3** of **3** characters");
    expect(json.description).toContain("**1.** Aria · Mage Human · **60** ✅ <t:1793966400:d> · <@42>");
    expect(json.description).toContain("**2.** Brom · Mage Human · **41** ▰▰▰▰▰▱▱▱ 68% · Mining 300, Herbalism 225 · seen <t:1793959200:R>");
    expect(json.description).not.toContain("Cooking");
    expect(json.fields?.map(f => f.name)).toEqual(["Most levels this week", "Level 60"]);
    expect(json.fields?.[0]?.value).toBe("Brom +9\nAria +4");
    expect(json.image?.url).toBe("attachment://race.png");
  });
  it("lists only the top N, escapes markdown and stays inside the embed limit", () => {
    const many = Array.from({ length: 40 }, (_, i) => row(i === 0 ? "**Bold**" : `Player${i}`, 59 - i, { professions: ["Alchemy 300", "Herbalism 300"], discordId: "123456789012345678", lastSeenAt: new Date("2026-11-06T10:00:00Z") }));
    const json = raceBoardEmbed(data(many), "en", "g1", { top: 25 }).toJSON();
    expect(json.description?.split("\n").filter(line => /^\*\*\d+\./.test(line))).toHaveLength(25);
    expect(json.description).toContain("Top **25** of **40**");
    expect(json.description).toContain("\\*\\*Bold\\*\\*");
    expect(json.description!.length).toBeLessThanOrEqual(4096);
  });
  it("clamps the officer setting to 10-30", () => {
    expect([clampTop(5), clampTop(25), clampTop(99), clampTop(undefined)]).toEqual([10, 25, 30, 25]);
  });
  it("switches to Hall of Fame mode when the race ends or everyone is at 60", () => {
    const done = data([row("A", 60), row("B", 60), row("C", 60)]);
    expect(hallMode(done, false)).toBe(true);
    expect(hallMode(data([row("A", 60), row("B", 30), row("C", 12)]), false)).toBe(false);
    expect(hallMode(data([row("A", 60), row("B", 30), row("C", 12)]), true)).toBe(true);
    const json = raceBoardEmbed(data([row("Late", 60, { reachedMaxAt: new Date("2026-11-08T00:00:00Z") }), row("Early", 60, { reachedMaxAt: new Date("2026-11-06T00:00:00Z") }), row("Racer", 30)]), "fr", "g1", { hall: true }).toJSON();
    expect(json.title).toContain("Temple de la renommée");
    expect(json.description!.indexOf("Early")).toBeLessThan(json.description!.indexOf("Late"));
    expect(json.description).not.toContain("Racer");
  });
  it("draws at most 14 class-coloured bars", () => {
    const card = raceCard(data(Array.from({ length: 20 }, (_, i) => row(`P${i}`, 50 - i, { weekGain: i === 0 ? 3 : 0 }))), "fr");
    expect(card.race).toHaveLength(14);
    expect(card.race?.[0]).toMatchObject({ color: "#69ccf0", level: 50, max: 60, note: "+3 sem." });
    expect(card.title).toBe("Course au niveau 60");
  });
});

describe("race board data", () => {
  it("counts linked and unlinked characters once, skips hidden members, and stores first sightings", async () => {
    const upsert = vi.fn();
    const db = {
      character: { findMany: vi.fn()
        .mockResolvedValueOnce([{ name: "Aria Stone", realm: "Realm", className: "Mage", race: "Human", level: 60, memberId: "m1", lastSeenAt: null, member: { discordUserId: "42" }, professions: [{ profession: "Mining", skillLevel: 300 }] }])
        .mockResolvedValueOnce([{ name: "Secret One", realm: "Realm" }]) },
      unclaimedCharacter: { findMany: vi.fn(async () => [
        { nameKey: "aria stone", name: "Aria Stone", className: "Mage", level: 58 },
        { nameKey: "bob smith", name: "Bob Smith", className: "Rogue", level: 33 }]) },
      levelRaceEntry: { findMany: vi.fn(async () => []), upsert }
    };
    const result = await loadRaceBoardData(db as never, "g1", "forever", new Date("2026-11-11T12:00:00Z"));
    expect(result.total).toBe(result.rows.length);
    expect(result.rows.filter(r => r.name === "Aria Stone")).toHaveLength(1);
    expect(result.rows.find(r => r.name === "Aria Stone")?.level).toBe(60);
    expect(result.finished).toBe(1);
    expect(upsert).toHaveBeenCalledTimes(result.total);
  });
});

describe("full names on the board (Forever, 8.4.x addons still upload first names)", () => {
  it("shows the display name when it is the stored first name plus a last name, and never invents one", () => {
    expect(bestName("Chad", "Chad Ho")).toBe("Chad Ho");
    expect(bestName("Chad", null)).toBe("Chad");
    expect(bestName("Chad", "Somebody Else")).toBe("Chad");
    expect(bestName("Chad Ho", "Chad Ho")).toBe("Chad Ho");
    expect(bestName("Chad", null, "Chad Ho")).toBe("Chad Ho");
  });
  it("loads a first-name LevelRaceEntry under its full display name, linked or unclaimed, keeping the key", async () => {
    const upsert = vi.fn();
    const db = {
      character: { findMany: vi.fn()
        .mockResolvedValueOnce([{ name: "Domichammon", displayName: "Domichammon Graves", realm: "Realm", className: "Mage", race: "Human", level: 41, memberId: "m1", lastSeenAt: null, member: { discordUserId: "42" }, professions: [] },
          { name: "Lebowski", displayName: null, realm: "Realm", className: "Rogue", race: "Human", level: 33, memberId: "m2", lastSeenAt: null, member: { discordUserId: "43" }, professions: [] }])
        .mockResolvedValueOnce([]) },
      unclaimedCharacter: { findMany: vi.fn(async () => [
        { nameKey: "chad", name: "Chad", displayName: "Chad Ho", className: "Priest", level: 20 },
        { nameKey: "lebowski", name: "Lebowski", displayName: "Lebowski Dude", className: "Rogue", level: 30 }]) },
      levelRaceEntry: { findMany: vi.fn(async () => [{ nameKey: "chad", name: "Chad", className: "Priest", level: 20, reachedMaxAt: null, weekStartLevel: 20, weekStartedAt: new Date("2026-11-09T00:00:00Z"), firstSeenAt: new Date("2026-11-05T00:00:00Z") }]), upsert }
    };
    const result = await loadRaceBoardData(db as never, "g1", "forever", new Date("2026-11-11T12:00:00Z"));
    const byKey = new Map(result.rows.map(r => [r.key, r.name]));
    expect(byKey.get("chad")).toBe("Chad Ho");
    expect(byKey.get("lebowski")).toBe("Lebowski Dude");
    const keys = [...byKey.keys()];
    expect(keys.some(key => key.includes(" "))).toBe(false);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ name: "Chad Ho" }) }));
  });
  it("edits an already posted Hall of Fame entry and the backfill summary to the full name, once known", async () => {
    const at = new Date("2026-11-12T12:00:00Z");
    const entries = [
      { id: "e1", nameKey: "hulke", order: 1, name: "Hulke", className: "Warrior", race: "Human", reachedAt: at, firstSeenAt: at, professions: null, memberDiscordId: null, posted: true, backfilled: true, messageId: null },
      { id: "e2", nameKey: "chad", order: 2, name: "Chad", className: "Priest", race: "Human", reachedAt: at, firstSeenAt: at, professions: null, memberDiscordId: null, posted: true, backfilled: false, messageId: "m-chad" },
      { id: "e3", nameKey: "already", order: 3, name: "Already Full", className: "Mage", race: null, reachedAt: at, firstSeenAt: at, professions: null, memberDiscordId: null, posted: true, backfilled: false, messageId: "m-a" }];
    const edit = vi.fn(async () => ({}));
    const summaryEdit = vi.fn(async () => ({}));
    const channel = { send: vi.fn(), messages: { fetch: vi.fn(async (arg: unknown) => arg === "m-chad" ? { id: "m-chad", edit }
      : new Map([["s1", { id: "s1", embeds: [{ footer: { text: "Guilded hall of fame • g1 • summary" } }], edit: summaryEdit }]])) } };
    const db = { raceHallEntry: { update: vi.fn(async () => ({})) } };
    const rows = [row("Hulke Hogan", 60, { key: "hulke" }), row("Chad Ho", 60, { key: "chad" }), row("Already Full", 60, { key: "already" })];
    expect(await refreshHallNames(db as never, channel as never, "g1", entries, rows, "en")).toBe(2);
    expect(edit).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(edit.mock.calls[0])).toContain("Chad Ho");
    expect(summaryEdit).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(summaryEdit.mock.calls[0])).toContain("Hulke Hogan");
    expect(db.raceHallEntry.update).toHaveBeenCalledWith({ where: { id: "e2" }, data: { name: "Chad Ho" } });
    expect(db.raceHallEntry.update).toHaveBeenCalledWith({ where: { id: "e1" }, data: { name: "Hulke Hogan" } });
    // nothing left to change: a second pass edits nothing
    expect(await refreshHallNames(db as never, channel as never, "g1", entries, rows, "en")).toBe(0);
  });
  it("keeps the old name when the edit fails, so the next refresh retries", async () => {
    const at = new Date("2026-11-12T12:00:00Z");
    const entries = [{ id: "e2", nameKey: "chad", order: 2, name: "Chad", className: "Priest", race: null, reachedAt: at, firstSeenAt: at, professions: null, memberDiscordId: null, posted: true, backfilled: false, messageId: "m-chad" }];
    const channel = { send: vi.fn(), messages: { fetch: vi.fn(async () => ({ id: "m-chad", edit: vi.fn(async () => { throw new Error("rate limited"); }) })) } };
    const db = { raceHallEntry: { update: vi.fn(async () => ({})) } };
    expect(await refreshHallNames(db as never, channel as never, "g1", entries, [row("Chad Ho", 60, { key: "chad" })], "en")).toBe(0);
    expect(db.raceHallEntry.update).not.toHaveBeenCalled();
  });
});

describe("PvP channels", () => {
  it("adopts the battleground names and the new PvP names in both languages", () => {
    expect(pvpChannelNames("stats")).toEqual(["battleground-statistics", "statistiques-jcj", "pvp-ladder", "classement-pvp"]);
    expect(pvpChannelNames("groups")).toContain("pvp-groups");
  });
  it("does nothing for a server that has not switched the module on", async () => {
    const db = { guildSettings: { findUnique: vi.fn(async () => ({ pvpModuleEnabled: false })) } };
    await expect(ensurePvpModule({} as never, db as never, "g1", "en", "u1")).resolves.toBe("");
  });
});

describe("on by default (owner decision, 6 November 2026)", () => {
  it("declares the 8.5 switches on in the schema and migration", async () => {
    const { readFileSync } = await import("node:fs");
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    for (const field of ["raceBoardEnabled", "pvpModuleEnabled", "duelBoardEnabled"]) {
      const line = schema.split("\n").find(text => text.trim().startsWith(`${field} `));
      expect(line, field).toContain("@default(true)");
    }
    const sql = readFileSync("prisma/migrations/20261219000000_race_board_pvp_channels/migration.sql", "utf8");
    expect(sql).toContain('"raceBoardEnabled" BOOLEAN NOT NULL DEFAULT true');
    expect(sql).toContain('"pvpModuleEnabled" BOOLEAN NOT NULL DEFAULT true');
  });
});

describe("Hall of Fame", () => {
  const at = new Date("2026-11-12T12:00:00Z");
  const hallDb = (existing: unknown[] = [], milestones: unknown[] = []) => {
    const created: Record<string, unknown>[] = [];
    return { created, db: {
      raceHallEntry: { findMany: vi.fn(async () => existing),
        create: vi.fn(async ({ data: entry }: { data: Record<string, unknown> }) => { created.push(entry); return { id: `e${created.length}`, ...entry }; }),
        update: vi.fn(async () => ({})) },
      memberMilestone: { findMany: vi.fn(async () => milestones) }
    } };
  };
  const channel = () => ({ send: vi.fn(async () => ({ id: "msg" })) });

  it("posts one permanent message with the order number, class, race, date, days in guild, professions and member", () => {
    const json = hallEmbed({ order: 7, name: "Aria Stone", className: "Mage", race: "Human", reachedAt: new Date("2026-11-11T00:00:00Z"), firstSeenAt: new Date("2026-11-04T00:00:00Z"), professions: "Mining 300", memberDiscordId: "42" }, "en", "g1", "aria stone").toJSON();
    expect(json.title).toBe("🏆 #7 to reach 60");
    expect(json.description).toContain("Mage Human");
    expect(json.description).toContain("7 days after first being seen");
    expect(json.description).toContain("Mining 300");
    expect(json.description).toContain("<@42>");
    expect(json.footer?.text).toBe("Guilded hall of fame • g1 • aria stone");
    expect(hallEmbed({ order: 2, name: "A", className: "Mage", race: null, reachedAt: at, firstSeenAt: at, professions: null, memberDiscordId: null }, "fr").toJSON().title).toBe("🏆 N° 2 à atteindre le niveau 60");
  });
  it("on the first run stores every 60 in milestone-date order and posts ONE summary, never one message each", async () => {
    const { db, created } = hallDb([], [{ memberId: "m2", reachedAt: new Date("2026-11-05T00:00:00Z") }, { memberId: "m1", reachedAt: new Date("2026-11-08T00:00:00Z") }]);
    const ch = channel();
    const board = data([row("Late", 60, { memberId: "m1", reachedMaxAt: at }), row("Early", 60, { memberId: "m2", reachedMaxAt: at }), row("Racer", 30)]);
    const result = await syncHallOfFame(db as never, ch, "g1", board, "en", null, at);
    expect(result).toEqual({ markBackfilled: true, posted: 1 });
    expect(ch.send).toHaveBeenCalledTimes(1);
    expect(created.map(entry => [entry["name"], entry["order"], entry["backfilled"], entry["posted"]])).toEqual([["Early", 1, true, true], ["Late", 2, true, true]]);
  });
  it("marks the backfill done even when nobody is at 60 yet, so the first 60 later gets its own post", async () => {
    const { db } = hallDb();
    const ch = channel();
    expect(await syncHallOfFame(db as never, ch, "g1", data([row("Racer", 30)]), "en", null, at)).toEqual({ markBackfilled: true, posted: 0 });
    expect(ch.send).not.toHaveBeenCalled();
  });
  it("after the backfill, a new 60 gets the next number and exactly one post; known ones are skipped", async () => {
    const { db, created } = hallDb([{ id: "e0", nameKey: "early", order: 1, posted: true, backfilled: true }]);
    const ch = channel();
    const board = data([row("Early", 60), row("Newbie", 60, { reachedMaxAt: at, professions: ["Mining 300"] })]);
    const result = await syncHallOfFame(db as never, ch, "g1", board, "en", new Date("2026-11-10T00:00:00Z"), at);
    expect(result.posted).toBe(1);
    expect(ch.send).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ name: "Newbie", order: 2, professions: "Mining 300" });
    expect(db.raceHallEntry.update).toHaveBeenCalledWith({ where: { id: "e1" }, data: { posted: true, messageId: "msg" } });
  });
  it("retries an entry whose post failed, without creating a second row", async () => {
    const { db, created } = hallDb([{ id: "e1", nameKey: "newbie", order: 1, name: "Newbie", className: "Mage", race: null, reachedAt: at, firstSeenAt: at, professions: null, memberDiscordId: null, posted: false, backfilled: false }]);
    const ch = channel();
    const result = await syncHallOfFame(db as never, ch, "g1", data([row("Newbie", 60, { reachedMaxAt: at })]), "en", at, at);
    expect(result.posted).toBe(1);
    expect(created).toHaveLength(0);
  });
  it("leaves a number to another refresh when the database refuses a duplicate claim", async () => {
    const { db } = hallDb();
    db.raceHallEntry.create.mockRejectedValueOnce(new Error("unique"));
    const ch = channel();
    expect((await syncHallOfFame(db as never, ch, "g1", data([row("Newbie", 60, { reachedMaxAt: at })]), "en", at, at)).posted).toBe(0);
    expect(ch.send).not.toHaveBeenCalled();
  });
});

describe("battleground ladder (separate from the duel ladder)", () => {
  const names = new Map([["a", "Aria"], ["b", "Brom"]]);
  const group = (memberId: string, outcome: string, count: number, bracket = "10-19", mode = "casual") => ({ memberId, mode, bracket, outcome, _count: { _all: count } });
  it("ranks per mode and bracket by wins, then win rate, with games, losses and draws", () => {
    const ladders = bgLadders([group("a", "win", 3), group("a", "loss", 1), group("b", "win", 3), group("b", "draw", 1), group("b", "win", 2, "20-29", "rated")], names);
    expect(ladders.map(l => `${l.mode}/${l.bracket}`)).toEqual(["casual/10-19", "rated/20-29"]);
    expect(ladders[0]!.standings.map(p => [p.name, p.wins, p.losses, p.draws, p.games])).toEqual([["Aria", 3, 1, 0, 4], ["Brom", 3, 0, 1, 4]]);
  });
  it("labels the board as player reports, shows the French empty state and carries the marker", () => {
    const empty = bgLadderEmbed({ brackets: [], participations: 0, edition: "forever" }, "fr", "g1").toJSON();
    expect(empty.title).toBe("🏴 Classement des champs de bataille");
    expect(empty.footer?.text?.startsWith(`${BG_LADDER_MARKER} • g1 •`)).toBe(true);
    const json = bgLadderEmbed({ brackets: bgLadders([group("a", "win", 2)], names), participations: 2, edition: "forever" }, "en", "g1").toJSON();
    expect(json.fields?.[0]).toMatchObject({ name: "casual · 10-19" });
    expect(json.fields?.[0]?.value).toContain("🥇 Aria — 2W 0L · 100% · 2 games");
    expect(json.footer?.text).toContain("player reports, not verified matches");
    expect(json.footer?.text).toContain("separate from the duel ladder");
  });
});
