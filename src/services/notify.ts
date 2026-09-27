import type { EmbedBuilder, Guild as DiscordGuild } from "discord.js";
import { prisma } from "../database.js";
import { asLang, t, type Lang } from "../i18n.js";
import { createGuildService } from "./guild.js";

const guildService = createGuildService(prisma);

// Text that's rendered in the guild's language when it's posted.
export type Localized<T = string> = (lang: Lang) => T;

// "officer" and "application" are private (officer log / applications
// channel) only: no fallback to a public channel.
type NotifyKind = "notify" | "raidLog" | "loot" | "officer" | "application";

async function notifyTarget(discordGuild: DiscordGuild, kind: NotifyKind = "notify") {
  const guild = await guildService.ensureGuild(discordGuild.id, discordGuild.name);
  const settings = await guildService.getSettings(guild.id);
  if (kind === "officer" || kind === "application") {
    const channelId = kind === "application" ? (settings?.applicationChannelId ?? settings?.logChannelId) : settings?.logChannelId;
    if (!channelId) return null;
    const channel = await discordGuild.channels.fetch(channelId).catch(() => null);
    return channel?.isTextBased() ? { channel, lang: asLang(settings?.language) } : null;
  }
  const channelId = (kind === "raidLog" ? settings?.raidLogChannelId : kind === "loot" ? settings?.lootChannelId : null) ?? settings?.notifyChannelId;
  if (!settings || !channelId) return null;
  const channel = await discordGuild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return null;
  return { channel, lang: asLang(settings.language) };
}

// Dungeon challenge posts go to /setup config channel, or the normal
// announcements channel when none is set.
export async function notifyDungeon(discordGuild: DiscordGuild | null, embed: Localized<EmbedBuilder>): Promise<boolean> {
  if (!discordGuild) return false;
  try {
    const guild = await guildService.ensureGuild(discordGuild.id, discordGuild.name);
    const settings = await guildService.getSettings(guild.id);
    const channelId = settings?.dungeonChannelId ?? settings?.notifyChannelId;
    if (!channelId) return false;
    const channel = await discordGuild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) return false;
    await channel.send({ embeds: [embed(asLang(settings?.language))], allowedMentions: { parse: [] } });
    return true;
  } catch (error) {
    console.error("Failed to post dungeon announcement", error);
    return false;
  }
}

// Raid/boss/loot/EPGP announcements for the whole guild, posted to the
// channel set with /setup config channel. One line per event (batched
// commands post one line, not one per player). Never pings anyone and never
// throws: a failed announcement must not undo the action it describes.
export async function notify(discordGuild: DiscordGuild | null, content: string | Localized, kind: NotifyKind = "notify"): Promise<void> {
  if (!discordGuild) return;
  try {
    const target = await notifyTarget(discordGuild, kind);
    if (!target) return;
    const text = typeof content === "string" ? content : content(target.lang);
    await target.channel.send({ content: text.slice(0, 1900), allowedMentions: { parse: [] } });
  } catch (error) {
    console.error("Failed to post notification", error);
  }
}

// Same rules as notify(), for richer posts like the raid report. Pass
// "raidLog" to prefer the raid-logs channel (falls back to announcements).
export async function notifyEmbed(discordGuild: DiscordGuild | null, embed: EmbedBuilder | Localized<EmbedBuilder>, channel: NotifyKind = "notify"): Promise<boolean> {
  if (!discordGuild) return false;
  try {
    const target = await notifyTarget(discordGuild, channel);
    if (!target) return false;
    await target.channel.send({ embeds: [typeof embed === "function" ? embed(target.lang) : embed], allowedMentions: { parse: [] } });
    return true;
  } catch (error) {
    console.error("Failed to post notification embed", error);
    return false;
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
