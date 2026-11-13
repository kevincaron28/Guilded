import { guildWhere } from "./guild-scope.js";
import { itemData } from "../item-data.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, type Guild as DiscordGuild } from "discord.js";
import { prisma } from "../database.js";
import { asLang } from "../i18n.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { findProfessionHolders, professionCoverage } from "./profession-search.js";
import type { Lang } from "../i18n.js";
import { offerDirectoryText } from "./craft-offers.js";
import { byLastSeen, lastSeenText } from "./last-seen.js";
import { displayCharacterName, loadFullNameBook } from "./character-display.js";
import { professionPostLinks, updateProfessionPosts } from "./profession-board.js";
import { professionEmoji, professionLegend, professionName } from "./profession-style.js";
import { professionSlug } from "./profession-names.js";
import { deliverDiscordJob, dispatchDiscordJob, enqueueDiscordJob } from "./discord-jobs.js";

// 8.5 track D2: the directory is now a short index. Each profession has its own auto-updated post (profession-board.ts)
// with every recipe and its crafters; this lists the profession, how many crafters it has, who was seen most recently
// (track D3) and a link to its post when it exists.
export async function professionDirectoryText(database: Pick<PrismaClient, "professionSkill"> & Partial<Pick<PrismaClient, "recipeKnown">>, guildId: string, lang: Lang = "en", links: ReadonlyMap<string, string> = new Map(), now = new Date()): Promise<string> {
  const header = lang === "fr"
    ? "**Artisans de la guilde**\nChaque métier a son message à jour avec les recettes et les artisans. `/craft who item:` cherche une recette (avec dernière présence). `/craft request` : demander une fabrication. Ouvrez vos métiers avec Guilded : un officier en ligne avec le compagnon peut relayer vos recettes."
    : "**Guild profession directory**\nEach profession has its own always-updated post with recipes and crafters. `/craft who item:` finds a recipe (with last seen). `/craft request` arranges a craft. Open profession windows with Guilded. An online officer with the companion can relay your recipes.";
  let text = `${header}
${professionLegend(lang)}`;
  const coverage = await professionCoverage(database, guildId);
  const book = await loadFullNameBook(database as never, guildId);
  for (const row of coverage) {
    const holders = await findProfessionHolders(database, guildId, row.profession);
    const recent = [...holders].sort((a, b) => byLastSeen(a.lastSeen, b.lastSeen))[0];
    const link = links.get(professionSlug(row.profession));
    const crafters = lang === "fr" ? `${row.characters} artisan${row.characters === 1 ? "" : "s"}` : `${row.characters} crafter${row.characters === 1 ? "" : "s"}`;
    const seen = recent ? ` · ${lang === "fr" ? "vu récemment" : "last seen"}: ${displayCharacterName(recent.character, book)} (${lastSeenText(recent.lastSeen, lang, now)})` : "";
    const line = `\n${professionEmoji(row.profession)} **${professionName(row.profession, lang)}** · ${crafters}${seen}${link ? ` → <#${link}>` : ""}`;
    if (text.length + line.length > 1850) return `${text}\n…`;
    text += line;
  }
  return text + (coverage.length ? "" : lang === "fr" ? "\nAucun métier enregistré." : "\nNo professions recorded yet.");
}

/** Jump buttons under the directory: one link button per profession post (Discord allows 25 per message). */
export function professionNavRows(professions: readonly string[], links: ReadonlyMap<string, string>, discordGuildId: string, lang: Lang = "en"): ActionRowBuilder<ButtonBuilder>[] {
  const buttons = professions.filter(profession => links.has(professionSlug(profession))).slice(0, 25).map(profession =>
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(professionName(profession, lang).slice(0, 80)).setEmoji(professionEmoji(profession)).setURL(`https://discord.com/channels/${discordGuildId}/${links.get(profession.trim().toLowerCase())}`));
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let index = 0; index < buttons.length; index += 5) rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(index, index + 5)));
  return rows;
}

// Refresh existing directory posts after imports; never create repeated forum posts.
export async function updateProfessionDirectory(discordGuild: DiscordGuild | null, delivery = false): Promise<boolean> {
  if (!discordGuild) return false;
  if (!delivery) {
    const guild = await prisma.guild.findUnique({ where: guildWhere(discordGuild.id), include: { settings: true } });
    if (!guild?.settings?.craftChannelId) return false;
    const job = await enqueueDiscordJob(prisma, guild.id, "professions", "PROFESSIONS");
    await deliverDiscordJob(prisma, job.id, current => dispatchDiscordJob(discordGuild, current));
    return (await prisma.discordJob.findUnique({ where: { id: job.id } }))?.status === "DONE";
  }
  try {
    const guild = await prisma.guild.findUnique({ where: guildWhere(discordGuild.id), include: { settings: true } });
    if (!guild?.settings?.craftChannelId) return false;
    // A deleted craft channel (Discord error 10003) is not a failure worth a diagnostic: the directory just has nowhere to go.
    const forum = await discordGuild.channels.fetch(guild.settings.craftChannelId).catch((error: unknown) => {
      if ((error as { code?: number }).code === 10003) return null;
      throw error;
    });
    if (forum?.type !== ChannelType.GuildForum) return false;
    const active = await forum.threads.fetchActive();
    const lang = asLang(guild.settings.language);
    // The per-profession posts first, so the directory can link to them.
    await updateProfessionPosts(discordGuild, forum, prisma, guild.id, lang, new Date(), itemData);
    const links = guild.settings.professionPostsEnabled ? await professionPostLinks(forum).catch(() => new Map<string, string>()) : new Map<string, string>();
    const description = (await professionDirectoryText(prisma, guild.id, lang, links) + await offerDirectoryText(prisma, guild.id, lang)).slice(0, 1990);
    const navRows = professionNavRows((await professionCoverage(prisma, guild.id)).map(row => row.profession), links, discordGuild.id, lang);
    const archived = await forum.threads.fetchArchived({ limit: 100 });
    let updated = false;
    for (const thread of new Map([...archived.threads, ...active.threads]).values()) {
      const directory = thread.name === "Guild profession directory";
      if (!directory && !thread.flags.has("Pinned")) continue;
      const starter = await thread.fetchStarterMessage();
      if (!starter?.editable) continue;
      if (thread.archived) await thread.setArchived(false);
      if (directory) await starter.edit({ content: description, components: navRows, allowedMentions: { parse: [] } });
      else if (starter.components.length) await starter.edit({ embeds: [new EmbedBuilder().setTitle(lang === "fr" ? "Artisans de la guilde" : "Guild profession directory").setDescription(description).setColor(0xd4af37)], allowedMentions: { parse: [] } });
      updated = true;
    }
    return updated;
  } catch (error) { console.warn("Profession directory refresh failed", error); return false; }
}
