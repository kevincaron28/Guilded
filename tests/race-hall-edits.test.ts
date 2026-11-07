import { describe, expect, it, vi } from "vitest";

vi.mock("../src/database.js", () => ({ prisma: {} }));
vi.mock("../src/services/guild.js", () => ({ createGuildService: () => ({}) }));
import { LAUNCH_AT, LEVEL_CAP, addHallEntry, editHallEntry, findHallEntry, formatDuration, hallCard, hallEmbed, hallKeyFor, ordinal, removeHallEntry, syncHallOfFame, timeToSixty,
  type HallStored, type RaceBoardData, type RaceRow } from "../src/services/race-board.js";
import { parseHallDate } from "../src/commands/race.js";
import { scoreCardPng } from "../src/services/score-card.js";

const row = (name: string, level: number, over: Partial<RaceRow> = {}): RaceRow => ({ key: name.toLowerCase(), name, className: "Mage", race: "Human", level, reachedMaxAt: null, firstSeenAt: new Date("2026-11-04T12:00:00Z"), weekGain: 0, memberId: null, discordId: null, professions: [], lastSeenAt: null, ...over });
const board = (rows: RaceRow[]): RaceBoardData => ({ rows, total: rows.length, finished: rows.filter(r => r.level >= LEVEL_CAP).length, edition: "forever" });
const at = new Date("2026-11-10T12:00:00Z");
const stored = (over: Partial<HallStored> & { id: string; nameKey: string; order: number; name: string }): HallStored => ({ className: "Mage", race: "Human", reachedAt: at, firstSeenAt: new Date("2026-11-04T12:00:00Z"),
  professions: null, memberDiscordId: null, messageId: null, posted: true, backfilled: false, removed: false, ...over });

/** An in-memory raceHallEntry table with the calls the service makes. */
function fakeDb(initial: HallStored[] = []) {
  const rows = [...initial];
  const entry = {
    findMany: vi.fn(async ({ where }: { where?: { removed?: boolean } } = {}) => rows.filter(r => where?.removed === undefined || Boolean(r.removed) === where.removed).sort((a, b) => a.order - b.order)),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const created = { id: `n${rows.length + 1}`, ...data } as unknown as HallStored; rows.push(created); return created; }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => { const found = rows.find(r => r.id === where.id)!; Object.assign(found, data); return found; })
  };
  return { rows, db: { raceHallEntry: entry, memberMilestone: { findMany: vi.fn(async () => []) } } };
}
const fakeChannel = (messages: Record<string, { edit: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> }> = {}) => ({
  send: vi.fn(async () => ({ id: "posted-1" })),
  messages: { fetch: vi.fn(async (arg: unknown) => typeof arg === "string" ? messages[arg] ?? null : new Map()) }
});

describe("reach-60 card data", () => {
  it("writes English and French ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 112].map(n => ordinal(n, "en"))).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st", "112th"]);
    expect([1, 2, 3, 11].map(n => ordinal(n, "fr"))).toEqual(["1er", "2e", "3e", "11e"]);
  });
  it("formats the time to 60 as days and hours, or hours and minutes", () => {
    expect(formatDuration(5 * 86_400_000 + 4 * 3_600_000 + 59_000, "en")).toBe("5d 4h");
    expect(formatDuration(6 * 3_600_000 + 20 * 60_000, "en")).toBe("6h 20m");
    expect(formatDuration(45 * 60_000, "fr")).toBe("45 min");
    expect(formatDuration(2 * 86_400_000, "fr")).toBe("2 j 0 h");
  });
  it("counts the time to 60 from the 4 November launch, only when the climb is known", () => {
    const base = { order: 3, name: "Aria Stone", className: "Mage", race: "Human", reachedAt: new Date("2026-11-10T03:00:00Z"), firstSeenAt: LAUNCH_AT, professions: "Mining 300, Herbalism 225", memberDiscordId: null };
    expect(timeToSixty(base)).toBeNull();
    expect(timeToSixty({ ...base, sinceLaunchKnown: true })).toBe(base.reachedAt.getTime() - LAUNCH_AT.getTime());
    const known = hallCard({ ...base, sinceLaunchKnown: true }, "en", "Kev");
    expect(known.title).toBe("Aria Stone");
    expect(known.stats[0]).toMatchObject({ value: "3rd", note: "3rd to reach level 60" });
    expect(known.stats[1]).toMatchObject({ label: "Time to 60", value: "5d 4h" });
    expect(known.rows?.map(r => r.name)).toEqual(["Mage", "@Kev", "Mining", "Herbalism"]);
    const unknown = hallCard(base, "fr");
    expect(unknown.stats.map(s => s.label)).toEqual(["Arrivé au niveau 60", "Date"]);
    expect(unknown.stats[0]?.note).toBe("3e à atteindre le niveau 60");
  });
  it("shows the time to 60 and the rank in the embed, and the card as its image", () => {
    const entry = { order: 3, name: "Aria Stone", className: "Mage", race: "Human", reachedAt: new Date("2026-11-10T03:00:00Z"), firstSeenAt: LAUNCH_AT, professions: null, memberDiscordId: "42", sinceLaunchKnown: true };
    const json = hallEmbed(entry, "en", "g1", "aria stone", "hall-60.png").toJSON();
    expect(json.title).toBe("🏆 #3 to reach 60");
    expect(json.description).toContain("5d 4h after launch (4 Nov 2026)");
    expect(json.image?.url).toBe("attachment://hall-60.png");
    expect(hallEmbed({ ...entry, sinceLaunchKnown: false }, "en").toJSON().description).not.toContain("after launch");
  });
  it("draws the card as a PNG", async () => {
    const entry = { order: 1, name: "Aria Stone", className: "Mage", race: "Human", reachedAt: new Date("2026-11-10T03:00:00Z"), firstSeenAt: LAUNCH_AT, professions: "Mining 300", memberDiscordId: null, sinceLaunchKnown: true };
    const png = await scoreCardPng(hallCard(entry, "en", "Kev"));
    expect(png?.subarray(1, 4).toString()).toBe("PNG");
  });
});

