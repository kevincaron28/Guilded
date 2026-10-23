import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  ChannelType, GuildScheduledEventEntityType, GuildScheduledEventPrivacyLevel,
  GuildScheduledEventStatus, PermissionFlagsBits,
  type Guild, type GuildChannel, type GuildScheduledEvent, type GuildScheduledEventCreateOptions
} from "discord.js";
import { enqueueDiscordJob } from "./discord-jobs.js";
import { eventRules } from "./community-rules.js";
import { communityActivityChannel, communitySeasonLabel } from "./community-display.js";
import { assertCommunityChannelAudience } from "./community-access.js";

export type EventSourceType = "raid" | "community";
export interface EventSource {
  type: EventSourceType; id: string; title: string; description: string;
  startsAt: Date; endsAt: Date; state: "scheduled" | "active" | "completed" | "cancelled";
  channelId: string | null; messageId: string | null;
  audienceChannelId: string | null; voiceChannelId: string | null; language: string;
  scopeChannelId?: string;
}
type Db = Pick<PrismaClient, "raid" | "communityActivity" | "guildSettings" | "discordEventLink" | "discordJob">;
const key = (type: EventSourceType, id: string) => `scheduled-event:${type}:${id}`;
const marker = (guildId: string, type: EventSourceType, id: string) => `Guilded event ${guildId}:${type}:${id}`;
const signature = (source: EventSource | null) => createHash("sha256").update(JSON.stringify(source)).digest("hex");
const fail = (code: string): never => { throw Object.assign(new Error(code), { code }); };
const missingEvent = (error: unknown) => !!error && typeof error === "object" && "code" in error && error.code === 10070;

async function readSource(database: Db, guildId: string, type: EventSourceType, id: string, now: Date): Promise<EventSource | null> {
  const settings = await database.guildSettings.findUnique({ where: { guildId }, select: { language: true, raidSignupChannelId: true } });
  if (type === "raid") {
    const raid = await database.raid.findFirst({ where: { id, guildId, isTest: false }, include: { core: true } });
    if (!raid) return null;
    const endsAt = new Date(raid.scheduledAt.getTime() + 4 * 3_600_000);
    return { type, id, title: raid.title, description: raid.description ?? "", startsAt: raid.scheduledAt, endsAt,
      state: raid.status === "CANCELLED" ? "cancelled" : raid.status === "COMPLETED" || now >= endsAt ? "completed" : raid.status === "ACTIVE" || now >= raid.scheduledAt ? "active" : "scheduled",
      channelId: raid.signupChannelId, messageId: raid.signupMessageId,
      audienceChannelId: raid.core?.chatChannelId ?? raid.signupChannelId ?? settings?.raidSignupChannelId ?? null,
      voiceChannelId: raid.core?.voiceChannelId ?? null, language: settings?.language ?? "en" };
  }
  const row = await database.communityActivity.findFirst({ where: { id, kind: "EVENT", season: { guildId } }, include: { season: true } });
  if (!row?.startsAt) return null;
  return { type, id, title: row.title, description: communitySeasonLabel(row.season, settings?.language === "fr" ? "fr" : "en"), startsAt: row.startsAt, endsAt: row.endsAt,
    state: row.status === "CANCELLED" ? "cancelled" : row.status === "CLOSED" || now >= row.endsAt ? "completed" : now >= row.startsAt ? "active" : "scheduled",
    channelId: communityActivityChannel(row), messageId: row.messageId, audienceChannelId: communityActivityChannel(row), scopeChannelId: row.season.channelId,
    voiceChannelId: eventRules.parse(row.rules).voiceChannelId ?? null, language: settings?.language ?? "en" };
}

// Compare only visibility overrides: posting/connect permissions can differ. Exact
// equivalence also covers members with several roles and member-specific exceptions.
export function eventVisibility(channel: GuildChannel): string {
  return [...channel.permissionOverwrites.cache.values()].map(overwrite =>
    `${overwrite.type}:${overwrite.id}:${overwrite.allow.bitfield & PermissionFlagsBits.ViewChannel}:${overwrite.deny.bitfield & PermissionFlagsBits.ViewChannel}`)
    .filter(value => !value.endsWith(":0:0")).sort().join("|");
}
export function publicEventAudience(channel: GuildChannel): boolean {
  return !!channel.permissionsFor(channel.guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel)
    && ![...channel.permissionOverwrites.cache.values()].some(overwrite => overwrite.deny.has(PermissionFlagsBits.ViewChannel));
}

