import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, type ButtonInteraction, type Client, type GuildMember } from "discord.js";
import { hasPermission } from "../permissions.js";
import { notifyInteractive } from "./notify.js";
import { classLabel, roleLabel } from "./recruitment.js";
import type { DecisionView, WebStore } from "./web-store.js";

// Website applications in Discord: a card in the applications channel (or the officer log) with
// Accept / Decline / Spam. The applicant hears the answer by DM when Discord allows it, and always
// on their /me/ page.

export const WEB_APPLY_PREFIX = "webapply:";
type Decision = "accept" | "decline" | "spam";
const STATUS: Record<Decision, "ACCEPTED" | "DECLINED" | "SPAM"> = { accept: "ACCEPTED", decline: "DECLINED", spam: "SPAM" };

export function webApplicationRows(id: string) {
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${WEB_APPLY_PREFIX}accept:${id}`).setLabel("Accept").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${WEB_APPLY_PREFIX}decline:${id}`).setLabel("Decline").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${WEB_APPLY_PREFIX}spam:${id}`).setLabel("Spam / report").setStyle(ButtonStyle.Danger)
  )];
}

export function webApplicationEmbed(view: DecisionView, lang: "en" | "fr") {
  const fr = lang === "fr";
  return new EmbedBuilder()
    .setTitle(`${fr ? "Candidature du site web" : "Website application"}${view.coreName ? ` · ${view.coreName}` : ""}`.slice(0, 256))
    .setColor(0xd4a017)
    .addFields(
      { name: fr ? "Personnage" : "Character", value: view.character.slice(0, 100), inline: true },
      { name: fr ? "Classe et rôle" : "Class and role", value: `${classLabel(view.className, lang)} · ${roleLabel(view.role, lang)}`, inline: true },
      { name: "Discord", value: `<@${view.discordUserId}> (${view.username})`.slice(0, 200), inline: true },
      { name: fr ? "Message" : "Message", value: view.message.slice(0, 1024) }
    )
    .setFooter({ text: fr ? "Envoyée depuis guilded.kcaron.top/recruitment. Le joueur est averti de votre réponse." : "Sent from guilded.kcaron.top/recruitment. The player is told your answer." });
}

export async function postWebApplication(client: Client | undefined, view: DecisionView): Promise<{ channelId: string; messageId: string } | null> {
  const guild = client ? await client.guilds.fetch(view.guildDiscordId).catch(() => null) : null;
  const message = await notifyInteractive(guild, (lang) => ({ embeds: [webApplicationEmbed(view, lang)], components: webApplicationRows(view.id) }), "application");
  return message ? { channelId: message.channelId, messageId: message.id } : null;
}

function answerText(view: DecisionView, status: "ACCEPTED" | "DECLINED"): string {
  const where = `${view.guildName}${view.coreName ? ` · ${view.coreName}` : ""}`;
  if (status === "ACCEPTED") {
    return `🎉 **${where}** accepted your application for ${view.character}. An officer will contact you.${view.inviteUrl ? ` Their Discord: ${view.inviteUrl}` : ""}\n`
      + `🎉 **${where}** a accepté votre candidature pour ${view.character}. Un officier vous contactera.${view.inviteUrl ? ` Leur Discord : ${view.inviteUrl}` : ""}`;
  }
  return `**${where}** declined your application for ${view.character} this time. Other guilds are recruiting: https://guilded.kcaron.top/recruitment/\n`
    + `**${where}** a refusé votre candidature pour ${view.character} cette fois-ci. D'autres guildes recrutent : https://guilded.kcaron.top/recruitment/?lang=fr`;
}

export async function handleWebApplicationButton(interaction: ButtonInteraction, store: WebStore, now = new Date()): Promise<void> {
  const [, decision, id] = interaction.customId.split(":") as [string, Decision | undefined, string | undefined];
  if (!decision || !(decision in STATUS) || !id) return;
  if (!interaction.inGuild() || !hasPermission(interaction.member as GuildMember, "officer")) {
    await interaction.reply({ content: "Only Officers and Guild Masters can answer applications. / Seuls les officiers peuvent répondre aux candidatures.", flags: MessageFlags.Ephemeral });
    return;
  }
  const view = await store.applicationForDecision(id);
  if (!view || view.guildDiscordId !== interaction.guildId) {
    await interaction.reply({ content: "This application no longer exists. / Cette candidature n'existe plus.", flags: MessageFlags.Ephemeral });
    return;
  }
  const status = STATUS[decision];
  if (!await store.decideApplication(id, status, interaction.user.id, now)) {
    await interaction.reply({ content: "Another officer already answered this application. / Un autre officier a déjà répondu.", flags: MessageFlags.Ephemeral });
    return;
  }
  // SPAM is told like a decline; it also stops this account from applying here again.
  const told = await interaction.client.users.fetch(view.discordUserId)
    .then((user) => user.send({ content: answerText(view, status === "ACCEPTED" ? "ACCEPTED" : "DECLINED"), allowedMentions: { parse: [] } }))
    .then(() => true, () => false);
  const label = status === "ACCEPTED" ? "✅ Accepted" : status === "DECLINED" ? "❌ Declined" : "🚩 Marked as spam (this account can no longer apply here)";
  const embed = EmbedBuilder.from(interaction.message.embeds[0] ?? new EmbedBuilder().setTitle("Website application"))
    .addFields({ name: "Decision", value: `${label} by <@${interaction.user.id}>.${told ? " The player was told by DM." : " The player's DMs are closed: they see the answer on their Guilded page."}` });
  await interaction.update({ embeds: [embed], components: [], allowedMentions: { parse: [] } });
}
