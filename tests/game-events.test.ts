import { afterEach, describe, expect, it, vi } from "vitest";
// Turns the Forever-only focus switches on for this file (see tests/helpers/focus-switches.ts).
vi.mock("../companion/active-editions.mjs", async (original) => (await import("./helpers/focus-switches.js")).allEditionsOn(await original()));
import { Collection, ChannelType, PermissionFlagsBits, type Guild, type TextChannel } from "discord.js";
import type { DiscordJob, GameEventBoard, OfficialGameEvent, PrismaClient } from "../src/generated/prisma/client.js";
import { BRAND } from "../src/brand.js";
import { COUNTDOWN_PING_MINUTES, EVENT_GAMES, EVENT_TRANSACTION_OPTIONS, countdownBar, countdownMilestone, countdownRolePing, countdownVoice, effectiveEventState, eventBoardEmbeds, eventCountdown, eventDetails, eventEmbedsHash, officialEventSource, parseEventInstant, queueGameEvents, reconcileGameEventBoards, reminderDue, reminderSettings, retainEventReminders, saveOfficialEvent, validateEvent, visibleEvent } from "../src/services/game-events.js";
import { deliverGameEvent, eventRole, findEventMessage } from "../src/services/game-events-discord.js";
import { ownerEventsCommand, executeGameEvents, executeOwnerEvents } from "../src/commands/game-events.js";

const now = new Date("2026-10-27T20:00:00Z");
const event = (overrides: Partial<OfficialGameEvent> = {}): OfficialGameEvent => ({ id: "names", game: "WOW_FOREVER", region: "NA", titleEn: "Name reservation", titleFr: "Réservation des noms", sourceUrl: "https://news.blizzard.com/en-us/article/24303866/claim-your-world-of-warcraft-forever-character-names", dateLabelEn: "", dateLabelFr: "", state: "SCHEDULED", startsAt: now, scheduleVersion: 1, archived: false, updatedBy: "owner", createdAt: now, updatedAt: now, ...overrides });
const board = (overrides: Partial<GameEventBoard> = {}): GameEventBoard => ({ editionReminders: {}, id: "board", guildId: "record", channelId: "channel", enabled: true, games: ["WOW_FOREVER", "POE2"], region: "NA", messageId: null, contentHash: null, wowRoleId: "role", poeRoleId: null, wowReminders: [1440, 60, 0], poeReminders: [], poeRemindersEnabledAt: null, wowRemindersEnabledAt: new Date("2026-10-20T00:00:00Z"), createdAt: now, updatedAt: now, ...overrides });
afterEach(() => vi.useRealTimers());

