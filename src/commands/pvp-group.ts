import { ActionRowBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, type ButtonInteraction, type GuildMember, type GuildTextBasedChannel, type ModalSubmitInteraction } from "discord.js";
import { prisma } from "../database.js";
import { asLang } from "../i18n.js";
import { createDungeonGroupService } from "../services/dungeon-group.js";
import { loadPvpGroups, lookingEmbed, parsePvpForm, PVP_DEFAULT_SIZE, PVP_OPEN_PER_LEADER } from "../services/pvp-group.js";
import { finderChannelFor } from "../services/group-finder.js";
import { postGroup } from "./dungeon-group.js";
import { guildService } from "./context.js";

// The PvP group finder's Discord side. Create opens a form (any member, like the dungeon finder); the group is a normal
// finder post (`dgrp:` buttons: Tank/Healer/DPS, Leave, Start now, Close) in the group finder channel, so the waitlist, voice
// channel, 24-hour expiry, LFG PvP ping and group alerts are the dungeon finder's own code.

const service = createDungeonGroupService(prisma);
export const PVP_FORM_ACTION = "pvp-form";

export function pvpGroupModal(fr: boolean, guildId: string) {
  const field = (id: string, label: string, placeholder: string, max: number, required: boolean) => new ActionRowBuilder<TextInputBuilder>().addComponents(
    new TextInputBuilder().setCustomId(id).setLabel(label).setPlaceholder(placeholder).setStyle(TextInputStyle.Short).setMaxLength(max).setRequired(required));
  return new ModalBuilder().setCustomId(`bgui:${guildId}:${PVP_FORM_ACTION}`).setTitle(fr ? "⚔️ Groupe JcJ" : "⚔️ PvP group")
    .addComponents(
      field("title", fr ? "Quoi, quand, qui cherchez-vous" : "What, when, and who you need", fr ? "ex. Goulet des Chanteguerres à 21 h, niveau 60" : "e.g. Warsong Gulch at 9pm, level 60", 80, true),
      field("size", fr ? `Taille du groupe (2 à 40, défaut ${PVP_DEFAULT_SIZE})` : `Group size (2 to 40, default ${PVP_DEFAULT_SIZE})`, String(PVP_DEFAULT_SIZE), 2, false),
      field("levels", fr ? "Niveaux (facultatif)" : "Levels (optional)", fr ? "ex. 10-19, 60 ou 55+" : "e.g. 10-19, 60 or 55+", 9, false));
}

/** The form was submitted: one new finder post in the group finder channel. */
export async function createPvpGroupFromModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.guild) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guild = interaction.guild;
  const record = await guildService.ensureGuild(guild.id, guild.name);
  const settings = await guildService.getSettings(record.id);
  const lang = asLang(settings?.language);
  const fr = lang === "fr";
  const member = await guildService.ensureMember(record.id, interaction.user.id, (interaction.member as GuildMember | null)?.displayName ?? interaction.user.username);
  // With the merged group finder (the default) the post goes to the finder channel; otherwise to the old separate PvP groups channel.
  const targetId = finderChannelFor(settings, "BATTLEGROUND");
  const channel = targetId ? await guild.channels.fetch(targetId).catch(() => null) : null;
  if (!channel?.isTextBased() || !("send" in channel)) {
    throw new Error(fr ? "Le salon de recherche de groupe n'existe pas encore : un officier lance /setup puis Créer les salons manquants." : "The group finder channel does not exist yet: an officer runs /setup, then Create missing channels.");
  }
  const form = parsePvpForm({ title: interaction.fields.getTextInputValue("title"), size: interaction.fields.getTextInputValue("size"), levels: interaction.fields.getTextInputValue("levels") });
  const open = await prisma.dungeonGroup.count({ where: { guildId: record.id, kind: { in: ["PVP", "WORLDPVP"] }, leaderId: member.id, status: { in: ["OPEN", "STARTED"] } } });
  if (open >= PVP_OPEN_PER_LEADER) {
    throw new Error(fr ? `Vous avez déjà ${open} groupes JcJ ouverts : fermez-en un avant d'en créer un autre.` : `You already have ${open} open PvP groups: close one before starting another.`);
  }
  const group = await service.create({ guildId: record.id, title: form.title, leaderId: member.id, channelId: channel.id, kind: "PVP", activity: "battleground", size: form.size, minLevel: form.minLevel, maxLevel: form.maxLevel });
  await postGroup(guild, channel as GuildTextBasedChannel, group, interaction.user.id, lang);
  await interaction.editReply({ content: fr
    ? `Groupe publié dans <#${channel.id}>. Choisissez votre rôle avec les boutons ; **Démarrer** crée le salon vocal (ou il démarre à ${group.maxSize} joueurs). Le groupe expire après 24 h.`
    : `Posted your group in <#${channel.id}>. Pick your role with the buttons; **Start now** creates the voice channel (or it starts at ${group.maxSize} players). The group expires after 24 hours.` });
}

/** "Who's looking": the open PvP groups and who is in or waiting for each. */
export async function showPvpLooking(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guild) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const record = await guildService.ensureGuild(interaction.guild.id, interaction.guild.name);
  const lang = asLang((await guildService.getSettings(record.id))?.language);
  await interaction.editReply({ embeds: [lookingEmbed(await loadPvpGroups(prisma, record.id, interaction.guild.id), lang)], allowedMentions: { parse: [] } });
}