// External events are visible server-wide. Private activities use an existing voice
// channel with the same visibility; never broaden the audience to get a post through.
export async function eventVenue(guild: Guild, audienceChannelId: string | null, voiceChannelId: string | null) {
  if (!audienceChannelId) return fail("event-channel-missing");
  const source = await guild.channels.fetch(audienceChannelId);
  if (!source || source.isThread()) return fail("event-channel-missing");
  const visibility = eventVisibility(source);
  if (voiceChannelId) {
    const voice = await guild.channels.fetch(voiceChannelId);
    if (!voice || voice.type !== ChannelType.GuildVoice) return fail("event-voice-missing");
    if (!publicEventAudience(source) && eventVisibility(voice) !== visibility) return fail("event-voice-audience");
    return { entityType: GuildScheduledEventEntityType.Voice as const, channel: voice.id };
  }
  if (publicEventAudience(source)) return { entityType: GuildScheduledEventEntityType.External as const, entityMetadata: { location: "Guilded" } };
  const channels = await guild.channels.fetch();
  const voice = channels.find(channel => channel?.type === ChannelType.GuildVoice && channel.parentId === source.parentId && eventVisibility(channel) === visibility);
  if (!voice) return fail("event-private-venue");
  return { entityType: GuildScheduledEventEntityType.Voice as const, channel: voice.id };
}

export function eventDescription(guildDiscordId: string, guildId: string, source: EventSource): string {
  const instructions = source.language === "fr" ? "Inscris-toi avec les boutons Guilded. « Intéressé » sert aux notifications Discord."
    : "Sign up using the Guilded buttons. Interested is for Discord notifications.";
  const link = source.channelId && source.messageId ? `https://discord.com/channels/${guildDiscordId}/${source.channelId}/${source.messageId}` : "";
  const footer = [instructions, link, marker(guildId, source.type, source.id)].filter(Boolean).join("\n");
  return [source.description.slice(0, Math.max(0, 999 - footer.length)), footer].filter(Boolean).join("\n");
}

export async function queueScheduledEvent(database: Db, guildId: string, type: EventSourceType, id: string, now = new Date()): Promise<void> {
  const source = await readSource(database, guildId, type, id, now);
  const link = await database.discordEventLink.findUnique({ where: { guildId_sourceType_sourceId: { guildId, sourceType: type, sourceId: id } } });
  if (!source && !link) return;
  if (link?.signature === signature(source)) return;
  if (!link && source && (source.state === "completed" || source.state === "cancelled")) return;
  // A reconciliation pass must not reset backoff or steal a live delivery lease.
  const job = await database.discordJob.findUnique({ where: { guildId_key: { guildId, key: key(type, id) } } });
  if (job?.status === "PENDING") return;
  await enqueueDiscordJob(database, guildId, key(type, id), "SCHEDULED_EVENT", { sourceType: type, sourceId: id });
}

export async function queueGuildScheduledEvents(database: Db, guildId: string, now = new Date()): Promise<void> {
  const [raids, activities, links] = await Promise.all([
    database.raid.findMany({ where: { guildId, isTest: false, status: { in: ["PLANNED", "ACTIVE"] }, scheduledAt: { gte: new Date(now.getTime() - 4 * 3_600_000) } }, select: { id: true } }),
    database.communityActivity.findMany({ where: { season: { guildId }, kind: "EVENT", status: "OPEN", endsAt: { gt: now } }, select: { id: true } }),
    database.discordEventLink.findMany({ where: { guildId, settled: false }, select: { sourceType: true, sourceId: true } })
  ]);
  const sources = new Map<string, { type: EventSourceType; id: string }>();
  for (const raid of raids) sources.set(key("raid", raid.id), { type: "raid", id: raid.id });
  for (const row of activities) sources.set(key("community", row.id), { type: "community", id: row.id });
  for (const link of links) if (link.sourceType === "raid" || link.sourceType === "community") sources.set(key(link.sourceType, link.sourceId), { type: link.sourceType, id: link.sourceId });
  for (const source of sources.values()) await queueScheduledEvent(database, guildId, source.type, source.id, now);
}