describe("official event dates and display", () => {
  it("requires explicit zones and rejects normalized or invalid dates", () => {
    expect(parseEventInstant("2026-11-04T15:00:00-08:00").toISOString()).toBe("2026-11-04T23:00:00.000Z");
    for (const bad of ["2026-11-04", "2026-11-04T15:00:00", "2026-02-30T20:00:00Z", "2026-11-04T25:00:00Z", "2026-11-04T15:00:00+25:00"]) expect(() => parseEventInstant(bad)).toThrow();
  });
  it("only accepts the game's official HTTPS domains", () => {
    for (const bad of ["https://news.blizzard.com.evil.test/a", "http://news.blizzard.com/a", "https://user@news.blizzard.com/a", "https://www.pathofexile.com/a", "https://news.blizzard.com/a)@everyone"]) expect(() => officialEventSource("WOW_FOREVER", bad)).toThrow();
    expect(officialEventSource("POE2", "https://www.pathofexile.com/forum/view-thread/3999366")).toContain("3999366");
  });
  it("keeps TBA, postponed and cancelled events untimed", () => {
    for (const state of ["TBA", "POSTPONED", "CANCELLED"]) {
      expect(() => validateEvent(event({ state }))).toThrow();
      expect(validateEvent(event({ state, startsAt: null })).startsAt).toBeNull();
    }
    expect(() => validateEvent(event({ startsAt: null }))).toThrow();
  });
  it("filters games and region without conflating regional reservations", () => {
    expect(visibleEvent(event(), board())).toBe(true);
    expect(visibleEvent(event({ region: "EU" }), board())).toBe(false);
    expect(visibleEvent(event({ region: "GLOBAL" }), board({ region: "KR" }))).toBe(true);
    expect(visibleEvent(event(), board({ games: ["POE2"] }))).toBe(false);
  });
  it("renders native timestamps, separate games, bilingual TBA and reached caveat", () => {
    const rows = [event(), event({ id: "poe2", game: "POE2", region: "GLOBAL", state: "TBA", startsAt: null, titleEn: "Full release", titleFr: "Sortie complète", dateLabelEn: "11 December 2026 (PST) · time TBA", dateLabelFr: "11 décembre 2026 (PST) · heure à confirmer" })];
    for (const fr of [false, true]) {
      const embeds = eventBoardEmbeds(rows, board(), fr, new Date(now.getTime() - 1)).map(e => e.toJSON());
      expect(embeds.map(e => e.title)).toContain("WoW Forever");
      expect(embeds.map(e => e.title)).toContain("Path of Exile 2");
      expect(embeds[1]!.fields![0]!.value).toMatch(/<t:\d+:F> · <t:\d+:R>/);
      expect(embeds[2]!.fields![0]!.value).not.toContain("<t:");
      expect(embeds[2]!.fields![0]!.value).toContain(fr ? "décembre" : "December");
    }
    expect(effectiveEventState(rows[0]!, now)).toBe("REACHED");
    expect(JSON.stringify(eventBoardEmbeds(rows, board(), false, now))).toContain("does not confirm servers are online");
    expect(effectiveEventState(event({ state: "CANCELLED", startsAt: null }), now)).toBe("CANCELLED");
  });
  it("does not change content every second", () => {
    expect(eventBoardEmbeds([event()], board(), false, new Date(now.getTime() - 5000))).toEqual(eventBoardEmbeds([event()], board(), false, new Date(now.getTime() - 1000)));
  });
  it("shows days, hours and minutes in both languages and rolls over at minute boundaries", () => {
    const start = new Date(now.getTime() + (10 * 1440 + 4 * 60 + 32) * 60_000);
    expect(eventCountdown(start, false, now)).toContain("10d 04h 32m");
    expect(eventCountdown(start, true, now)).toContain("10j 04h 32m");
    expect(eventCountdown(start, false, new Date(now.getTime() + 60_000))).toContain("10d 04h 31m");
    expect(eventCountdown(new Date(now.getTime() + 24 * 60 * 60_000), false, now)).toContain("1d 00h 00m");
    expect(eventCountdown(new Date(now.getTime() + 59 * 60_000), false, now)).toContain("Final countdown");
    expect(eventCountdown(new Date(now.getTime() + 1), true, now)).toContain("0j 00h 01m");
    expect(eventCountdown(now, false, now)).toBe("");
  });
  it("spotlights the nearest visible scheduled event and removes countdown hype when it ends", () => {
    const future = event({ id: "future", startsAt: new Date(now.getTime() + 2 * 60_000), titleEn: "Near event" });
    const rows = [event({ id: "past", titleEn: "Past event" }), event({ id: "far", startsAt: new Date(now.getTime() + 86400_000) }), future, event({ id: "eu", titleEn: "Hidden EU", region: "EU", startsAt: new Date(now.getTime() + 60_000) })];
    const embeds = eventBoardEmbeds(rows, board(), false, now).map(e => e.toJSON());
    expect(embeds[0]!.description).toContain("Up next · Near event");
    expect(embeds[1]!.fields![0]!.name).toBe("Near event");
    expect(embeds[1]!.fields![0]!.value).toContain("0d 00h 02m");
    expect(eventDetails(future, false, now)).not.toContain("00h 02m"); // old reminders never freeze timers
    const ended = JSON.stringify(eventBoardEmbeds([event()], board(), false, now));
    expect(ended).not.toContain("Final countdown");
    expect(ended).not.toContain("to go");
    expect(ended).toContain("THE GATES ARE OPEN");
    const disabled = JSON.stringify(eventBoardEmbeds([future], board({ enabled: false }), false, now));
    expect(disabled).not.toContain("Near event");
  });
  it.each(["TBA", "SCHEDULED", "REACHED"])("bounds a full %s board to Discord's aggregate embed budget", state => {
    const rows = Array.from({ length: 12 }, (_, i) => event({ id: `e-${i}`, titleFr: "*".repeat(80), state, startsAt: state === "TBA" ? null : new Date(now.getTime() + (state === "SCHEDULED" ? 60_000 : 0)), dateLabelFr: "*".repeat(100), sourceUrl: "https://news.blizzard.com/" + "a".repeat(195) }));
    const embeds = eventBoardEmbeds(rows, board(), true, now).map(e => e.toJSON());
    const count = embeds.reduce((sum, e) => sum + (e.title?.length ?? 0) + (e.description?.length ?? 0) + (e.footer?.text.length ?? 0) + (e.fields ?? []).reduce((n, f) => n + f.name.length + f.value.length, 0), 0);
    expect(count).toBeLessThanOrEqual(6000);
  });
  it("saves only catalogue fields, retaining revision on copy-only edits", async () => {
    const upsert = vi.fn().mockResolvedValue(event());
    const tx = { $executeRaw: vi.fn(), officialGameEvent: { findUnique: vi.fn().mockResolvedValue(event()), upsert } };
    await saveOfficialEvent({ $transaction: (fn: (t: unknown) => unknown) => fn(tx) } as unknown as PrismaClient, event({ titleEn: "Corrected" }), "owner", now);
    expect(upsert.mock.calls[0]![0].update).not.toHaveProperty("scheduleVersion");
    expect(upsert.mock.calls[0]![0].create).not.toHaveProperty("createdAt");
  });
});

