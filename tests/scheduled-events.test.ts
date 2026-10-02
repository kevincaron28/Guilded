import { describe, expect, it, vi } from "vitest";
import { ChannelType, Collection, GuildScheduledEventStatus as Status, GuildScheduledEventEntityType as Entity, PermissionFlagsBits, PermissionsBitField } from "discord.js";
import { eventDescription, eventVenue, publicEventAudience, queueGuildScheduledEvents, queueScheduledEvent, removeGuildScheduledEvents, syncScheduledEvent, type EventSource } from "../src/services/scheduled-events.js";
import { withTransactionMock } from "./helpers/transaction.js";

const now = new Date("2026-10-01T12:00:00Z");
const start = new Date("2026-10-02T20:00:00Z");
const end = new Date("2026-10-03T00:00:00Z");
const stamp = "Guilded event guild:raid:raid";
function fixture() {
  const raid = { id: "raid", guildId: "guild", isTest: false, title: "Molten Core", description: "Bring flasks", scheduledAt: start, status: "PLANNED", signupChannelId: "signups", signupMessageId: "message", core: null as Record<string, unknown> | null };
  const activity = { id: "night", kind: "EVENT", title: "Co-op night", status: "OPEN", startsAt: start, endsAt: end, messageId: "night-message", rules: { capacity: 8, points: 10 }, season: { guildId: "guild", name: "October", channelId: "signups" } };
  let link: Record<string, unknown> | null = null;
  let job: { status: string } | null = null;
  const tx = {
    guild: { findFirst: vi.fn(async () => ({ id: "guild", discordId: "discord" })) },
    guildSettings: { findUnique: vi.fn(async () => ({ language: "en", raidSignupChannelId: "signups" })) },
    raid: { findFirst: vi.fn(async ({ where }) => where.guildId === "guild" && !raid.isTest ? raid : null), findMany: vi.fn(async () => [{ id: raid.id }]) },
    communityActivity: { findFirst: vi.fn(async ({ where }) => activity.kind === "EVENT" && where.season.guildId === "guild" ? activity : null), findMany: vi.fn(async () => [{ id: activity.id }]) },
    discordEventLink: {
      findUnique: vi.fn(async () => link), findMany: vi.fn(async () => link ? [link] : []),
      upsert: vi.fn(async ({ create, update }) => { link = link ? { ...link, ...update } : { id: "link", ...create }; return link; })
    },
    discordJob: { findUnique: vi.fn(async () => job), upsert: vi.fn(async () => { job = { status: "PENDING" }; return job; }) }
  };
  const database = withTransactionMock(tx);
  const overwrites = new Collection<string, { id: string; type: number; allow: PermissionsBitField; deny: PermissionsBitField }>();
  const channel = { id: "signups", parentId: "category", type: ChannelType.GuildText, isThread: () => false,
    guild: { roles: { everyone: { id: "everyone" } } }, permissionsFor: () => new PermissionsBitField(PermissionFlagsBits.ViewChannel), permissionOverwrites: { cache: overwrites } };
  const channels = new Collection<string, typeof channel>([[channel.id, channel]]);
  const events = new Collection<string, Record<string, unknown>>();
  let counter = 0;
  const guild = { id: "discord", client: { user: { id: "bot" } },
    channels: { fetch: vi.fn(async (id?: string) => id ? channels.get(id) ?? null : channels) },
    scheduledEvents: {
      fetch: vi.fn(async (options: { guildScheduledEvent?: string }) => {
        if (options.guildScheduledEvent) {
          const event = events.get(options.guildScheduledEvent);
          if (!event) throw Object.assign(new Error("Unknown event"), { code: 10070 });
          return event;
        }
        return events;
      }),
      create: vi.fn(async options => { const event = { id: `event-${++counter}`, creatorId: "bot", status: Status.Scheduled, ...options }; events.set(event.id, event); return event; }),
      edit: vi.fn(async (id: string, options) => { const event = { ...events.get(id), ...options }; events.set(id, event); return event; }),
      delete: vi.fn(async (id: string) => { events.delete(id); })
    }
  };
  return { database, tx, guild, raid, activity, events, channels, channel, overwrites,
    link: () => link, setLink: (row: Record<string, unknown>) => { link = row; }, setJob: (value: { status: string }) => { job = value; },
    sync: (type: "raid" | "community" = "raid", id = "raid", at = now) => syncScheduledEvent(guild as never, database as never, "guild", type, id, at) };
}

