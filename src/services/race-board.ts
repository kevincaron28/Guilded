import { AttachmentBuilder, ChannelType, EmbedBuilder, escapeMarkdown, PermissionFlagsBits, type Guild as DiscordGuild, type Message } from "discord.js";
import { characterKey } from "../../companion/character-identity.mjs";
import { prisma } from "../database.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { asLang, type Lang } from "../i18n.js";
import { createGuildService } from "./guild.js";
import { deliverDiscordJob, dispatchDiscordJob, enqueueDiscordJob } from "./discord-jobs.js";
import { classColor, scoreCardPng, type ScoreCard } from "./score-card.js";

// The live "Race to 60" board (8.5, track B1): ONE bot message in its own channel, edited in place after every
// sync that changes a level and on the 30-minute refresh. Same pattern as the duel board: a marker in the footer,
// a pure builder, refresh through discord-jobs, opt-in per server (GuildSettings.raceBoardEnabled). Nothing is
// awarded and nothing is posted as new chatter. Every guild character counts, linked or not; members can hide
// theirs with `/character race hide`.

const guildService = createGuildService(prisma);
export const RACE_BOARD_MARKER = "Guilded race board";
export const LEVEL_CAP = 60;
const BARS = 14, FINISHERS = 10, GAINERS = 3;

export interface RaceChar { key: string; name: string; className: string; level: number; memberId: string | null }
export interface RaceEntryState { level: number; reachedMaxAt: Date | null; weekStartLevel: number; weekStartedAt: Date }
export interface RaceRow { name: string; className: string; level: number; reachedMaxAt: Date | null; weekGain: number; memberId: string | null }
export interface RaceBoardData { rows: RaceRow[]; total: number; finished: number; edition: string }

/** Monday 00:00 UTC of the week containing `now`. */
export function weekStart(now: Date): Date {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  return start;
}

/**
 * Pure: the stored state after seeing a character at `level`. A level that went down means the name was
 * re-rolled, so its history restarts. First seen at the cap counts as reaching it now (the real date is unknowable).
 */
export function nextEntry(previous: RaceEntryState | null, level: number, now: Date): RaceEntryState {
  const monday = weekStart(now);
  if (!previous || level < previous.level) return { level, reachedMaxAt: level >= LEVEL_CAP ? now : null, weekStartLevel: level, weekStartedAt: monday };
  const rolled = previous.weekStartedAt < monday;
  return {
    level,
    reachedMaxAt: previous.reachedMaxAt ?? (level >= LEVEL_CAP ? now : null),
    weekStartLevel: rolled ? previous.level : previous.weekStartLevel,
    weekStartedAt: rolled ? monday : previous.weekStartedAt
  };
}

/** Pure: finishers first in the order they got there, then everyone else by level (ties by name). */
export function orderRace(rows: RaceRow[]): RaceRow[] {
  const done = rows.filter(row => row.level >= LEVEL_CAP).sort((a, b) => (a.reachedMaxAt?.getTime() ?? 0) - (b.reachedMaxAt?.getTime() ?? 0) || a.name.localeCompare(b.name));
  const racing = rows.filter(row => row.level < LEVEL_CAP).sort((a, b) => b.level - a.level || a.name.localeCompare(b.name));
  return [...done, ...racing];
}

/** Pure: up to `limit` other characters within `spread` levels of `level`, closest first. */
export function nearLevel(rows: RaceRow[], level: number, own: ReadonlySet<string>, spread = 3, limit = 8): RaceRow[] {
  return rows.filter(row => row.level < LEVEL_CAP && !own.has(row.name.toLowerCase()) && Math.abs(row.level - level) <= spread)
    .sort((a, b) => Math.abs(a.level - level) - Math.abs(b.level - level) || a.name.localeCompare(b.name)).slice(0, limit);
}

export function raceCard(data: RaceBoardData, lang: Lang): ScoreCard {
  const fr = lang === "fr";
  return {
    eyebrow: "Guilded · WoW Forever", title: fr ? "Course au niveau 60" : "Race to 60",
    subtitle: fr ? `${data.finished} sur ${data.total} personnages au niveau ${LEVEL_CAP}` : `${data.finished} of ${data.total} characters at level ${LEVEL_CAP}`,
    stats: [], footer: fr ? "Tous les personnages de la guilde, liés ou non · les membres peuvent se masquer" : "Every guild character, linked or not · members can hide theirs",
    race: data.rows.slice(0, BARS).map(row => ({ name: row.name, color: classColor(row.className), level: row.level, max: LEVEL_CAP, done: row.level >= LEVEL_CAP,
      ...(row.weekGain > 0 ? { note: fr ? `+${row.weekGain} sem.` : `+${row.weekGain} wk` } : {}) }))
  };
}