describe("launch countdown hype", () => {
  const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
  it("steps through every milestone and only fills the bar as the watch advances", () => {
    expect(countdownMilestone(7 * 1440 + 1)).toBe("horizon");
    expect(countdownBar(7 * 1440 + 1)).toBe(`[${"░".repeat(11)}]`);
    const beats = ["7d", "3d", "1d", "12h", "6h", "1h", "30m", "10m", "5m", "1m", "live"] as const;
    const edges = [7 * 1440, 3 * 1440, 1440, 12 * 60, 6 * 60, 60, 30, 10, 5, 1, 0];
    let previous = countdownBar(edges[0]! + 1);
    edges.forEach((minutes, index) => {
      expect(countdownMilestone(minutes)).toBe(beats[index]);
      const bar = countdownBar(minutes);
      expect(bar.startsWith("[█")).toBe(minutes < 7 * 1440 || minutes === 7 * 1440);
      expect(bar.length).toBe(previous.length);
      expect((bar.match(/█/g) ?? []).length).toBeGreaterThan((previous.match(/█/g) ?? []).length);
      previous = bar;
    });
    expect(countdownBar(0)).toBe(`[${"█".repeat(11)}]`);
    expect(countdownBar(-3)).toBe(countdownBar(0));
  });
  it("keeps the clock, rotates flavour by milestone and language, and stays still within a minute", () => {
    const week = at(6 * 1440);
    const english = eventCountdown(week, false, now);
    const french = eventCountdown(week, true, now);
    expect(english).toContain("6d 00h 00m");
    expect(english).not.toContain("Final countdown");
    expect(french).toContain("6j 00h 00m");
    expect(french).not.toContain("Sharpen");
    expect(eventCountdown(at(50), false, now)).toContain("Final countdown");
    expect(countdownVoice(event({ id: "launch" }), "7d", false, now).line).not.toBe(countdownVoice(event({ id: "launch" }), "1h", false, now).line);
    expect(countdownVoice(event({ id: "launch" }), "7d", true, now).title).not.toBe(countdownVoice(event({ id: "launch" }), "7d", false, now).title);
    const first = countdownVoice(event({ id: "launch" }), "7d", false, now).line;
    expect(countdownVoice(event({ id: "launch" }), "7d", false, new Date(now.getTime() + 20_000)).line).toBe(first);
    const rotated = new Set(Array.from({ length: 48 }, (_, hour) => countdownVoice(event({ id: "launch" }), "7d", false, new Date(now.getTime() + hour * 3_600_000)).line));
    expect(rotated.size).toBeGreaterThan(1);
  });
  it("renders a forever board with a live timestamp, a bar and the brand accent", () => {
    const start = at(6 * 1440);
    const embeds = eventBoardEmbeds([event({ id: "forever-launch", titleEn: "WoW Forever launch", titleFr: "Lancement de WoW Forever", startsAt: start })], board(), false, now).map(embed => embed.toJSON());
    expect(embeds[0]!.description).toContain("Up next · WoW Forever launch");
    expect(embeds[0]!.description).toMatch(/<t:\d+:R>/);
    expect(embeds[0]!.description).toMatch(/<t:\d+:F>/);
    expect(embeds[0]!.description).toContain("█");
    expect(embeds[0]!.color).toBe(BRAND.color);
    expect(embeds[0]!.thumbnail?.url).toContain("guilded-card.png");
    expect(embeds[1]!.fields![0]!.value).toContain("6d 00h 00m");
    const french = eventBoardEmbeds([event({ startsAt: start, titleFr: "Lancement de WoW Forever" })], board(), true, now)[0]!.toJSON();
    expect(french.description).toContain("Prochain rendez-vous · Lancement de WoW Forever");
    expect(french.description).toContain("fuseau");
    const hot = eventBoardEmbeds([event({ startsAt: at(50) })], board(), false, now)[0]!.toJSON();
    expect(hot.color).toBe(0xf59e0b);
    expect(hot.title).toBe("Final countdown");
    const far = eventBoardEmbeds([event({ startsAt: at(10 * 1440) })], board(), false, now)[0]!.toJSON();
    expect(far.color).toBe(0x8b5cf6);
    expect(far.description).toContain("░");
  });
  it("opens the gates for WoW Forever, and uses a different banner for other games", () => {
    const forever = eventBoardEmbeds([event()], board(), false, now)[0]!.toJSON();
    expect(forever.title).toBe("THE GATES ARE OPEN");
    expect(forever.image?.url).toContain("guilded-card.png");
    expect(forever.description).toMatch(/<t:\d+:R>/);
    expect(forever.description).not.toContain("to go");
    const french = eventBoardEmbeds([event()], board(), true, now)[0]!.toJSON();
    expect(french.title).toBe("LES PORTES SONT OUVERTES");
    const poe = eventBoardEmbeds([event({ game: "POE2", region: "GLOBAL", titleEn: "Full release" })], board(), false, now)[0]!.toJSON();
    expect(poe.title).toBe("THE FIRST STEP IS YOURS");
    const retail = eventBoardEmbeds([event({ game: "WOW_RETAIL", titleEn: "Season" })], board({ games: ["WOW_RETAIL"] }), false, now)[0]!.toJSON();
    expect(retail.title).toBe("THE REALM IS OPEN");
    const stale = eventBoardEmbeds([event({ startsAt: new Date(now.getTime() - 7 * 60 * 60_000) })], board(), false, now)[0]!.toJSON();
    expect(stale.title).toBe("Upcoming Events");
    expect(JSON.stringify(stale)).not.toContain("THE GATES ARE OPEN");
  });
  it("names a role only at 1h and live, and only when that offset is saved", () => {
    expect(COUNTDOWN_PING_MINUTES).toEqual([60, 0]);
    expect(countdownRolePing(60, [1440, 60, 0], "role")).toBe("role");
    expect(countdownRolePing(0, [0], "role")).toBe("role");
    expect(countdownRolePing(1440, [1440, 60, 0], "role")).toBeNull();
    expect(countdownRolePing(60, [0], "role")).toBeNull();
    expect(countdownRolePing(0, [0], null)).toBeNull();
    for (const minutes of [7 * 1440, 3 * 1440, 12 * 60, 6 * 60, 30, 10, 5, 1]) {
      expect(countdownRolePing(minutes, [minutes], "role")).toBeNull();
      expect(reminderDue(event(), board(), minutes, now)).toBe(false);
    }
  });
});

