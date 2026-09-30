import { EmbedBuilder, type ActionRowBuilder, type ButtonBuilder, type Guild as DiscordGuild, type Message, type MessageCreateOptions } from "discord.js";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../database.js";
import { asLang, t, type Lang } from "../i18n.js";
import { createGuildService } from "./guild.js";
import { deliverDiscordJob, dispatchDiscordJob, enqueueDiscordJob } from "./discord-jobs.js";

const guildService = createGuildService(prisma);

// Text that's rendered in the guild's language when it's posted.
export type Localized<T = string> = (lang: Lang) => T;

// "officer" and "application" are private (officer log / applications
// channel) only: no fallback to a public channel.
type NotifyKind = "notify" | "raidLog" | "loot" | "officer" | "application";

async function notifyAddress(discordGuild: DiscordGuild, kind: NotifyKind = "notify", coreId: string | null = null) {
  const guild = await guildService.ensureGuild(discordGuild.id, discordGuild.name);
  const settings = await guildService.getSettings(guild.id);
  if (kind === "officer" || kind === "application") {
    const channelId = kind === "application" ? (settings?.applicationChannelId ?? settings?.logChannelId) : settings?.logChannelId;
    if (!channelId) return null;
    return { guildId: guild.id, channelId, lang: asLang(settings?.language) };
  }
  const core = coreId && (kind === "raidLog" || kind === "loot") ? await prisma.raidCore.findFirst({ where: { id: coreId, guildId: guild.id }, select: { lootChannelId: true, raidLogChannelId: true } }) : null;
  const coreChannelId = kind === "raidLog" ? core?.raidLogChannelId : kind === "loot" ? core?.lootChannelId : null;
  const channelId = coreChannelId ?? (kind === "raidLog" ? settings?.raidLogChannelId : kind === "loot" ? settings?.lootChannelId : null) ?? settings?.notifyChannelId;
  if (!settings || !channelId) return null;
  return { guildId: guild.id, channelId, lang: asLang(settings.language) };
}

async function notifyTarget(discordGuild: DiscordGuild, kind: NotifyKind = "notify", coreId: string | null = null) {
  const address = await notifyAddress(discordGuild, kind, coreId);
  if (!address) return null;
  const channel = await discordGuild.channels.fetch(address.channelId).catch(() => null);
  return channel?.isTextBased() ? { channel, lang: address.lang } : null;
}

async function durableMessage(guild: DiscordGuild, guildId: string, channelId: string, message: MessageCreateOptions, route: NotifyKind | "dungeon", coreId: string | null = null): Promise<boolean> {
  const job = await enqueueDiscordJob(prisma, guildId, `message:${randomUUID()}`, "MESSAGE", { channelId, route, coreId, message: JSON.parse(JSON.stringify(message)) } as Prisma.InputJsonValue);
  await deliverDiscordJob(prisma, job.id, current => dispatchDiscordJob(guild, current));
  return (await prisma.discordJob.findUnique({ where: { id: job.id } }))?.status === "DONE";
}

// The same channel a notify()/notifyInteractive() call of this kind would
// use, for a caller that already has a message id and just needs to fetch
// and edit it later (e.g. syncing an applications card that /application
// approve|reject|trial decided, instead of a button click).
export const resolveNotifyChannel = notifyTarget;
export const resolveNotifyAddress = notifyAddress;

// Dungeon challenge posts go to /setup config channel, or the normal
// announcements channel when none is set.
export async function notifyDungeon(discordGuild: DiscordGuild | null, embed: Localized<EmbedBuilder>): Promise<boolean> {
  if (!discordGuild) return false;
  try {
    const guild = await guildService.ensureGuild(discordGuild.id, discordGuild.name);
    const settings = await guildService.getSettings(guild.id);
    const channelId = settings?.dungeonChannelId ?? settings?.notifyChannelId;
    if (!channelId) return false;
    return durableMessage(discordGuild, guild.id, channelId, { embeds: [embed(asLang(settings?.language))] }, "dungeon");
  } catch (error) {
    console.error("Failed to post dungeon announcement", error);
    return false;
  }
}

