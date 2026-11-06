import { EmbedBuilder, escapeMarkdown, type Guild as DiscordGuild, type Message } from "discord.js";
import { prisma } from "../database.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { asLang, type Lang } from "../i18n.js";
import { characterName } from "./character-display.js";
import { guildWhere } from "./guild-scope.js";
import { deliverDiscordJob, dispatchDiscordJob, enqueueDiscordJob } from "./discord-jobs.js";
import { previewAllows } from "./feature-preview.js";

// 8.5 track C2: the "Who's who" board. ONE bot message (up to three embeds) in an officer-chosen channel, edited in
// place, listing each member with their main and alts, for servers where nicknames stay off. On by default (owner decision, 6 November 2026), per server
// (GuildSettings.whosWhoEnabled; officers switch it off); it posts nothing new after the first message and awards nothing. Same pattern as
// the duel board (services/duel-board.ts).

export const WHOS_WHO_MARKER = "Guilded who's who";
const EMBED_CHARS = 3800, TOTAL_CHARS = 5400, MAX_EMBEDS = 3;

export interface WhoPerson { displayName: string; main: string; alts: string[] }
export interface WhoData { people: WhoPerson[]; members: number }

const clean = (value: string, max: number) => escapeMarkdown(value.replace(/\p{Cc}/gu, " ").trim()).slice(0, max);

/** One line per person, "Discord name — **Main** · Alt, Alt". Alts beyond four are counted, not listed. */
export function whoLine(person: WhoPerson): string {
  const alts = person.alts.slice(0, 4).map((alt) => clean(alt, 24)).join(", ");
  const more = person.alts.length > 4 ? ` +${person.alts.length - 4}` : "";
  return `${clean(person.displayName, 24)} — **${clean(person.main, 28)}**${alts ? ` · ${alts}${more}` : ""}`;
}

/** Pure: the embeds for the board. Same input, same output (the timestamp is added by the caller). */
export function whosWhoEmbeds(data: WhoData, lang: Lang, guildId = ""): { embeds: EmbedBuilder[]; shown: number } {
  const t = (en: string, french: string) => lang === "fr" ? french : en;
  const sorted = [...data.people].sort((a, b) => a.displayName.localeCompare(b.displayName));
  const chunks: string[][] = [[]];
  let total = 0, chunk = 0, size = 0, shown = 0;
  for (const person of sorted) {
    const line = whoLine(person);
    if (total + line.length + 1 > TOTAL_CHARS) break;
    if (size + line.length + 1 > EMBED_CHARS) {
      if (chunks.length >= MAX_EMBEDS) break;
      chunks.push([]); chunk++; size = 0;
    }
    chunks[chunk]!.push(line); size += line.length + 1; total += line.length + 1; shown++;
  }
  const footer = `${WHOS_WHO_MARKER} • ${guildId} • ${t(`${shown} of ${data.members} members with a linked character · main in bold, then alts`, `${shown} membres sur ${data.members} avec un personnage lié · principal en gras, puis secondaires`)}`.slice(0, 2048);
  const embeds = chunks.map((lines, index) => {
    const embed = new EmbedBuilder().setColor(0xd4af37).setDescription(lines.join("\n") || t("No linked character yet. Use /character pair.", "Aucun personnage lié pour l'instant. Utilise /character pair."));
    if (index === 0) embed.setTitle(t("🪪 Who's who", "🪪 Qui est qui"));
    if (index === chunks.length - 1) embed.setFooter({ text: footer });
    return embed;
  });
  return { embeds, shown };
}

export async function loadWhoData(db: Pick<PrismaClient, "member">, guildId: string, edition: string): Promise<WhoData> {
  const rows = await db.member.findMany({
    where: { guildId, status: "ACTIVE", isTest: false, characters: { some: { gameEdition: edition } } },
    select: { displayName: true, characters: { where: { gameEdition: edition }, select: { name: true, displayName: true, isMain: true } } }
  });
  const people: WhoPerson[] = rows.map((row) => {
    const sorted = [...row.characters].sort((a, b) => Number(b.isMain) - Number(a.isMain) || characterName(a).localeCompare(characterName(b)));
    return { displayName: row.displayName, main: characterName(sorted[0]!), alts: sorted.slice(1).map(characterName) };
  });
  return { people, members: people.length };
}

const isBoard = (message: Message, botId: string) => message.author.id === botId && message.embeds.some((embed) => embed.footer?.text?.startsWith(`${WHOS_WHO_MARKER} •`));

/**
 * Edits the saved board message in place; if it is gone, adopts an existing bot board in the channel before ever
 * posting a new one. Never throws. `delivery` is the job worker's call; any other call queues the refresh.
 */
export async function updateWhosWhoBoard(discordGuild: DiscordGuild | null, delivery = false): Promise<boolean> {
  if (!discordGuild || !previewAllows(discordGuild.id)) return false;
  try {
    const guild = await prisma.guild.findUnique({ where: guildWhere(discordGuild.id), select: { id: true, gameEdition: true, settings: true } });
    const settings = guild?.settings;
    const channelId = settings?.whosWhoChannelId ?? settings?.guideChannelId; // on by default: the bot guide channel until an officer picks one
    if (!guild || !settings || settings.whosWhoEnabled === false || !channelId) return false;
    if (!delivery) {
      const job = await enqueueDiscordJob(prisma, guild.id, "whos-who-board", "WHOS_WHO_BOARD");
      await deliverDiscordJob(prisma, job.id, (current) => dispatchDiscordJob(discordGuild, current));
      return (await prisma.discordJob.findUnique({ where: { id: job.id } }))?.status === "DONE";
    }
    const channel = await discordGuild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased() || !("send" in channel)) return false;
    const { embeds } = whosWhoEmbeds(await loadWhoData(prisma, guild.id, guild.gameEdition ?? "forever"), asLang(settings.language), guild.id);
    embeds[embeds.length - 1]!.setTimestamp(new Date());
    const payload = { embeds, allowedMentions: { parse: [] as never[] } };
    const botId = discordGuild.client.user?.id ?? "";
    let existing: Message | null = settings.whosWhoMessageId ? await channel.messages.fetch(settings.whosWhoMessageId).catch(() => null) : null;
    if (existing && existing.author.id !== botId) existing = null;
    if (!existing) {
      const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
      existing = recent?.find((message) => isBoard(message, botId)) ?? null;
    }
    if (existing?.editable) {
      await existing.edit(payload);
      if (existing.id !== settings.whosWhoMessageId) await prisma.guildSettings.update({ where: { guildId: guild.id }, data: { whosWhoMessageId: existing.id } });
    } else {
      const sent = await channel.send(payload);
      await prisma.guildSettings.update({ where: { guildId: guild.id }, data: { whosWhoMessageId: sent.id } });
    }
    return true;
  } catch (error) {
    console.error("Failed to update who's who board", error);
    return false;
  }
}