describe("reminder eligibility", () => {
  it.each([1440, 60, 0])("allows one bounded restart catch-up window for %i minutes", minutes => {
    const due = new Date(now.getTime() - minutes * 60_000);
    expect(reminderDue(event(), board(), minutes, new Date(due.getTime() - 1))).toBe(false);
    expect(reminderDue(event(), board(), minutes, due)).toBe(true);
    expect(reminderDue(event(), board(), minutes, new Date(due.getTime() + 14 * 60_000))).toBe(true);
    expect(reminderDue(event(), board(), minutes, new Date(due.getTime() + 15 * 60_000))).toBe(false);
  });
  it("does not catch up notifications predating opt-in or notify unconfigured games", () => {
    expect(reminderDue(event(), board({ wowRemindersEnabledAt: new Date(now.getTime() + 1) }), 0, now)).toBe(false);
    for (const update of [{ enabled: false }, { wowRoleId: null }, { wowReminders: [] }, { games: ["POE2"] }, { region: "EU" }]) expect(reminderDue(event(), board(update), 0, now)).toBe(false);
    for (const state of ["TBA", "POSTPONED", "CANCELLED"]) expect(reminderDue(event({ state, startsAt: null }), board(), 0, now)).toBe(false);
  });
});

describe("event reconcile locking", () => {
  const guilds = [{ id: "111111111111111111", name: "One" }, { id: "222222222222222222", name: "Two" }];
  it("takes the global lock once for every guild", async () => {
    const transaction = vi.fn(async () => undefined);
    await reconcileGameEventBoards({ $transaction: transaction } as never, guilds, () => { throw new Error("unexpected report"); });
    expect(transaction).toHaveBeenCalledOnce();
  });
  it("repeats per guild only after the shared pass fails, and names that guild", async () => {
    let calls = 0;
    const transaction = vi.fn(async () => { calls += 1; if (calls === 1) throw new Error("catalogue down"); });
    const findFirst = vi.fn(async () => ({ channelId: "333333333333333333" }));
    const reports: { id: string; channelId: string | null }[] = [];
    await reconcileGameEventBoards({ $transaction: transaction, gameEventBoard: { findFirst } } as never, guilds, (_error, guild, channelId) => { reports.push({ id: guild.id, channelId }); });
    expect(calls).toBe(1 + guilds.length);
    expect(reports).toEqual([]);
    calls = 0;
    transaction.mockImplementation(async () => { calls += 1; throw new Error("still down"); });
    const failed: { id: string; channelId: string | null }[] = [];
    await reconcileGameEventBoards({ $transaction: transaction, gameEventBoard: { findFirst } } as never, guilds, (_error, guild, channelId) => { failed.push({ id: guild.id, channelId }); });
    expect(failed).toEqual(guilds.map(guild => ({ id: guild.id, channelId: "333333333333333333" })));
  });
});

describe("countdown reconciliation workload", () => {
  function queueHarness(events: OfficialGameEvent[], rows: GameEventBoard[], pending: string[] = []) {
    const upsert = vi.fn();
    const tx = { $executeRaw: vi.fn(), officialGameEvent: { updateMany: vi.fn(), findMany: vi.fn().mockResolvedValue(events) },
      gameEventBoard: { findMany: vi.fn().mockResolvedValue(rows.map(row => ({ ...row, guild: { settings: { language: "en" } } }))) },
      discordJob: { findMany: vi.fn().mockResolvedValue(pending.map(key => ({ key }))), upsert } };
    return { tx, upsert, db: { $transaction: (fn: (value: typeof tx) => unknown) => fn(tx) } as unknown as PrismaClient };
  }
  it("coalesces repeated ticks for 200 pending boards without resets or per-board job reads", async () => {
    const rows = Array.from({ length: 200 }, (_, i) => board({ id: `board-${i}` }));
    const h = queueHarness([], rows, rows.map(row => `game-board:${row.id}`));
    for (let i = 0; i < 3; i++) await queueGameEvents(h.db, {}, new Date(now.getTime() + i * 60_000));
    expect(h.upsert).not.toHaveBeenCalled();
    expect(h.tx.discordJob.findMany).toHaveBeenCalledTimes(3);
  });
  it("skips unchanged content, but refreshes the next minute and periodically repairs static boards", async () => {
    const rows = [event({ startsAt: new Date(now.getTime() + 10 * 60_000) })];
    const b = board({ messageId: "existing", wowReminders: [] });
    b.contentHash = eventEmbedsHash(eventBoardEmbeds(rows, b, false, now));
    const h = queueHarness(rows, [b]);
    await queueGameEvents(h.db, {}, new Date(now.getTime() + 20_000));
    expect(h.upsert).not.toHaveBeenCalled();
    await queueGameEvents(h.db, {}, new Date(now.getTime() + 60_000));
    expect(h.upsert).toHaveBeenCalledOnce();
    const tba = [event({ state: "TBA", startsAt: null })];
    b.contentHash = eventEmbedsHash(eventBoardEmbeds(tba, b, false, now));
    const staticBoard = queueHarness(tba, [b]);
    await queueGameEvents(staticBoard.db, {}, new Date(now.getTime() + 60_000));
    expect(staticBoard.upsert).not.toHaveBeenCalled();
    await queueGameEvents(staticBoard.db, {}, new Date(now.getTime() + 5 * 60_000));
    expect(staticBoard.upsert).toHaveBeenCalledOnce();
  });
});

