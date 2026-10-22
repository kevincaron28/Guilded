import { EmbedBuilder, escapeMarkdown, type Guild, type MessageCreateOptions } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { publicRaids, type PublicRaid } from "./public-raids.js";
import { serializeRaidPosts } from "./raid-signup-posts.js";
import { roleLabel, ROLES } from "./recruitment.js";

export function pugBoardPayload(raids: PublicRaid[], lang: "en" | "fr", now = new Date()): Pick<MessageCreateOptions, "embeds" | "allowedMentions"> {
  const fr = lang === "fr";
  const embed = new EmbedBuilder().setTitle(fr ? "Places de raid — autres guildes" : "Open raids — other guilds")
    .setURL("https://guilded.kcaron.top/recruitment/?kind=raids")
    .setDescription(fr
      ? "Rejoignez le Discord hôte, puis utilisez son inscription. Actualisé chaque minute; une place doit être confirmée chez l'hôte."
      : "Join the host Discord, then use its signup post. Refreshed every minute; confirm your spot with the host.")
    .setTimestamp(now).setFooter({ text: fr ? "Toutes les annonces et filtres sur le site Guilded" : "All listings and filters on the Guilded website" });
  for (const raid of raids.slice(0, 8)) {
    const text = (value: string) => escapeMarkdown(value.replace(/[\r\n]/g, " ").slice(0, 80));
    embed.addFields({
      name: `${raid.guildName} · ${raid.title}`.slice(0, 256),
      value: `${text(raid.realm)} · ${raid.faction} · ${raid.language} · <t:${Math.floor(Date.parse(raid.scheduledAt) / 1000)}:f>\n`
        + ROLES.filter(role => raid.spots[role] > 0).map(role => `${raid.spots[role]} ${roleLabel(role, lang)}`).join(" · ")
        + `\n[Discord](${raid.inviteUrl}) · [${fr ? "Inscription" : "Sign up"}](${raid.signupUrl})`
    });
  }
  if (!raids.length) embed.addFields({ name: fr ? "Aucune place ouverte" : "No open spots", value: fr ? "Les prochaines annonces apparaîtront ici." : "Upcoming listings will appear here." });
  return { embeds: [embed], allowedMentions: { parse: [] } };
}

export async function refreshPugBoard(guild: Guild, database: PrismaClient, allows: (id: string) => boolean, now = new Date()): Promise<void> {
  if (!allows(guild.id)) return;
  await serializeRaidPosts(`pug:${guild.id}`, async () => {
    const record = await database.guild.findUnique({ where: { discordId: guild.id }, select: { id: true, settings: true } });
    const settings = record?.settings;
    if (!record || !settings?.pugChannelId) return;
    const channel = await guild.channels.fetch(settings.pugChannelId);
    if (!channel?.isTextBased() || !("send" in channel)) return;
    const raids = (await publicRaids(database, allows, now)).filter(raid => raid.guildDiscordId !== guild.id);
    const payload = pugBoardPayload(raids, settings.language === "fr" ? "fr" : "en", now);
    const message = settings.pugMessageId ? await channel.messages.fetch(settings.pugMessageId).catch((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === 10008) return null;
      throw error;
    }) : null;
    if (message) await message.edit(payload);
    else {
      const sent = await channel.send(payload);
      await database.guildSettings.update({ where: { guildId: record.id }, data: { pugMessageId: sent.id } });
    }
  });
}