/** Pure: the board's embed. `image` is the attachment name the card is sent under. */
export function raceBoardEmbed(data: RaceBoardData, lang: Lang, guildId = "", image?: string): EmbedBuilder {
  const fr = lang === "fr";
  const t = (en: string, french: string) => fr ? french : en;
  const name = (value: string) => escapeMarkdown(value).slice(0, 32);
  const embed = new EmbedBuilder().setColor(0xffd100).setTitle(t("🏁 Race to 60", "🏁 Course au niveau 60"));
  if (!data.total) {
    embed.setDescription(t("No levelled character reported yet. Officers' addon uploads fill this board.", "Aucun personnage avec niveau rapporté. Les envois de l'addon des officiers remplissent ce tableau."));
  } else {
    embed.setDescription(t(`**${data.finished}** of **${data.total}** characters have reached level ${LEVEL_CAP}.`, `**${data.finished}** personnages sur **${data.total}** ont atteint le niveau ${LEVEL_CAP}.`));
    const done = data.rows.filter(row => row.level >= LEVEL_CAP).slice(0, FINISHERS);
    if (done.length) {
      embed.addFields({ name: t("Finish order", "Ordre d'arrivée"), value: done.map((row, index) => `${["🥇", "🥈", "🥉"][index] ?? `**${index + 1}.**`} ${name(row.name)}${row.reachedMaxAt ? ` · <t:${Math.floor(row.reachedMaxAt.getTime() / 1000)}:d>` : ""}`).join("\n").slice(0, 1024) });
    }
    const racing = data.rows.filter(row => row.level < LEVEL_CAP).slice(0, 5);
    if (racing.length) embed.addFields({ name: t("Still racing", "Toujours en course"), value: racing.map(row => `${name(row.name)} — ${t("level", "niveau")} ${row.level}`).join("\n").slice(0, 1024) });
    const gainers = data.rows.filter(row => row.weekGain > 0).sort((a, b) => b.weekGain - a.weekGain || a.name.localeCompare(b.name)).slice(0, GAINERS);
    if (gainers.length) embed.addFields({ name: t("Most levels this week", "Plus de niveaux cette semaine"), value: gainers.map(row => `${name(row.name)} +${row.weekGain}`).join("\n").slice(0, 1024) });
  }
  if (image && data.total) embed.setImage(`attachment://${image}`);
  return embed.setFooter({ text: `${RACE_BOARD_MARKER} • ${guildId} • ${t("/character race near finds partners at your level · /character race hide opts out", "/character race near trouve des partenaires de ton niveau · /character race hide pour te masquer")}`.slice(0, 2048) });
}

/** Records every guild character's level, then returns the board's data. Hidden members' characters are left out. */
export async function loadRaceBoardData(db: Pick<PrismaClient, "character" | "unclaimedCharacter" | "levelRaceEntry">, guildId: string, edition: string, now = new Date()): Promise<RaceBoardData> {
  const linked = await db.character.findMany({ where: { guildId, gameEdition: edition, level: { not: null }, member: { guildId, status: "ACTIVE", raceHidden: false } },
    select: { name: true, realm: true, className: true, level: true, memberId: true } });
  const hiddenLinked = await db.character.findMany({ where: { guildId, gameEdition: edition, member: { guildId, raceHidden: true } }, select: { name: true, realm: true } });
  const unclaimed = await db.unclaimedCharacter.findMany({ where: { guildId, gameEdition: edition, level: { not: null } }, select: { nameKey: true, name: true, className: true, level: true } });
  const hiddenKeys = new Set(hiddenLinked.map(row => String(characterKey(row.name, row.realm, edition))));
  const chars = new Map<string, RaceChar>();
  for (const row of unclaimed) if (row.level && !hiddenKeys.has(row.nameKey)) chars.set(row.nameKey, { key: row.nameKey, name: row.name, className: row.className, level: row.level, memberId: null });
  // A linked character wins over a stale unclaimed copy of the same name.
  for (const row of linked) {
    const key = String(characterKey(row.name, row.realm, edition));
    if (row.level) chars.set(key, { key, name: row.name, className: row.className, level: row.level, memberId: row.memberId });
  }
  const stored = new Map((await db.levelRaceEntry.findMany({ where: { guildId } })).map(entry => [entry.nameKey, entry]));
  const rows: RaceRow[] = [];
  for (const char of chars.values()) {
    const before = stored.get(char.key) ?? null;
    const next = nextEntry(before, char.level, now);
    const changed = !before || before.level !== next.level || before.name !== char.name || before.className !== char.className
      || before.weekStartLevel !== next.weekStartLevel || before.weekStartedAt.getTime() !== next.weekStartedAt.getTime() || before.reachedMaxAt?.getTime() !== next.reachedMaxAt?.getTime();
    if (changed) await db.levelRaceEntry.upsert({ where: { guildId_nameKey: { guildId, nameKey: char.key } },
      create: { guildId, nameKey: char.key, name: char.name, className: char.className, ...next }, update: { name: char.name, className: char.className, ...next } });
    rows.push({ name: char.name, className: char.className, level: next.level, reachedMaxAt: next.reachedMaxAt, weekGain: Math.max(0, next.level - next.weekStartLevel), memberId: char.memberId });
  }
  const ordered = orderRace(rows);
  return { rows: ordered, total: ordered.length, finished: ordered.filter(row => row.level >= LEVEL_CAP).length, edition };
}

