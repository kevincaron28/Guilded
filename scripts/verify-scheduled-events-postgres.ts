import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { ChannelType, Collection, GuildScheduledEventStatus, PermissionFlagsBits, PermissionsBitField } from "discord.js";
import { syncScheduledEvent } from "../src/services/scheduled-events.js";

// Real PostgreSQL locks/unique indexes/restore, with an offline Discord adapter.
export async function verifyScheduledEventsPostgres(database: PrismaClient, guildId: string) {
  const record = await database.guild.findUniqueOrThrow({ where: { id: guildId } });
  const now = new Date();
  const raid = await database.raid.create({ data: { guildId, title: "Release native event fixture", scheduledAt: new Date(now.getTime() + 86_400_000),
    createdBy: "release-test", signupChannelId: "event-channel", signupMessageId: "event-message" } });
  const channel = { id: "event-channel", isThread: () => false, type: ChannelType.GuildText,
    guild: { roles: { everyone: { id: record.discordId } } }, permissionsFor: () => new PermissionsBitField(PermissionFlagsBits.ViewChannel), permissionOverwrites: { cache: new Collection() } };
  const events = new Collection<string, Record<string, unknown>>();
  let sends = 0;
  const guild = { id: record.discordId, client: { user: { id: "release-bot" } }, channels: { fetch: async () => channel }, scheduledEvents: {
    fetch: async (options: { guildScheduledEvent?: string }) => options.guildScheduledEvent ? events.get(options.guildScheduledEvent) : events,
    create: async (options: Record<string, unknown>) => { sends++; const event = { ...options, id: `release-native-${sends}`, creatorId: "release-bot", status: GuildScheduledEventStatus.Scheduled }; events.set(event.id, event); return event; },
    edit: async (id: string, options: Record<string, unknown>) => { const event = { ...events.get(id), ...options }; events.set(id, event); return event; }
  } };
  await Promise.all([1, 2].map(() => syncScheduledEvent(guild as never, database, guildId, "raid", raid.id, now)));
  assert.equal(sends, 1);
  const link = await database.discordEventLink.findUniqueOrThrow({ where: { guildId_sourceType_sourceId: { guildId, sourceType: "raid", sourceId: raid.id } } });
  assert.equal(link.discordId, "release-native-1");
  await assert.rejects(database.discordEventLink.create({ data: { guildId, sourceType: "raid", sourceId: raid.id } }), (error: unknown) => (error as { code: string }).code === "P2002");
  await database.raid.update({ where: { id: raid.id }, data: { status: "CANCELLED" } });
  await syncScheduledEvent(guild as never, database, guildId, "raid", raid.id, now);
  assert.equal(events.get(link.discordId!)?.["status"], GuildScheduledEventStatus.Canceled);
  assert.equal((await database.discordEventLink.findUniqueOrThrow({ where: { id: link.id } })).settled, true);
}