describe("reaching 60 triggers exactly one celebration", () => {
  it("posts one card for a character that was watched climbing, with the time to 60 known", async () => {
    const { db, rows } = fakeDb([stored({ id: "e0", nameKey: "early", order: 1, name: "Early", backfilled: true })]);
    const channel = fakeChannel();
    const climbed = row("Aria Stone", 60, { reachedMaxAt: new Date("2026-11-10T03:00:00Z"), firstSeenAt: new Date("2026-11-05T00:00:00Z") });
    const result = await syncHallOfFame(db as never, channel as never, "g1", board([row("Early", 60), climbed]), "en", new Date("2026-11-09T00:00:00Z"), at);
    expect(result.posted).toBe(1);
    expect(channel.send).toHaveBeenCalledTimes(1);
    const payload = (channel.send.mock.calls[0] as unknown[])[0] as { files: unknown[]; embeds: { toJSON(): { title?: string } }[] };
    expect(payload.files).toHaveLength(1);
    expect(payload.embeds[0]!.toJSON().title).toBe("🏆 #2 to reach 60");
    expect(rows.find(r => r.nameKey === "aria stone")).toMatchObject({ sinceLaunchKnown: true, posted: true, messageId: "posted-1" });
  });
  it("does not claim a time to 60 for a character first seen at 60", async () => {
    const { db, rows } = fakeDb([stored({ id: "e0", nameKey: "early", order: 1, name: "Early", backfilled: true })]);
    const channel = fakeChannel();
    await syncHallOfFame(db as never, channel as never, "g1", board([row("Early", 60), row("Late Comer", 60, { reachedMaxAt: at, firstSeenAt: at })]), "en", new Date("2026-11-09T00:00:00Z"), at);
    expect(rows.find(r => r.nameKey === "late comer")?.sinceLaunchKnown).toBe(false);
  });
  it("posts nothing on the next refresh for the same character, and never re-adds a removed one", async () => {
    const { db } = fakeDb([stored({ id: "e0", nameKey: "aria stone", order: 1, name: "Aria Stone", messageId: "m1" }), stored({ id: "e1", nameKey: "wrong one", order: 2, name: "Wrong One", removed: true, posted: false })]);
    const channel = fakeChannel();
    const rows = [row("Aria Stone", 60, { reachedMaxAt: at }), row("Wrong One", 60, { reachedMaxAt: at })];
    expect((await syncHallOfFame(db as never, channel as never, "g1", board(rows), "en", new Date("2026-11-09T00:00:00Z"), at)).posted).toBe(0);
    expect(channel.send).not.toHaveBeenCalled();
    expect(db.raceHallEntry.create).not.toHaveBeenCalled();
  });
});