function harness(kind = "GAME_EVENT_REMINDER") {
  vi.useFakeTimers(); vi.setSystemTime(now);
  const b = { ...board(), guild: { settings: { language: "en" as string } } };
  const e = event();
  const job = { id: "durable-job", guildId: "record", kind, payload: { boardId: b.id, eventId: e.id, scheduleVersion: 1, minutes: 0 }, createdAt: now } as unknown as DiscordJob;
  const tx = { $executeRaw: vi.fn(), gameEventBoard: { findFirst: vi.fn().mockResolvedValue(b), update: vi.fn() }, officialGameEvent: { findUnique: vi.fn().mockResolvedValue(e), findMany: vi.fn().mockResolvedValue([e]) } };
  const db = { ...tx, $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)) } as unknown as PrismaClient;
  const send = vi.fn().mockResolvedValue({ id: "posted", pinned: false, pin: vi.fn(), unpin: vi.fn() });
  const channel = { type: ChannelType.GuildText, client: { user: { id: "bot" } }, permissionsFor: () => ({ has: () => true }), messages: { fetch: vi.fn().mockResolvedValue(new Collection()) }, send };
  const guild = { id: "discord", client: channel.client, channels: { fetch: vi.fn().mockResolvedValue(channel) }, members: { fetchMe: vi.fn() }, roles: { fetch: vi.fn().mockResolvedValue({ id: "role", managed: false, mentionable: true, permissions: { bitfield: 0n } }) } } as unknown as Guild;
  return { b, e, job, tx, db, channel, guild, send };
}

