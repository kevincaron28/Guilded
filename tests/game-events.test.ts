import { afterEach, describe, expect, it, vi } from "vitest";
import { Collection, ChannelType, PermissionFlagsBits, type Guild, type TextChannel } from "discord.js";
import type { DiscordJob, GameEventBoard, OfficialGameEvent, PrismaClient } from "../src/generated/prisma/client.js";
import { effectiveEventState, eventBoardEmbeds, officialEventSource, parseEventInstant, reminderDue, saveOfficialEvent, validateEvent, visibleEvent } from "../src/services/game-events.js";
import { deliverGameEvent, eventRole, findEventMessage } from "../src/services/game-events-discord.js";
import { ownerEventsCommand, executeGameEvents, executeOwnerEvents } from "../src/commands/game-events.js";

const now = new Date("2026-10-27T20:00:00Z");
const event = (overrides: Partial<OfficialGameEvent> = {}): OfficialGameEvent => ({ id: "names", game: "WOW_FOREVER", region: "NA", titleEn: "Name reservation", titleFr: "Réservation des noms", sourceUrl: "https://news.blizzard.com/en-us/article/24303866/claim-your-world-of-warcraft-forever-character-names", dateLabelEn: "", dateLabelFr: "", state: "SCHEDULED", startsAt: now, scheduleVersion: 1, archived: false, updatedBy: "owner", createdAt: now, updatedAt: now, ...overrides });
const board = (overrides: Partial<GameEventBoard> = {}): GameEventBoard => ({ id: "board", guildId: "record", channelId: "channel", enabled: true, games: ["WOW_FOREVER", "POE2"], region: "NA", messageId: null, contentHash: null, wowRoleId: "role", poeRoleId: null, wowReminders: [1440, 60, 0], poeReminders: [], poeRemindersEnabledAt: null, wowRemindersEnabledAt: new Date("2026-10-20T00:00:00Z"), createdAt: now, updatedAt: now, ...overrides });
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
  it("bounds the complete board to Discord's aggregate embed budget", () => {
    const rows = Array.from({ length: 12 }, (_, i) => event({ id: `e-${i}`, titleFr: "*".repeat(80), state: "TBA", startsAt: null, dateLabelFr: "*".repeat(100), sourceUrl: "https://news.blizzard.com/" + "a".repeat(195) }));
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

function harness(kind = "GAME_EVENT_REMINDER") {
  vi.useFakeTimers(); vi.setSystemTime(now);
  const b = { ...board(), guild: { settings: { language: "en" } } };
  const e = event();
  const job = { id: "durable-job", guildId: "record", kind, payload: { boardId: b.id, eventId: e.id, scheduleVersion: 1, minutes: 0 }, createdAt: now } as unknown as DiscordJob;
  const tx = { $executeRaw: vi.fn(), gameEventBoard: { findFirst: vi.fn().mockResolvedValue(b), update: vi.fn() }, officialGameEvent: { findUnique: vi.fn().mockResolvedValue(e), findMany: vi.fn().mockResolvedValue([e]) } };
  const db = { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) } as unknown as PrismaClient;
  const send = vi.fn().mockResolvedValue({ id: "posted", pinned: false, pin: vi.fn(), unpin: vi.fn() });
  const channel = { type: ChannelType.GuildText, client: { user: { id: "bot" } }, permissionsFor: () => ({ has: () => true }), messages: { fetch: vi.fn().mockResolvedValue(new Collection()) }, send };
  const guild = { id: "discord", client: channel.client, channels: { fetch: vi.fn().mockResolvedValue(channel) }, members: { fetchMe: vi.fn() }, roles: { fetch: vi.fn().mockResolvedValue({ id: "role", managed: false, mentionable: true, permissions: { bitfield: 0n } }) } } as unknown as Guild;
  return { b, e, job, tx, db, channel, guild, send };
}

describe("delivery and restart recovery", () => {
  it("only pings the explicitly configured role", async () => {
    const h = harness(); await deliverGameEvent(h.guild, h.db, h.job, now);
    expect(h.send).toHaveBeenCalledOnce();
    expect(h.send.mock.calls[0]![0].allowedMentions).toEqual({ parse: [], roles: ["role"], users: [], repliedUser: false });
  });
  it.each(["version", "cancelled", "disabled", "role"])('rechecks %s immediately before delivery', async reason => {
    const h = harness();
    if (reason === "version") h.e.scheduleVersion = 2;
    if (reason === "cancelled") { h.e.state = "CANCELLED"; h.e.startsAt = null; }
    if (reason === "disabled") h.b.enabled = false;
    if (reason === "role") h.b.wowRoleId = null;
    await deliverGameEvent(h.guild, h.db, h.job, now); expect(h.send).not.toHaveBeenCalled();
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
  await executeGameEvents({ guild: { members: { fetch: async () => ({ permissions: { has: () => false } }) } }, user: { id: "member" }, reply } as never);
  expect(reply).toHaveBeenCalledOnce(); reply.mockClear();
  await executeOwnerEvents({ client: { application: { fetch: async () => ({ owner: { id: "owner" } }) } }, user: { id: "admin" }, reply } as never);
  expect(reply).toHaveBeenCalledOnce();
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
