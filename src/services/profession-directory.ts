import { ChannelType, EmbedBuilder, type Guild as DiscordGuild } from "discord.js";
import { prisma } from "../database.js";
import { asLang } from "../i18n.js";
import type { PrismaClient } from "@prisma/client";
import { findProfessionHolders, professionCoverage } from "./profession-search.js";
import type { Lang } from "../i18n.js";
import { deliverDiscordJob, dispatchDiscordJob, enqueueDiscordJob } from "./discord-jobs.js";

export async function professionDirectoryText(database: Pick<PrismaClient, "professionSkill">, guildId: string, lang: Lang = "en"): Promise<string> {
  const header = lang === "fr"
    ? "**Artisans de la guilde**\n`/craft who item:` : recettes connues. `/character profession who` : compétences. `/craft request` : demander une fabrication. Ouvrez vos métiers avec Guilded : un officier en ligne avec le compagnon peut relayer vos recettes."
    : "**Guild profession directory**\n`/craft who item:` finds known recipes. `/character profession who` lists skills. `/craft request` arranges a craft. Open profession windows with Guilded. An online officer with the companion can relay your recipes.";
  let text = header;
  const coverage = await professionCoverage(database, guildId);
  for (const row of coverage) {
    const holders = await findProfessionHolders(database, guildId, row.profession);
    const line = `\n**${row.profession}**: ${holders.slice(0, 3).map((holder) => `${holder.character} (${holder.skillLevel}, ${holder.member})`).join(" · ")}`;
    if (text.length + line.length > 1850) return `${text}\n…`;
    text += line;
  }
  return text + (coverage.length ? "" : lang === "fr" ? "\nAucun métier enregistré." : "\nNo professions recorded yet.");
}

// Refresh existing directory posts after imports; never create repeated forum posts.
export async function updateProfessionDirectory(discordGuild: DiscordGuild | null, delivery = false): Promise<boolean> {
  if (!discordGuild) return false;
  if (!delivery) {
    const guild = await prisma.guild.findUnique({ where: { discordId: discordGuild.id }, include: { settings: true } });
    if (!guild?.settings?.craftChannelId) return false;
    const job = await enqueueDiscordJob(prisma, guild.id, "professions", "PROFESSIONS");
    await deliverDiscordJob(prisma, job.id, current => dispatchDiscordJob(discordGuild, current));
    return (await prisma.discordJob.findUnique({ where: { id: job.id } }))?.status === "DONE";
  }
  try {
    const guild = await prisma.guild.findUnique({ where: { discordId: discordGuild.id }, include: { settings: true } });
    if (!guild?.settings?.craftChannelId) return false;
    const forum = await discordGuild.channels.fetch(guild.settings.craftChannelId);
    if (forum?.type !== ChannelType.GuildForum) return false;
    const active = await forum.threads.fetchActive();
    const lang = asLang(guild.settings.language);
    const description = await professionDirectoryText(prisma, guild.id, lang);
    const archived = await forum.threads.fetchArchived({ limit: 100 });
    let updated = false;
    for (const thread of new Map([...archived.threads, ...active.threads]).values()) {
      const directory = thread.name === "Guild profession directory";
      if (!directory && !thread.flags.has("Pinned")) continue;
      const starter = await thread.fetchStarterMessage();
      if (!starter?.editable) continue;
      if (thread.archived) await thread.setArchived(false);
      if (directory) await starter.edit({ content: description, allowedMentions: { parse: [] } });
      else if (starter.components.length) await starter.edit({ embeds: [new EmbedBuilder().setTitle(lang === "fr" ? "Artisans de la guilde" : "Guild profession directory").setDescription(description).setColor(0xd4af37)], allowedMentions: { parse: [] } });
      updated = true;
    }
    return updated;
  } catch (error) { console.warn("Profession directory refresh failed", error); return false; }
}