const isBoard = (message: Message, botId: string) => message.author.id === botId && message.embeds.some(embed => embed.footer?.text?.startsWith(`${RACE_BOARD_MARKER} •`));

/**
 * Creates the `race-to-60` channel for `/officer race-board` when no channel is picked: visible to the member role only
 * (or inheriting a category the officer's server already uses), read-only for everyone. Returns null when it is unsafe
 * to guess, in which case the caller asks the officer to pick a channel.
 */
export async function createRaceChannel(discordGuild: DiscordGuild, memberRoleId: string | null, lang: Lang): Promise<string | null> {
  if (!discordGuild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) return null;
  if (!memberRoleId || memberRoleId === discordGuild.id || !discordGuild.roles.cache.has(memberRoleId)) return null;
  const me = discordGuild.members.me.id;
  const channel = await discordGuild.channels.create({ name: lang === "fr" ? "course-au-60" : "race-to-60", type: ChannelType.GuildText,
    topic: lang === "fr" ? "Course au niveau 60 de la guilde, tableau tenu à jour par Guilded." : "The guild's race to level 60, kept up to date by Guilded.",
    permissionOverwrites: [
      { id: discordGuild.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: memberRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] },
      { id: me, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles] }
    ], reason: "Guilded race to 60 board" });
  return channel.id;
}

/**
 * Edits the saved board message in place; if it is gone, adopts an existing bot board in the channel before ever
 * posting a new one. Never throws. `delivery` is the job worker's call; any other call queues the refresh.
 */
export async function updateRaceBoard(discordGuild: DiscordGuild | null, delivery = false): Promise<boolean> {
  if (!discordGuild) return false;
  if (!delivery) {
    const guild = await guildService.ensureGuild(discordGuild.id, discordGuild.name);
    const settings = await guildService.getSettings(guild.id);
    if (!settings?.raceBoardEnabled || !settings.raceBoardChannelId) return false;
    const job = await enqueueDiscordJob(prisma, guild.id, "race-board", "RACE_BOARD");
    await deliverDiscordJob(prisma, job.id, current => dispatchDiscordJob(discordGuild, current));
    return (await prisma.discordJob.findUnique({ where: { id: job.id } }))?.status === "DONE";
  }
  try {
    const guild = await guildService.ensureGuild(discordGuild.id, discordGuild.name);
    const settings = await guildService.getSettings(guild.id);
    if (!settings?.raceBoardEnabled || !settings.raceBoardChannelId) return false;
    const channel = await discordGuild.channels.fetch(settings.raceBoardChannelId).catch(() => null);
    if (!channel?.isTextBased() || !("send" in channel)) return false;
    const lang = asLang(settings.language);
    const data = await loadRaceBoardData(prisma, guild.id, guild.gameEdition ?? "forever");
    const png = data.total ? await scoreCardPng(raceCard(data, lang)).catch(() => null) : null;
    const embed = raceBoardEmbed(data, lang, guild.id, png ? "race.png" : undefined).setTimestamp(new Date());
    const payload = { embeds: [embed], files: png ? [new AttachmentBuilder(png, { name: "race.png" })] : [], allowedMentions: { parse: [] as never[] } };
    const botId = discordGuild.client.user?.id ?? "";
    let existing: Message | null = settings.raceBoardMessageId ? await channel.messages.fetch(settings.raceBoardMessageId).catch(() => null) : null;
    if (existing && existing.author.id !== botId) existing = null;
    if (!existing) {
      const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
      existing = recent?.find(message => isBoard(message, botId)) ?? null;
    }
    if (existing?.editable) {
      await existing.edit({ ...payload, attachments: [] });
      if (existing.id !== settings.raceBoardMessageId) await guildService.updateSettings(guild.id, { raceBoardMessageId: existing.id });
    } else {
      const sent = await channel.send(payload);
      await guildService.updateSettings(guild.id, { raceBoardMessageId: sent.id });
    }
    return true;
  } catch (error) {
    console.error("Failed to update race board", error);
    return false;
  }
}