describe("delivery and restart recovery", () => {
  it("performs Discord permission and recovery reads before reserving a transaction", async () => {
    const h = harness();
    h.channel.messages.fetch.mockImplementation(async () => {
      expect(h.db.$transaction).not.toHaveBeenCalled();
      expect(h.guild.roles.fetch).toHaveBeenCalledOnce();
      expect(h.guild.members.fetchMe).toHaveBeenCalledOnce();
      return new Collection();
    });
    await deliverGameEvent(h.guild, h.db, h.job, now);
    expect(h.db.$transaction).toHaveBeenCalledOnce();
    expect(h.send).toHaveBeenCalledOnce();
  });
  it.each(["version", "cancelled", "disabled"])("rechecks %s after Discord recovery", async reason => {
    const h = harness();
    h.channel.messages.fetch.mockImplementation(async () => {
      if (reason === "version") h.e.scheduleVersion++;
      if (reason === "cancelled") { h.e.state = "CANCELLED"; h.e.startsAt = null; }
      if (reason === "disabled") h.b.enabled = false;
      return new Collection();
    });
    await deliverGameEvent(h.guild, h.db, h.job, now);
    expect(h.send).not.toHaveBeenCalled();
  });
  it.each(["channelId", "messageId", "updatedAt"])("retries a board whose %s changed during recovery", async field => {
    const h = harness("GAME_EVENT_BOARD");
    h.tx.gameEventBoard.findFirst.mockResolvedValueOnce({ ...h.b }).mockResolvedValueOnce({ ...h.b, [field]: field === "updatedAt" ? new Date(now.getTime() + 1) : "changed" });
    await expect(deliverGameEvent(h.guild, h.db, h.job, now)).rejects.toThrow("changed during preflight");
    expect(h.send).not.toHaveBeenCalled();
    expect(h.tx.gameEventBoard.update).not.toHaveBeenCalled();
  });
  it("never sends after history recovery exceeds its deadline", async () => {
    const h = harness();
    h.channel.messages.fetch.mockImplementation(async () => {
      vi.setSystemTime(new Date(now.getTime() + 45_000));
      return new Collection();
    });
    await expect(deliverGameEvent(h.guild, h.db, h.job, now)).rejects.toThrow("time limit");
    expect(h.send).not.toHaveBeenCalled();
    expect(h.db.$transaction).not.toHaveBeenCalled();
  });
  it("only pings the explicitly configured role", async () => {
    const h = harness(); await deliverGameEvent(h.guild, h.db, h.job, now);
    const transaction = h.db.$transaction as unknown as ReturnType<typeof vi.fn>;
    expect(h.send).toHaveBeenCalledOnce();
    expect(transaction).toHaveBeenCalledOnce();
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), EVENT_TRANSACTION_OPTIONS);
    expect(transaction.mock.invocationCallOrder[0]).toBeLessThan(h.send.mock.invocationCallOrder[0]!);
    expect(h.send.mock.calls[0]![0].content).toBe("<@&role>");
    expect(h.send.mock.calls[0]![0].allowedMentions).toEqual({ parse: [], roles: ["role"], users: [], repliedUser: false });
    const live = h.send.mock.calls[0]![0].embeds[0].toJSON();
    expect(live.title).toContain("THE GATES ARE OPEN");
    expect(live.description).toMatch(/<t:\d+:R>/);
    expect(live.description).toMatch(/<t:\d+:F>/);
    expect(live.description).not.toContain("to go");
    expect(live.image?.url).toContain("guilded-card.png");
  });
  it("pings the one-hour reminder and posts the day-before note without a role", async () => {
    const hour = harness();
    hour.job.payload = { boardId: hour.b.id, eventId: hour.e.id, scheduleVersion: 1, minutes: 60 };
    hour.e.startsAt = new Date(now.getTime() + 60 * 60_000);
    hour.b.wowReminders = [60];
    await deliverGameEvent(hour.guild, hour.db, hour.job, now);
    expect(hour.send.mock.calls[0]![0].content).toBe("<@&role>");
    expect(hour.send.mock.calls[0]![0].embeds[0].toJSON().description).toContain("Final countdown");
    const day = harness();
    day.job.payload = { boardId: day.b.id, eventId: day.e.id, scheduleVersion: 1, minutes: 1440 };
    day.e.startsAt = new Date(now.getTime() + 1440 * 60_000);
    await deliverGameEvent(day.guild, day.db, day.job, now);
    expect(day.send).toHaveBeenCalledOnce();
    expect(day.send.mock.calls[0]![0].content).toBeUndefined();
    expect(day.send.mock.calls[0]![0].allowedMentions.roles).toEqual([]);
    expect(day.send.mock.calls[0]![0].embeds[0].toJSON().description).toMatch(/<t:\d+:R>/);
  });
  it("says the gates are open in French when the guild language is French", async () => {
    const h = harness();
    h.b.guild.settings.language = "fr";
    await deliverGameEvent(h.guild, h.db, h.job, now);
    expect(h.send.mock.calls[0]![0].embeds[0].toJSON().title).toContain("LES PORTES SONT OUVERTES");
  });
  it("edits the pinned countdown instead of posting another message", async () => {
    const h = harness("GAME_EVENT_BOARD");
    h.b.messageId = "existing";
    h.b.contentHash = "stale";
    const edit = vi.fn();
    const existing = { id: "existing", author: { id: "bot" }, embeds: [{ footer: { text: "Guilded events board" } }], edit, pin: vi.fn(), pinned: true };
    h.channel.messages.fetch.mockImplementation(async (query: { message?: string } | undefined) => query?.message === "existing" ? existing : new Collection());
    await deliverGameEvent(h.guild, h.db, h.job, now);
    expect(h.send).not.toHaveBeenCalled();
    expect(edit).toHaveBeenCalledOnce();
    expect(edit.mock.calls[0]![0].allowedMentions).toEqual({ parse: [] });
    expect(edit.mock.calls[0]![0].content).toBeUndefined();
    expect(JSON.stringify(edit.mock.calls[0]![0].embeds.map((embed: { toJSON: () => unknown }) => embed.toJSON()))).toContain("THE GATES ARE OPEN");
  });
  it("pins the first countdown post and does not mention a role", async () => {
    const h = harness("GAME_EVENT_BOARD");
    const pin = vi.fn();
    h.send.mockResolvedValue({ id: "posted", pinned: false, pin, unpin: vi.fn() });
    await deliverGameEvent(h.guild, h.db, h.job, now);
    expect(h.send).toHaveBeenCalledOnce();
    expect(h.send.mock.calls[0]![0].allowedMentions).toEqual({ parse: [] });
    expect(h.send.mock.calls[0]![0].content).toBeUndefined();
    expect(pin).toHaveBeenCalledOnce();
  });
  it.each(["version", "cancelled", "disabled", "role"])('rechecks %s immediately before delivery', async reason => {
    const h = harness();
    if (reason === "version") h.e.scheduleVersion = 2;
    if (reason === "cancelled") { h.e.state = "CANCELLED"; h.e.startsAt = null; }
    if (reason === "disabled") h.b.enabled = false;
    if (reason === "role") h.b.wowRoleId = null;
    await deliverGameEvent(h.guild, h.db, h.job, now); expect(h.send).not.toHaveBeenCalled();
  });
  it("does not send a reminder if the event is cancelled after the plan is read", async () => {
    const h = harness();
    const transaction = h.db.$transaction as unknown as ReturnType<typeof vi.fn>;
    transaction.mockImplementation(async (fn: (tx: typeof h.tx) => unknown) => {
      const result = await fn(h.tx);
      h.e.state = "CANCELLED";
      h.e.startsAt = null;
      return result;
    });
    await deliverGameEvent(h.guild, h.db, h.job, now);
    expect(h.send).not.toHaveBeenCalled();
  });
  it("saves the posted board id even when the row is edited before the write", async () => {
    const h = harness("GAME_EVENT_BOARD");
    let reads = 0;
    h.tx.gameEventBoard.findFirst.mockImplementation(async () => {
      reads += 1;
      return reads >= 3 ? { ...h.b, updatedAt: new Date(now.getTime() + 5_000) } : h.b;
    });
    await deliverGameEvent(h.guild, h.db, h.job, now);
    expect(h.send).toHaveBeenCalledOnce();
    expect(h.tx.gameEventBoard.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ messageId: "posted" }) }));
  });
  it("retries the board-id save after the Discord post already exists", async () => {
    const h = harness("GAME_EVENT_BOARD");
    let calls = 0;
    const transaction = h.db.$transaction as unknown as ReturnType<typeof vi.fn>;
    transaction.mockImplementation(async (fn: (tx: typeof h.tx) => unknown) => {
      calls += 1;
      if (calls === 2) throw Object.assign(new Error("Transaction API error: Unable to start a transaction in the given time."), { code: "P2028" });
      return fn(h.tx);
    });
    const run = deliverGameEvent(h.guild, h.db, h.job, now);
    await vi.runAllTimersAsync();
    await run;
    expect(h.send).toHaveBeenCalledOnce();
    expect(calls).toBeGreaterThanOrEqual(3);
    expect(h.tx.gameEventBoard.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ messageId: "posted" }) }));
  });
  it("recovers an accepted reminder after a crash without sending it again", async () => {
    const h = harness();
    h.channel.messages.fetch.mockResolvedValue(new Collection([["sent", { author: { id: "bot" }, embeds: [{ footer: { text: "Guilded event reminder durable-job" } }] }]]));
    await deliverGameEvent(h.guild, h.db, h.job, now); expect(h.send).not.toHaveBeenCalled();
  });
  it("paginates past 100 messages and does not trust another bot's marker", async () => {
    const h = harness();
    const page = new Collection(Array.from({ length: 100 }, (_, i) => [`m${i}`, { id: `m${i}`, author: { id: "other" }, embeds: [{ footer: { text: "marker" } }], createdTimestamp: now.getTime() + i }]));
    const sent = { id: "sent", author: { id: "bot" }, embeds: [{ footer: { text: "marker" } }] };
    h.channel.messages.fetch.mockResolvedValueOnce(page).mockResolvedValueOnce(new Collection([["sent", sent]]));
    expect(await findEventMessage(h.channel as unknown as TextChannel, "marker", now)).toBe(sent);
    expect(h.channel.messages.fetch.mock.calls[1]![0]).toEqual({ limit: 100, before: "m0" });
  });
  it("recreates a deleted board and reuses a post accepted before the ID was committed", async () => {
    const h = harness("GAME_EVENT_BOARD"); h.b.messageId = "deleted";
    const recovered = { id: "recovered", author: { id: "bot" }, embeds: [{ footer: { text: "Guilded events board" } }], edit: vi.fn(), pin: vi.fn(), pinned: false };
    h.channel.messages.fetch.mockRejectedValueOnce({ code: 10008 }).mockResolvedValueOnce(new Collection([["recovered", recovered]]));
    await deliverGameEvent(h.guild, h.db, h.job, now);
    expect(h.send).not.toHaveBeenCalled(); expect(recovered.pin).toHaveBeenCalledOnce();
    const transaction = h.db.$transaction as unknown as ReturnType<typeof vi.fn>;
    expect(transaction).toHaveBeenNthCalledWith(1, expect.any(Function), EVENT_TRANSACTION_OPTIONS);
    expect(transaction).toHaveBeenNthCalledWith(2, expect.any(Function), EVENT_TRANSACTION_OPTIONS);
    expect(h.tx.gameEventBoard.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ messageId: "recovered" }) }));
  });
  it("does not recreate or send when history cannot be read", async () => {
    const h = harness("GAME_EVENT_BOARD"); h.b.messageId = "old";
    h.channel.messages.fetch.mockRejectedValue({ code: 50013 });
    await expect(deliverGameEvent(h.guild, h.db, h.job, now)).rejects.toEqual({ code: 50013 }); expect(h.send).not.toHaveBeenCalled();
  });
  it("rejects everyone, managed, privileged and unmentionable roles", async () => {
    const h = harness();
    for (const role of [{ id: "discord", permissions: { bitfield: 0n } }, { id: "role", managed: true, permissions: { bitfield: 0n } }, { id: "role", permissions: { bitfield: PermissionFlagsBits.Administrator } }, { id: "role", mentionable: false, permissions: { bitfield: 0n } }]) {
      vi.mocked(h.guild.roles.fetch).mockResolvedValue({ managed: false, mentionable: true, ...role } as never);
      await expect(eventRole(h.guild, "role", h.channel as unknown as TextChannel)).rejects.toThrow();
    }
  });
});