// Serializing the native event writes also protects two workers whose job leases
// overlap. After an ambiguous create response, recover by the bot-owned marker.
export async function syncScheduledEvent(guild: Guild, database: PrismaClient, guildId: string, type: EventSourceType, id: string, now = new Date()): Promise<void> {
  await database.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`scheduled-events:${guildId}`}, 0))`;
    const record = await tx.guild.findFirst({ where: { id: guildId, discordId: guild.id } });
    if (!record) return; // Reset/uninstall retired this guild identity.
    const source = await readSource(tx as Db, guildId, type, id, now);
    const where = { guildId_sourceType_sourceId: { guildId, sourceType: type, sourceId: id } };
    const link = await tx.discordEventLink.findUnique({ where });
    const stamp = marker(guildId, type, id);
    const owned = (event: GuildScheduledEvent) => event.creatorId === guild.client.user?.id && event.description?.split("\n").at(-1) === stamp;
    let event = link?.discordId ? await guild.scheduledEvents.fetch({ guildScheduledEvent: link.discordId, force: true }).catch((error: unknown) => {
      if (missingEvent(error)) return null;
      throw error;
    }) : null;
    if (event && !owned(event)) return fail("event-ownership-mismatch");
    const finished = (event: GuildScheduledEvent) => event.status === GuildScheduledEventStatus.Completed || event.status === GuildScheduledEventStatus.Canceled;
    if (!event || (finished(event) && source && source.startsAt > now && (source.state === "scheduled" || source.state === "active"))) {
      const events = await guild.scheduledEvents.fetch({ cache: false });
      event = events.find(candidate => owned(candidate) && !finished(candidate)) ?? event ?? events.find(owned) ?? null;
    }
    const terminal = !source || source.state === "cancelled" || source.state === "completed";
    if (terminal) {
      if (event?.status === GuildScheduledEventStatus.Scheduled) await guild.scheduledEvents.edit(event.id, { status: GuildScheduledEventStatus.Canceled });
      else if (event?.status === GuildScheduledEventStatus.Active) await guild.scheduledEvents.edit(event.id, { status: GuildScheduledEventStatus.Completed });
    } else {
      if (source.scopeChannelId && source.channelId) await assertCommunityChannelAudience(guild, source.scopeChannelId, source.channelId);
      if (event?.status === GuildScheduledEventStatus.Active && source.state === "scheduled") {
        await guild.scheduledEvents.edit(event.id, { status: GuildScheduledEventStatus.Completed });
        event = null; // Moving an already-active native event requires a replacement.
      }
      const venue = await eventVenue(guild, source.audienceChannelId, source.voiceChannelId);
      if (venue.entityType === GuildScheduledEventEntityType.External) venue.entityMetadata.location = source.type === "raid" ? "World of Warcraft" : "Gaming / Jeux";
      const options: GuildScheduledEventCreateOptions = { ...venue, name: source.title.slice(0, 100), description: eventDescription(guild.id, guildId, source),
        scheduledStartTime: source.startsAt, scheduledEndTime: source.endsAt, privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly };
      // Do not recreate a deleted/finished event in the past, or resurrect terminal
      // Discord events. A future reschedule may replace a terminal event.
      if ((!event || finished(event)) && source.startsAt > now) {
        if (!source.messageId) return fail("event-signup-message-missing");
        event = await guild.scheduledEvents.create(options);
      } else if (event?.status === GuildScheduledEventStatus.Scheduled) {
        const edit: Parameters<Guild["scheduledEvents"]["edit"]>[1] = { ...options, channel: "channel" in venue ? venue.channel : null };
        if (source.startsAt <= now) delete edit.scheduledStartTime;
        await guild.scheduledEvents.edit(event.id, edit);
      } else if (event?.status === GuildScheduledEventStatus.Active) {
        // Discord does not permit changing an active event's start time/type.
        await guild.scheduledEvents.edit(event.id, { name: options.name, description: options.description!, scheduledEndTime: source.endsAt });
      }
      if (event?.status === GuildScheduledEventStatus.Scheduled && source.state === "active") await guild.scheduledEvents.edit(event.id, { status: GuildScheduledEventStatus.Active });
    }
    await tx.discordEventLink.upsert({ where, create: { guildId, sourceType: type, sourceId: id, discordId: event?.id ?? null, signature: signature(source), settled: terminal },
      update: { discordId: event?.id ?? null, signature: signature(source), settled: terminal } });
    if (type === "community" && source?.messageId && link?.discordId !== event?.id) {
      await enqueueDiscordJob(tx, guildId, `community:${id}`, "COMMUNITY_POST", { activityId: id });
    }
  }, { timeout: 60_000, maxWait: 15_000 });
}

export async function removeGuildScheduledEvents(guild: Guild, database: Pick<PrismaClient, "discordEventLink">, guildId: string): Promise<void> {
  const links = await database.discordEventLink.findMany({ where: { guildId } });
  // Includes an event created successfully just before a lost response/database write.
  const events = await guild.scheduledEvents.fetch({ cache: false });
  for (const event of events.values()) {
    const footer = event.description?.split("\n").at(-1);
    if (event.creatorId !== guild.client.user?.id || !footer?.startsWith(`Guilded event ${guildId}:`)) continue;
    if (!links.some(link => link.discordId === event.id) && !/^Guilded event [^:]+:(raid|community):[^:]+$/.test(footer)) continue;
    await guild.scheduledEvents.delete(event.id);
  }
}