describe("officer Hall of Fame edits", () => {
  it("finds an entry by number, full name or the single first-name match, never a removed one", () => {
    const entries = [stored({ id: "a", nameKey: "aria stone", order: 1, name: "Aria Stone" }), stored({ id: "b", nameKey: "brom", order: 2, name: "Brom" }), stored({ id: "c", nameKey: "gone", order: 3, name: "Gone One", removed: true }),
      stored({ id: "d", nameKey: "brom two", order: 4, name: "Brom Two" })];
    expect(findHallEntry(entries, "#1")).toMatchObject({ entry: { id: "a" } });
    expect(findHallEntry(entries, "2")).toMatchObject({ entry: { id: "b" } });
    expect(findHallEntry(entries, "aria stone")).toMatchObject({ entry: { id: "a" } });
    expect(findHallEntry(entries, "Aria")).toMatchObject({ entry: { id: "a" } });
    expect(findHallEntry(entries, "Brom")).toMatchObject({ entry: { id: "b" } }); // the exact name wins over the first-name match of Brom Two
    expect(findHallEntry(entries, "3")).toEqual({ error: "not-found" });
    expect(findHallEntry(entries, "Gone One")).toEqual({ error: "not-found" });
    expect(findHallEntry(entries, "Nobody")).toEqual({ error: "not-found" });
  });
  it("uses the board's key for a character on the board, otherwise the lower-cased name", () => {
    expect(hallKeyFor("Aria Stone", [row("Aria Stone", 60, { key: "aria" })]).key).toBe("aria");
    expect(hallKeyFor("  Off Board ", []).key).toBe("off board");
  });
  it("adds a missed character with the next number, its own post, and what the board knows filled in", async () => {
    const { db, rows } = fakeDb([stored({ id: "e0", nameKey: "early", order: 4, name: "Early" })]);
    const channel = fakeChannel();
    const onBoard = row("Aria Stone", 59, { className: "Priest", race: "Dwarf", discordId: "42" });
    const result = await addHallEntry(db as never, channel as never, "g1", { name: "Aria Stone", reachedAt: new Date("2026-11-08T12:00:00Z") }, [onBoard], "en");
    expect(result.ok).toBe(true);
    expect(rows[1]).toMatchObject({ name: "Aria Stone", order: 5, className: "Priest", race: "Dwarf", memberDiscordId: "42", sinceLaunchKnown: true, posted: true, messageId: "posted-1" });
    expect(channel.send).toHaveBeenCalledTimes(1);
  });
  it("needs a class for a character the board does not know, and refuses duplicates", async () => {
    const { db } = fakeDb([stored({ id: "e0", nameKey: "off board", order: 1, name: "Off Board" })]);
    const channel = fakeChannel();
    expect(await addHallEntry(db as never, channel as never, "g1", { name: "Somebody Else" }, [], "en")).toEqual({ ok: false, error: "bad-class" });
    expect(await addHallEntry(db as never, channel as never, "g1", { name: "Somebody Else", className: "wizard" }, [], "en")).toEqual({ ok: false, error: "bad-class" });
    expect(await addHallEntry(db as never, channel as never, "g1", { name: "Off Board", className: "mage" }, [], "en")).toEqual({ ok: false, error: "exists" });
    expect(channel.send).not.toHaveBeenCalled();
    expect((await addHallEntry(db as never, channel as never, "g1", { name: "Somebody Else", className: "death knight" }, [], "en"))).toMatchObject({ ok: true, entry: { className: "Death Knight", order: 2 } });
  });
  it("brings back a removed entry under its old number", async () => {
    const { db, rows } = fakeDb([stored({ id: "e0", nameKey: "aria stone", order: 1, name: "Aria Stone", removed: true, posted: false })]);
    const result = await addHallEntry(db as never, fakeChannel() as never, "g1", { name: "Aria Stone", className: "Mage" }, [], "en");
    expect(result.ok).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ removed: false, order: 1, posted: true });
  });
  it("removes a wrong entry: deletes its post, keeps a tombstone so it is not added again, keeps the other numbers", async () => {
    const del = vi.fn(async () => ({}));
    const { db, rows } = fakeDb([stored({ id: "a", nameKey: "aria stone", order: 1, name: "Aria Stone", messageId: "m1" }), stored({ id: "b", nameKey: "brom", order: 2, name: "Brom", messageId: "m2" })]);
    const channel = fakeChannel({ m1: { edit: vi.fn(), delete: del } });
    const result = await removeHallEntry(db as never, channel as never, "g1", "Aria Stone", "en");
    expect(result).toMatchObject({ ok: true, entry: { order: 1 } });
    expect(del).toHaveBeenCalledTimes(1);
    expect(rows.map(r => [r.nameKey, r.removed, r.order])).toEqual([["aria stone", true, 1], ["brom", false, 2]]);
    // the next refresh sees the character at 60 and must not post or create it again
    const channel2 = fakeChannel();
    await syncHallOfFame(db as never, channel2 as never, "g1", board([row("Aria Stone", 60, { reachedMaxAt: at }), row("Brom", 60, { reachedMaxAt: at })]), "en", new Date("2026-11-09T00:00:00Z"), at);
    expect(channel2.send).not.toHaveBeenCalled();
    expect(await removeHallEntry(db as never, channel as never, "g1", "Aria Stone", "en")).toEqual({ ok: false, error: "not-found" });
  });
  it("removing a backfilled entry rewrites the summary without it instead of deleting a post", async () => {
    const summaryEdit = vi.fn(async () => ({}));
    const { db } = fakeDb([stored({ id: "a", nameKey: "a one", order: 1, name: "A One", backfilled: true }), stored({ id: "b", nameKey: "b two", order: 2, name: "B Two", backfilled: true })]);
    const channel = { send: vi.fn(), messages: { fetch: vi.fn(async () => new Map([["s1", { id: "s1", embeds: [{ footer: { text: "Guilded hall of fame • g1 • summary" } }], edit: summaryEdit }]])) } };
    expect((await removeHallEntry(db as never, channel as never, "g1", "#1", "en")).ok).toBe(true);
    const text = JSON.stringify(summaryEdit.mock.calls[0]);
    expect(text).toContain("B Two");
    expect(text).not.toContain("A One");
  });
  it("corrects a name, class and date, and edits the permanent post in place with a fresh card", async () => {
    const edit = vi.fn(async () => ({}));
    const { db, rows } = fakeDb([stored({ id: "a", nameKey: "aria", order: 1, name: "Aria", messageId: "m1" })]);
    const channel = fakeChannel({ m1: { edit, delete: vi.fn() } });
    const result = await editHallEntry(db as never, channel as never, "g1", "Aria", { newName: "Aria Stone", className: "priest", reachedAt: new Date("2026-11-08T12:00:00Z") }, [], "fr");
    expect(result.ok).toBe(true);
    expect(rows[0]).toMatchObject({ name: "Aria Stone", nameKey: "aria stone", className: "Priest", sinceLaunchKnown: true, order: 1 });
    expect(edit).toHaveBeenCalledTimes(1);
    const payload = (edit.mock.calls[0] as unknown[])[0] as { files: unknown[]; attachments: unknown[]; embeds: { toJSON(): { title?: string; description?: string } }[] };
    expect(payload.attachments).toEqual([]);
    expect(payload.files).toHaveLength(1);
    expect(payload.embeds[0]!.toJSON().title).toBe("🏆 N° 1 à atteindre le niveau 60");
    expect(payload.embeds[0]!.toJSON().description).toContain("Aria Stone");
  });
  it("re-sends the post when the old message is gone, refuses a clashing name and a bad class, and ignores an empty edit", async () => {
    const { db } = fakeDb([stored({ id: "a", nameKey: "aria", order: 1, name: "Aria", messageId: "gone" }), stored({ id: "b", nameKey: "brom stone", order: 2, name: "Brom Stone" })]);
    const channel = fakeChannel();
    expect((await editHallEntry(db as never, channel as never, "g1", "1", { race: "Dwarf" }, [], "en")).ok).toBe(true);
    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(await editHallEntry(db as never, channel as never, "g1", "1", { newName: "Brom Stone" }, [], "en")).toEqual({ ok: false, error: "exists" });
    expect(await editHallEntry(db as never, channel as never, "g1", "1", { className: "bard" }, [], "en")).toEqual({ ok: false, error: "bad-class" });
    const before = db.raceHallEntry.update.mock.calls.length;
    expect((await editHallEntry(db as never, channel as never, "g1", "1", {}, [], "en")).ok).toBe(true);
    expect(db.raceHallEntry.update.mock.calls.length).toBe(before);
  });
  it("reads officer dates as noon UTC and refuses bad or future days", () => {
    expect(parseHallDate("2026-11-08", new Date("2026-11-10T00:00:00Z"))?.toISOString()).toBe("2026-11-08T12:00:00.000Z");
    expect(parseHallDate("2026-02-30", new Date("2026-11-10T00:00:00Z"))).toBeNull();
    expect(parseHallDate("08/11/2026", new Date("2026-11-10T00:00:00Z"))).toBeNull();
    expect(parseHallDate("2999-01-01")).toBeNull();
    expect(parseHallDate(null)).toBeNull();
  });
});
