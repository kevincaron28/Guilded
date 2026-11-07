import { describe, expect, it, vi } from "vitest";

vi.mock("../src/database.js", () => ({ prisma: {} }));
vi.mock("../src/services/guild.js", () => ({ createGuildService: () => ({}) }));
import { LEVEL_CAP, RACE_BOARD_MARKER, bestName, dedupeHallEntries, mergeFirstNames, mergeStored, refreshHallNames, clampTop, hallEmbed, hallMode, loadRaceBoardData, nearLevel, nextEntry, orderRace, raceBoardEmbed, raceCard, syncHallOfFame, weekStart, type RaceBoardData, type RaceRow } from "../src/services/race-board.js";
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
    expect(json.description).toContain("Top **3** of **3** characters on the card");
    expect(json.description).toContain("**1.** [Aria](<https://worldofwarcraft.blizzard.com/en-us/forever/us/armory?q=Aria>) · Mage Human · **60** ✅ <t:1793966400:d> · <@42>");
    expect(json.description).toContain("**2.** [Brom](<https://worldofwarcraft.blizzard.com/en-us/forever/us/armory?q=Brom>) · Mage Human · **41** ▰▰▰▰▰▱▱▱ 68% · Mining 300, Herbalism 225 · seen <t:1793959200:R>");
    expect(json.description).not.toContain("Cooking");
    expect(json.fields ?? []).toHaveLength(0); // the card carries the weekly gains
    expect(json.image?.url).toBe("attachment://race.png");
    // without a card (drawing busy) the embed falls back to the full list, gains and count
    const plain = raceBoardEmbed(data(rows), "en", "g1").toJSON();
    expect(plain.fields?.map(f => f.name)).toEqual(["Most levels this week", "Level 60"]);
    expect(plain.fields?.[0]?.value).toBe("Brom +9\nAria +4");
  });
  it("lists only the top N, escapes markdown and stays inside the embed limit", () => {
    const many = Array.from({ length: 40 }, (_, i) => row(i === 0 ? "**Bold**" : `Player${i}`, 59 - i, { professions: ["Alchemy 300", "Herbalism 300"], discordId: "123456789012345678", lastSeenAt: new Date("2026-11-06T10:00:00Z") }));
    const json = raceBoardEmbed(data(many), "en", "g1", { top: 25 }).toJSON();
    expect(json.description?.split("\n").filter(line => /^\*\*\d+\./.test(line))).toHaveLength(25);
    expect(json.description).toContain("Top **25** of **40**");
    // with the card the embed stays short: the three leaders only
    const short = raceBoardEmbed(data(many), "en", "g1", { top: 25, image: "race.png" }).toJSON();
    expect(short.description?.split("\n").filter(line => /^\*\*\d+\./.test(line))).toHaveLength(3);
    expect(short.description).toContain("Top **25** of **40**");
    expect(json.description).toContain("\\*\\*Bold\\*\\*");
    expect(json.description!.length).toBeLessThanOrEqual(4096);
  });
  it("clamps the officer setting to 10-30", () => {
    expect([clampTop(5), clampTop(25), clampTop(99), clampTop(undefined)]).toEqual([10, 25, 50, 50]);
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
  it("draws the top N (50 by default) in the ladder layout: class colour, class, race and Discord member, level bar and week gain", () => {
    const rows = Array.from({ length: 64 }, (_, i) => row(`Player Number${i}`, 59 - Math.floor(i / 2), { weekGain: i === 0 ? 3 : 0, ...(i === 0 ? { discordId: "42" } : {}) }));
    const card = raceCard(data(rows), "fr", 25, new Map([["42", "Kev"]]), new Date("2026-11-07T14:05:00Z"));
    const ladderRows = card.ladder!.boards[0]!.rows;
    expect(ladderRows).toHaveLength(25);
    expect(ladderRows[0]).toMatchObject({ rank: 1, name: "Player Number0", color: "#69ccf0", values: ["", "59", "+3", ""], bar: { value: 59, max: 60 }, sub: "Mage · Human · @Kev" });
    expect(ladderRows[1]!.values[2]).toBe("");
    expect(ladderRows[0]).not.toHaveProperty("move");
    expect(card.ladder!.columns.map(column => column.label)).toEqual(["Progression", "Niv.", "Sem."]);
    // With yesterday's ranks, a "24 h" arrow column appears: up, down, unchanged or new.
    const moves = new Map<string, number | "new">([["player number0", 2], ["player number1", -1], ["player number2", 0], ["player number3", "new"]]);
    const moved = raceCard(data(rows), "fr", 25, new Map(), new Date("2026-11-07T14:05:00Z"), moves);
    expect(moved.ladder!.columns.map(column => column.label)).toEqual(["Progression", "Niv.", "Sem.", "24 h"]);
    expect(moved.ladder!.boards[0]!.rows.slice(0, 4).map(r => [r.move, r.moveLabel])).toEqual([[2, "2"], [-1, "1"], [0, "0"], ["new", "nouv."]]);
    expect(card.ladder!.meta).toBe("Mis à jour 2026-11-07 14:05 UTC");
    expect(raceCard(data(rows), "en", 12).ladder!.boards[0]!.rows).toHaveLength(12);
    expect(raceCard(data(rows), "en").ladder!.boards[0]!.rows).toHaveLength(50);
    expect(raceCard(data(rows), "en", 99).ladder!.boards[0]!.rows).toHaveLength(50);
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
  it("loads a first-name LevelRaceEntry under its full display name and full-name key, linked or unclaimed", async () => {
    const upsert = vi.fn();
    const db = {
      character: { findMany: vi.fn()
        .mockResolvedValueOnce([{ name: "Domichammon", displayName: "Domichammon Graves", realm: "Realm", className: "Mage", race: "Human", level: 41, memberId: "m1", lastSeenAt: null, member: { discordUserId: "42" }, professions: [] },
          { name: "Lebowski", displayName: null, realm: "Realm", className: "Rogue", race: "Human", level: 33, memberId: "m2", lastSeenAt: null, member: { discordUserId: "43" }, professions: [] }])
        .mockResolvedValueOnce([]) },
      unclaimedCharacter: { findMany: vi.fn(async () => [
        { nameKey: "chad", name: "Chad", displayName: "Chad Ho", className: "Priest", level: 20 },
        { nameKey: "lebowski", name: "Lebowski", displayName: "Lebowski Dude", className: "Rogue", level: 30 }]) },
      levelRaceEntry: { findMany: vi.fn(async () => [{ nameKey: "chad", name: "Chad", className: "Priest", level: 20, reachedMaxAt: null, weekStartLevel: 20, weekStartedAt: new Date("2026-11-09T00:00:00Z"), firstSeenAt: new Date("2026-11-05T00:00:00Z") }]), upsert, deleteMany: vi.fn() }
    };
    const result = await loadRaceBoardData(db as never, "g1", "forever", new Date("2026-11-11T12:00:00Z"));
    const byKey = new Map(result.rows.map(r => [r.key, r.name]));
    expect(byKey.get("chad ho")).toBe("Chad Ho");
    expect(byKey.get("lebowski dude")).toBe("Lebowski Dude");
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
    expect(pvpChannelNames("stats")).toEqual(["battleground-statistics", "statistiques-jcj", "bg-ladder", "classement-cdb", "pvp-ladder", "classement-pvp"]);
    expect(pvpChannelNames("groups")).toContain("pvp-groups");
    expect(pvpChannelNames("duels")).toEqual(["duel-ladder", "classement-duels"]);
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

describe("one character, one row (first-name and full-name copies)", () => {
  const char = (key: string, name: string, level: number, over: Record<string, unknown> = {}) => ({ key, name, className: "Priest", race: "Human", level, memberId: null, discordId: null, professions: [], lastSeenAt: null, ...over });
  it("folds a first-name copy into the full-name one: highest level, linked copy wins, alias remembered", () => {
    const merged = mergeFirstNames([char("chad", "Chad", 40), char("chad ho", "Chad Ho", 38, { memberId: "m1" }), char("solo", "Solo", 10)]);
    expect(merged.map(c => c.key).sort()).toEqual(["chad ho", "solo"]);
    expect(merged.find(c => c.key === "chad ho")).toMatchObject({ name: "Chad Ho", level: 40, memberId: "m1", aliasKeys: ["chad"] });
  });
  it("folds a first-name copy whose own name is already full, even with no full-name twin", () => {
    const merged = mergeFirstNames([char("chad", "Chad Ho", 20)]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ key: "chad ho", name: "Chad Ho", aliasKeys: ["chad"] });
  });
  it("leaves a first name alone when two full names share it", () => {
    const merged = mergeFirstNames([char("sam", "Sam", 5), char("sam a", "Sam A", 6), char("sam b", "Sam B", 7)]);
    expect(merged).toHaveLength(3);
  });
  it("merges stored entries: highest level, earliest finish, earliest first sighting", () => {
    const a = { level: 60, reachedMaxAt: new Date("2026-11-10T00:00:00Z"), firstSeenAt: new Date("2026-11-05T00:00:00Z") };
    const b = { level: 58, reachedMaxAt: new Date("2026-11-08T00:00:00Z"), firstSeenAt: new Date("2026-11-06T00:00:00Z") };
    expect(mergeStored(a, [b])).toEqual({ level: 60, reachedMaxAt: b.reachedMaxAt, firstSeenAt: a.firstSeenAt });
  });
  it("the board shows a character once and removes the stale first-name entry", async () => {
    const upsert = vi.fn(), deleteMany = vi.fn();
    const when = new Date("2026-11-09T00:00:00Z");
    const db = {
      character: { findMany: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]) },
      unclaimedCharacter: { findMany: vi.fn(async () => [
        { nameKey: "chad", name: "Chad", displayName: "Chad Ho", className: "Priest", level: 45 },
        { nameKey: "chad ho", name: "Chad Ho", displayName: "Chad Ho", className: "Priest", level: 44 }]) },
      levelRaceEntry: { findMany: vi.fn(async () => [
        { nameKey: "chad", name: "Chad", className: "Priest", level: 45, reachedMaxAt: null, weekStartLevel: 40, weekStartedAt: when, firstSeenAt: new Date("2026-11-04T00:00:00Z") },
        { nameKey: "chad ho", name: "Chad Ho", className: "Priest", level: 44, reachedMaxAt: null, weekStartLevel: 41, weekStartedAt: when, firstSeenAt: new Date("2026-11-07T00:00:00Z") }]), upsert, deleteMany }
    };
    const result = await loadRaceBoardData(db as never, "g1", "forever", new Date("2026-11-11T12:00:00Z"));
    expect(result.rows.map(r => r.name)).toEqual(["Chad Ho"]);
    expect(result.rows[0]).toMatchObject({ level: 45, firstSeenAt: new Date("2026-11-04T00:00:00Z") });
    expect(deleteMany).toHaveBeenCalledWith({ where: { guildId: "g1", nameKey: { in: ["chad"] } } });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { guildId_nameKey: { guildId: "g1", nameKey: "chad ho" } } }));
  });
  it("the Hall keeps one entry per character: earliest number stays, the duplicate row and post go", async () => {
    const at = new Date("2026-11-12T12:00:00Z");
    const base = { className: "Priest", race: null, reachedAt: at, firstSeenAt: at, professions: null, memberDiscordId: null, posted: true, backfilled: false };
    const entries = [{ ...base, id: "e1", nameKey: "chad", order: 3, name: "Chad", messageId: "m1" }, { ...base, id: "e2", nameKey: "chad ho", order: 5, name: "Chad Ho", messageId: "m2" },
      { ...base, id: "e3", nameKey: "solo", order: 6, name: "Solo", messageId: "m3" }];
    const del = vi.fn(async () => ({}));
    const channel = { send: vi.fn(), messages: { fetch: vi.fn(async () => ({ delete: del })) } };
    const db = { raceHallEntry: { delete: vi.fn(async () => ({})), update: vi.fn(async () => ({})) } };
    const rows = [row("Chad Ho", 60, { key: "chad ho", aliasKeys: ["chad"] }), row("Solo", 60, { key: "solo" })];
    expect(await dedupeHallEntries(db as never, channel as never, entries as never, rows)).toBe(1);
    expect(db.raceHallEntry.delete).toHaveBeenCalledWith({ where: { id: "e2" } });
    expect(del).toHaveBeenCalledTimes(1);
    expect(db.raceHallEntry.update).toHaveBeenCalledWith({ where: { id: "e1" }, data: { nameKey: "chad ho" } });
    expect(entries.map(e => [e.id, e.nameKey])).toEqual([["e1", "chad ho"], ["e3", "solo"]]);
  });
});