// Raid/boss/loot/EPGP announcements for the whole guild, posted to the
// channel set with /setup config channel. One line per event (batched
// commands post one line, not one per player). Never pings anyone and never
// throws: a failed announcement must not undo the action it describes.
export async function notify(discordGuild: DiscordGuild | null, content: string | Localized, kind: NotifyKind = "notify", coreId: string | null = null): Promise<void> {
  if (!discordGuild) return;
  try {
    const target = await notifyAddress(discordGuild, kind, coreId);
    if (!target) return;
    const text = typeof content === "string" ? content : content(target.lang);
    await durableMessage(discordGuild, target.guildId, target.channelId, { embeds: [new EmbedBuilder().setDescription(text.slice(0, 1900)).setColor(0xd4a017)] }, kind, coreId);
  } catch (error) {
    console.error("Failed to post notification", error);
  }
}

// Same rules as notify(), for richer posts like the raid report. Pass
// "raidLog" to prefer the raid-logs channel (falls back to announcements).
export async function notifyEmbed(discordGuild: DiscordGuild | null, embed: EmbedBuilder | Localized<EmbedBuilder>, channel: NotifyKind = "notify", coreId: string | null = null): Promise<boolean> {
  if (!discordGuild) return false;
  try {
    const target = await notifyAddress(discordGuild, channel, coreId);
    if (!target) return false;
    return durableMessage(discordGuild, target.guildId, target.channelId, { embeds: [typeof embed === "function" ? embed(target.lang) : embed] }, channel, coreId);
  } catch (error) {
    console.error("Failed to post notification embed", error);
    return false;
  }
}

// Same channel rules as notify(), for a message the caller needs a live
// reference to afterward (e.g. buttons that later edit the message itself
// to show the decision and remove the buttons). Null if there's no target
// channel, or the send failed.
export async function notifyInteractive(
  discordGuild: DiscordGuild | null,
  build: (lang: Lang) => { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] },
  kind: NotifyKind = "notify"
): Promise<Message | null> {
  if (!discordGuild) return null;
  try {
    const target = await notifyTarget(discordGuild, kind);
    if (!target) return null;
    return await target.channel.send({ ...build(target.lang), allowedMentions: { parse: [] } });
  } catch (error) {
    console.error("Failed to post interactive notification", error);
    return null;
  }
}

const signed = (value: number) => `${value >= 0 ? "+" : ""}${value}`;

export const notifications = {
  raidStarted: (raid: string): Localized => (lang) => t(lang, "notify.raidStarted", { raid }),
  raidEnded: (raid: string): Localized => (lang) => t(lang, "notify.raidEnded", { raid }),
  bossKilled: (boss: string, raid: string): Localized => (lang) => t(lang, "notify.bossKilled", { boss, raid }),
  lootAwarded: (item: string, winner: string, gp: number): Localized => (lang) => t(lang, "notify.loot", { item, winner, gp }),
  epgpChanged: (who: string, ep: number, gp: number, reason: string): Localized => (lang) => t(lang, "notify.epgp", {
    who, reason,
    change: `${ep ? `${signed(ep)} EP` : ""}${ep && gp ? ", " : ""}${gp ? `${signed(gp)} GP` : ""}`
  }),
  decayApplied: (percent: number, count: number): Localized => (lang) => t(lang, "notify.decay", { percent, count }),
  importApplied: (count: number, raids: number): Localized => (lang) => {
    const text = t(lang, "notify.import", { count, raids: raids ? t(lang, "notify.importRaids", { count: raids }) : "" });
    return lang === "en" && count === 1 ? text.replace("1 EPGP entries", "1 EPGP entry") : text;
  },
  epAwarded: (raid: string, count: number, total: number): Localized => (lang) => t(lang, "notify.epAwarded", { raid, count, total })
};