describe("native Discord events", () => {
  it("publishes one event with a signup link and reuses it after edits/restarts", async () => {
    const s = fixture();
    await s.sync();
    expect(s.guild.scheduledEvents.create).toHaveBeenCalledWith(expect.objectContaining({ name: "Molten Core", entityType: Entity.External, scheduledStartTime: start, scheduledEndTime: end,
      description: expect.stringContaining("https://discord.com/channels/discord/signups/message") }));
    expect(s.link()?.["discordId"]).toBe("event-1");
    s.raid.title = "Blackwing Lair";
    s.raid.scheduledAt = new Date("2026-10-04T20:00:00Z");
    await s.sync();
    expect(s.guild.scheduledEvents.create).toHaveBeenCalledOnce();
    expect(s.guild.scheduledEvents.edit).toHaveBeenCalledWith("event-1", expect.objectContaining({ name: "Blackwing Lair", scheduledStartTime: s.raid.scheduledAt }));
  });
  it("recovers a create that succeeded on Discord before its database write failed", async () => {
    const s = fixture();
    s.tx.discordEventLink.upsert.mockRejectedValueOnce(new Error("Database unavailable"));
    await expect(s.sync()).rejects.toThrow("Database unavailable");
    expect(s.link()).toBeNull();
    await s.sync();
    expect(s.guild.scheduledEvents.create).toHaveBeenCalledOnce();
    expect(s.link()?.["discordId"]).toBe("event-1");
  });
  it("serializes overlapping workers so they cannot create duplicates", async () => {
    const s = fixture();
    await Promise.all([s.sync(), s.sync()]);
    expect(s.guild.scheduledEvents.create).toHaveBeenCalledOnce();
  });
  it("uses valid cancellation transitions before and after starting", async () => {
    const s = fixture();
    await s.sync();
    s.raid.status = "ACTIVE";
    await s.sync();
    expect(s.events.get("event-1")?.["status"]).toBe(Status.Active);
    s.raid.status = "CANCELLED";
    await s.sync();
    expect(s.events.get("event-1")?.["status"]).toBe(Status.Completed);
    const planned = fixture();
    await planned.sync();
    planned.raid.status = "CANCELLED";
    await planned.sync();
    expect(planned.events.get("event-1")?.["status"]).toBe(Status.Canceled);
  });
  it("moves an already-active Discord event to a future date with a replacement", async () => {
    const s = fixture();
    await s.sync();
    s.events.get("event-1")!["status"] = Status.Active;
    s.raid.scheduledAt = new Date("2026-10-04T20:00:00Z");
    await s.sync();
    expect(s.events.get("event-1")?.["status"]).toBe(Status.Completed);
    expect(s.guild.scheduledEvents.create).toHaveBeenCalledTimes(2);
    expect(s.link()?.["discordId"]).toBe("event-2");
  });
  it("starts a scheduled event without trying to write a start time in the past", async () => {
    const s = fixture();
    await s.sync();
    await s.sync("raid", "raid", new Date(start.getTime() + 60_000));
    const contentEdit = s.guild.scheduledEvents.edit.mock.calls.find(call => call[1].name);
    expect(contentEdit?.[1]).not.toHaveProperty("scheduledStartTime");
    expect(s.events.get("event-1")?.["status"]).toBe(Status.Active);
  });
  it("does not restart a Discord event that already completed or create a past one", async () => {
    const s = fixture();
    await s.sync();
    s.events.get("event-1")!["status"] = Status.Completed;
    s.guild.scheduledEvents.edit.mockClear();
    await s.sync("raid", "raid", new Date(start.getTime() + 60_000));
    expect(s.guild.scheduledEvents.create).toHaveBeenCalledOnce();
    expect(s.guild.scheduledEvents.edit).not.toHaveBeenCalled();
    const late = fixture();
    await late.sync("raid", "raid", new Date(start.getTime() + 60_000));
    expect(late.guild.scheduledEvents.create).not.toHaveBeenCalled();
  });
  it("replaces a removed event only while the raid is still in the future", async () => {
    const s = fixture();
    await s.sync();
    s.events.clear();
    await s.sync();
    expect(s.guild.scheduledEvents.create).toHaveBeenCalledTimes(2);
    expect(s.link()?.["discordId"]).toBe("event-2");
  });
  it("recovers a replacement whose create succeeded before the new ID could be saved", async () => {
    const s = fixture();
    await s.sync();
    s.events.get("event-1")!["status"] = Status.Canceled;
    s.raid.scheduledAt = new Date("2026-10-04T20:00:00Z");
    s.tx.discordEventLink.upsert.mockRejectedValueOnce(new Error("Database unavailable"));
    await expect(s.sync()).rejects.toThrow("Database unavailable");
    await s.sync();
    expect(s.guild.scheduledEvents.create).toHaveBeenCalledTimes(2);
    expect(s.link()?.["discordId"]).toBe("event-2");
  });
  it("does not mistake another organizer's event for the bot's event", async () => {
    const s = fixture();
    s.events.set("manual", { id: "manual", creatorId: "human", name: s.raid.title, description: stamp, status: Status.Scheduled });
    await s.sync();
    expect(s.guild.scheduledEvents.create).toHaveBeenCalledOnce();
    expect(s.events.get("manual")?.["status"]).toBe(Status.Scheduled);
    s.setLink({ discordId: "manual" });
    await expect(s.sync()).rejects.toMatchObject({ code: "event-ownership-mismatch" });
  });
  it("propagates permission/API errors instead of treating them as a deleted event", async () => {
    const s = fixture();
    s.setLink({ discordId: "existing" });
    s.guild.scheduledEvents.fetch.mockRejectedValueOnce(Object.assign(new Error("Forbidden"), { code: 50013 }));
    await expect(s.sync()).rejects.toMatchObject({ code: 50013 });
    expect(s.guild.scheduledEvents.create).not.toHaveBeenCalled();
  });
  it("never publishes test raids, foreign sources or jobs from a retired guild", async () => {
    const s = fixture();
    s.raid.isTest = true;
    await s.sync();
    expect(s.guild.scheduledEvents.create).not.toHaveBeenCalled();
    s.tx.guild.findFirst.mockResolvedValueOnce(null as never);
    await s.sync();
    expect(s.guild.scheduledEvents.create).not.toHaveBeenCalled();
    await syncScheduledEvent(s.guild as never, s.database as never, "other-guild", "raid", "raid", now);
    expect(s.guild.scheduledEvents.create).not.toHaveBeenCalled();
  });
  it("mirrors gaming nights and starts/closes them without awarding attendance", async () => {
    const s = fixture();
    await s.sync("community", "night");
    expect(s.guild.scheduledEvents.create).toHaveBeenCalledWith(expect.objectContaining({ name: "Co-op night", scheduledEndTime: end }));
    await s.sync("community", "night", new Date(start.getTime() + 1000));
    expect(s.events.get("event-1")?.["status"]).toBe(Status.Active);
    s.activity.status = "CLOSED";
    await s.sync("community", "night");
    expect(s.events.get("event-1")?.["status"]).toBe(Status.Completed);
  });
  it("cancels the linked event when its source was deleted", async () => {
    const s = fixture();
    await s.sync();
    s.tx.raid.findFirst.mockResolvedValue(null as never);
    await s.sync();
    expect(s.events.get("event-1")?.["status"]).toBe(Status.Canceled);
  });
  it("bounds names/descriptions and preserves the signup link and recovery identity", async () => {
    const s = fixture();
    s.raid.title = "A".repeat(200);
    s.raid.description = "D".repeat(2000);
    await s.sync();
    const options = s.guild.scheduledEvents.create.mock.calls[0]![0];
    expect(options.name).toHaveLength(100);
    expect(options.description.length).toBeLessThanOrEqual(1000);
    expect(options.description.endsWith(stamp)).toBe(true);
    const source: EventSource = { type: "community", id: "night", title: "Soirée", description: "", startsAt: start, endsAt: end, state: "scheduled", channelId: "signups", messageId: "message", audienceChannelId: "signups", voiceChannelId: null, language: "fr" };
    expect(eventDescription("discord", "guild", source)).toContain("Inscris-toi");
  });
});