it("refuses server members and non-owner administrators before touching the database", async () => {
  const reply = vi.fn();
  const fetch = vi.fn();
  await executeGameEvents({ guild: { members: { fetch } }, memberPermissions: { has: () => false }, user: { id: "member" }, reply } as never);
  expect(reply).toHaveBeenCalledOnce();
  expect(fetch).not.toHaveBeenCalled();
  reply.mockClear();
  const deferReply = vi.fn(async () => undefined);
  const editReply = vi.fn();
  await executeOwnerEvents({ client: { application: { fetch: async () => ({ owner: { id: "owner" } }) } }, user: { id: "admin" }, deferReply, editReply, reply } as never);
  expect(reply).not.toHaveBeenCalled();
  expect(deferReply).toHaveBeenCalledOnce();
  expect(editReply).toHaveBeenCalledOnce();
});

it("the owner command fits Discord limits and has required options before optional ones", () => {
  const json = ownerEventsCommand.toJSON();
  let size = 0;
  function walk(value: unknown) {
    if (!value || typeof value !== "object") return;
    const row = value as { name?: string; description?: string; options?: { required?: boolean; type: number }[]; choices?: unknown[] };
    size += (row.name?.length ?? 0) + (row.description?.length ?? 0);
    let optional = false;
    for (const option of row.options ?? []) { if (option.type > 2) { if (option.required) expect(optional).toBe(false); else optional = true; } walk(option); }
    for (const choice of row.choices ?? []) walk(choice);
  }
  walk(json); expect(size).toBeLessThanOrEqual(4000);
});


describe("edition event isolation", () => {
  it("supports each WoW edition with its own official source and board label", () => {
    const rows = EVENT_GAMES.filter(game => game.startsWith("WOW_")).map((game, i) => event({ id: `edition-${i}`, game }));
    for (const row of rows) expect(validateEvent(row).game).toBe(row.game);
    expect(() => officialEventSource("UNKNOWN", "https://www.pathofexile.com/a")).toThrow();
    expect(() => officialEventSource("WOW_RETAIL", "https://www.pathofexile.com/a")).toThrow();
    const titles = eventBoardEmbeds(rows, board({ games: [...EVENT_GAMES] }), false, now).map(e => e.toJSON().title);
    expect(titles).toEqual(expect.arrayContaining(["WoW Forever", "WoW Classic Era", "WoW Classic TBC", "WoW Classic Mists", "WoW Retail", "Path of Exile 2"]));
  });
  it("never borrows Forever or PoE opt-ins for another edition and validates stored preferences", () => {
    const retail = event({ game: "WOW_RETAIL" });
    const all = board({ games: [...EVENT_GAMES], poeRoleId: "999", poeReminders: [0], poeRemindersEnabledAt: now });
    expect(reminderDue(retail, all, 0, now)).toBe(false);
    const configured = { ...all, editionReminders: { WOW_RETAIL: { role: "123", offsets: [0], enabledAt: now.toISOString() } } };
    expect(reminderDue(retail, configured, 0, now)).toBe(true);
    expect(reminderDue(event({ game: "WOW_CLASSIC_ERA" }), configured, 0, now)).toBe(false);
    expect(reminderSettings(configured, "WOW_RETAIL").role).toBe("123");
    for (const entry of [null, [], { role: "@everyone", offsets: [0], enabledAt: now.toISOString() }, { role: "123", offsets: [12], enabledAt: now.toISOString() }, { role: "123", offsets: [0], enabledAt: "invalid" }]) {
      expect(reminderDue(retail, { ...all, editionReminders: { WOW_RETAIL: entry } }, 0, now)).toBe(false);
    }
    const retained = retainEventReminders(configured, ["POE2"]);
    expect(retained).toEqual({ editionReminders: {}, wowRoleId: null, wowReminders: [], wowRemindersEnabledAt: null });
    expect(retainEventReminders({ ...configured, enabled: false }, [...EVENT_GAMES])).toMatchObject({ editionReminders: {}, wowRoleId: null, poeRoleId: null });
  });
});


it("fits all edition boards inside Discord's shared embed text budget", () => {
  for (const fr of [false, true]) {
    const rows = Array.from({ length: 12 }, (_, i) => event({ id: `long-${i}`, game: EVENT_GAMES[i % EVENT_GAMES.length]!, titleEn: "X".repeat(80), titleFr: "Y".repeat(80), sourceUrl: "https://news.blizzard.com/" + "a".repeat(194), startsAt: new Date(now.getTime() + 60000) }));
    const embeds = eventBoardEmbeds(rows, board({ games: [...EVENT_GAMES] }), fr, now).map(e => e.toJSON());
    const fields = embeds.flatMap(e => e.fields ?? []);
    expect(fields).toHaveLength(12);
    expect(fields.every(f => f.value.includes("https://news.blizzard.com/") && f.value.includes("<t:"))).toBe(true);
    expect(embeds.reduce((n, e) => n + (e.title?.length ?? 0) + (e.description?.length ?? 0) + (e.footer?.text.length ?? 0) + (e.fields ?? []).reduce((m, f) => m + f.name.length + f.value.length, 0), 0)).toBeLessThanOrEqual(6000);
  }
});