describe("event delivery repair and privacy", () => {
  it("queues existing upcoming raids/game nights but keeps retry backoff intact", async () => {
    const s = fixture();
    await queueGuildScheduledEvents(s.database as never, "guild", now);
    expect(s.tx.discordJob.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ kind: "SCHEDULED_EVENT" }) }));
    s.tx.discordJob.upsert.mockClear();
    s.setJob({ status: "PENDING" });
    await queueScheduledEvent(s.database as never, "guild", "raid", "raid", now);
    expect(s.tx.discordJob.upsert).not.toHaveBeenCalled();
  });
  it("does not queue unchanged deliveries, test raids or non-calendar activities", async () => {
    const s = fixture();
    await s.sync();
    await queueScheduledEvent(s.database as never, "guild", "raid", "raid", now);
    expect(s.tx.discordJob.upsert).not.toHaveBeenCalled();
    s.raid.isTest = true;
    s.activity.kind = "LOTTERY";
    const empty = fixture();
    empty.activity.kind = "LOTTERY";
    await queueScheduledEvent(empty.database as never, "guild", "community", "night", now);
    expect(empty.tx.discordJob.upsert).not.toHaveBeenCalled();
  });
  it("keeps private activities off server-wide events and chooses a matching voice", async () => {
    const s = fixture();
    s.channel.permissionsFor = () => new PermissionsBitField(0n);
    s.overwrites.set("everyone", { id: "everyone", type: 0, allow: new PermissionsBitField(0n), deny: new PermissionsBitField(PermissionFlagsBits.ViewChannel) });
    await expect(s.sync()).rejects.toMatchObject({ code: "event-private-venue" });
    expect(s.guild.scheduledEvents.create).not.toHaveBeenCalled();
    s.channels.set("voice", { ...s.channel, id: "voice", type: ChannelType.GuildVoice });
    await s.sync();
    expect(s.guild.scheduledEvents.create).toHaveBeenCalledWith(expect.objectContaining({ entityType: Entity.Voice, channel: "voice" }));
  });
  it("rejects an explicit voice with broader visibility, including member exceptions", async () => {
    const s = fixture();
    s.overwrites.set("member", { id: "member", type: 1, allow: new PermissionsBitField(0n), deny: new PermissionsBitField(PermissionFlagsBits.ViewChannel) });
    expect(publicEventAudience(s.channel as never)).toBe(false);
    s.channels.set("voice", { ...s.channel, id: "voice", type: ChannelType.GuildVoice, permissionOverwrites: { cache: new Collection() } });
    await expect(eventVenue(s.guild as never, "signups", "voice")).rejects.toMatchObject({ code: "event-voice-audience" });
  });
  it("removes only Guilded-owned events during reset, including lost-create recovery", async () => {
    const s = fixture();
    await s.sync();
    s.events.set("lost", { id: "lost", creatorId: "bot", description: "Guilded event guild:community:night" });
    s.events.set("human", { id: "human", creatorId: "human", description: stamp });
    s.events.set("other", { id: "other", creatorId: "bot", description: "Guilded event other-guild:raid:raid" });
    await removeGuildScheduledEvents(s.guild as never, s.database as never, "guild");
    expect([...s.events.keys()]).toEqual(["human", "other"]);
  });
});
