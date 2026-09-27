import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type Guild as DiscordGuild,
  type GuildMember,
  type MessageComponentInteraction
} from "discord.js";
import type { GuildSettings } from "@prisma/client";
import { prisma } from "../database.js";
import { guildService } from "./context.js";
import { BRAND } from "../brand.js";
import { isPermissionRoleName, type Permission } from "../permissions.js";
import { categoryNames, channelNames, type CategoryKey } from "../setup-names.js";
import { ALL_CHANNELS } from "./setup.js";

// Permanently removes Guilded from a server: deletes the channels and (empty) categories it
// made, wipes every database row for this guild (cascades from the Guild row: raids, EPGP,
// loot, imports, characters, everything), and leaves. Roles are never deleted automatically —
// they can carry permissions used for other things and affect every member who has one, so
// that blast radius is left for an admin to judge by hand. Admin-only, so (like the rest of
// the codebase's officer/admin replies) this stays in English.

export const uninstallCommand = new SlashCommandBuilder()
  .setName("uninstall")
  .setDescription(`Permanently remove ${BRAND.name}: delete what it made and wipe its data (cannot be undone).`);

const PERMISSION_NAMES: Permission[] = ["guildMaster", "officer", "raidLeader", "dkpOfficer", "lootLeader", "classLeader"];
const CATEGORY_KEYS: CategoryKey[] = ["guild", "raid", "dungeon", "craft", "officers"];

function canUninstall(interaction: ChatInputCommandInteraction): boolean {
  const member = interaction.member as GuildMember | null;
  if (!interaction.guild || !member) return false;
  if (interaction.guild.ownerId === interaction.user.id) return true;
  return member.permissions.has(PermissionFlagsBits.Administrator);
}

interface RemovableChannel { id: string; name: string }

interface Impact {
  removableChannels: RemovableChannel[];
  keptChannels: string[];
  roleNames: string[];
  counts: { members: number; characters: number; raids: number; epgp: number; loot: number; imports: number; dungeonRuns: number };
}

async function gatherImpact(guild: DiscordGuild, guildId: string, settings: GuildSettings): Promise<Impact> {
  const removableChannels: RemovableChannel[] = [];
  const keptChannels: string[] = [];
  for (const field of ALL_CHANNELS) {
    const id = settings[field];
    if (!id) continue;
    const channel = await guild.channels.fetch(id).catch(() => null);
    if (!channel) continue;
    // Only delete a channel that's still under the exact name Guilded gives it (either
    // language). A renamed channel, or one an admin picked that already existed, is left alone.
    if (channelNames(field).includes(channel.name)) removableChannels.push({ id: channel.id, name: channel.name });
    else keptChannels.push(`<#${channel.id}>`);
  }
  // The welcome channel has no standard name (it's always admin-picked), so never auto-delete it.
  if (settings.welcomeChannelId) {
    const channel = await guild.channels.fetch(settings.welcomeChannelId).catch(() => null);
    if (channel && !keptChannels.includes(`<#${channel.id}>`)) keptChannels.push(`<#${channel.id}>`);
  }

  await guild.roles.fetch();
  const roleNames = new Set<string>();
  for (const permission of PERMISSION_NAMES) {
    for (const role of guild.roles.cache.values()) {
      if (isPermissionRoleName(permission, role.name)) roleNames.add(role.name);
    }
  }
  for (const id of [settings.applicantRoleId, settings.memberRoleId, ...settings.welcomeRoleIds]) {
    if (!id) continue;
    const role = guild.roles.cache.get(id);
    if (role) roleNames.add(role.name);
  }

  const [members, characters, raids, epgp, loot, imports, dungeonRuns] = await Promise.all([
    prisma.member.count({ where: { guildId } }),
    prisma.character.count({ where: { member: { guildId } } }),
    prisma.raid.count({ where: { guildId } }),
    prisma.epgpTransaction.count({ where: { guildId } }),
    prisma.lootAward.count({ where: { guildId } }),
    prisma.addonImport.count({ where: { guildId } }),
    prisma.dungeonRun.count({ where: { guildId } })
  ]);
  return { removableChannels, keptChannels, roleNames: [...roleNames], counts: { members, characters, raids, epgp, loot, imports, dungeonRuns } };
}

function confirmEmbed(guild: DiscordGuild, impact: Impact): EmbedBuilder {
  const c = impact.counts;
  const lines = [
    `**This permanently deletes everything ${BRAND.name} has for "${guild.name}" and the bot leaves this server. This cannot be undone.**`,
    "",
    `**Database:** ${c.raids} raid(s), ${c.epgp} EPGP entr${c.epgp === 1 ? "y" : "ies"}, ${c.loot} loot award(s), ${c.imports} addon import(s), ` +
      `${c.dungeonRuns} dungeon run(s), ${c.characters} linked character(s) across ${c.members} member record(s) — all deleted.`,
    "",
    impact.removableChannels.length
      ? `**Channels to delete** (still under the name I gave them): ${impact.removableChannels.map((ch) => `#${ch.name}`).join(", ")}. Their categories too, if that empties them.`
      : "**Channels to delete:** none — nothing of mine matched by name.",
    impact.keptChannels.length
      ? `**Left alone** (renamed, or not confidently mine): ${impact.keptChannels.join(", ")}. Delete these yourself if you want them gone.`
      : "",
    "",
    impact.roleNames.length
      ? `**Roles are NOT deleted** (a role can carry permissions used elsewhere and affects every member who has it): ${impact.roleNames.join(", ")}. Remove these yourself in Server Settings → Roles if you want.`
      : "",
    "",
    `Press **Continue**, then type this server's name (**${guild.name}**) exactly to confirm.`
  ].filter((line) => line !== "");
  return new EmbedBuilder().setTitle(`⚠️ Uninstall ${BRAND.name}`).setColor(0xcc3333).setDescription(lines.join("\n").slice(0, 4000));
}

function confirmModal(guild: DiscordGuild): ModalBuilder {
  return new ModalBuilder().setCustomId("uninstall:confirm-modal").setTitle("Confirm uninstall").addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("name").setLabel("Type the server's name exactly")
        .setPlaceholder(guild.name.slice(0, 100)).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100)
    )
  );
}

async function deleteEmptyCategories(guild: DiscordGuild): Promise<string[]> {
  await guild.channels.fetch();
  const removed: string[] = [];
  for (const key of CATEGORY_KEYS) {
    const names = categoryNames(key);
    const category = guild.channels.cache.find((channel) => channel.type === ChannelType.GuildCategory && names.includes(channel.name));
    if (!category) continue;
    const hasChildren = guild.channels.cache.some((channel) => channel.parentId === category.id);
    if (hasChildren) continue;
    await category.delete(`${BRAND.name} uninstall`).catch(() => undefined);
    removed.push(category.name);
  }
  return removed;
}

async function performUninstall(guild: DiscordGuild, guildId: string, impact: Impact): Promise<string> {
  const deletedChannels: string[] = [];
  for (const { id, name } of impact.removableChannels) {
    const channel = await guild.channels.fetch(id).catch(() => null);
    if (!channel) continue;
    await channel.delete(`${BRAND.name} uninstall`).catch(() => undefined);
    deletedChannels.push(name);
  }
  const deletedCategories = await deleteEmptyCategories(guild);
  try {
    await prisma.guild.delete({ where: { id: guildId } });
  } catch (error) {
    console.error("Uninstall: could not delete the guild's database row", error);
    return "Deleted the channels above, but the database wipe failed — check the bot's logs. The bot will still leave the server.";
  }
  return [
    `**${BRAND.name} is uninstalled from "${guild.name}".**`,
    deletedChannels.length ? `Deleted channels: ${deletedChannels.map((n) => `#${n}`).join(", ")}.` : "No channels of mine matched to delete.",
    deletedCategories.length ? `Deleted empty categories: ${deletedCategories.join(", ")}.` : "",
    "All of its data for this server — raids, EPGP, loot log, imports, characters, recipes, everything — is gone.",
    impact.keptChannels.length ? `Left alone: ${impact.keptChannels.join(", ")}.` : "",
    impact.roleNames.length ? `Roles left alone: ${impact.roleNames.join(", ")}.` : "",
    "Leaving the server now."
  ].filter((line) => line !== "").join("\n");
}

export async function executeUninstall(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild || !interaction.guildId) {
    await interaction.reply({ content: `This command can only be used inside the ${BRAND.name} Discord server.`, ephemeral: true });
    return;
  }
  if (!canUninstall(interaction)) {
    await interaction.reply({ content: "Only the server owner, or someone with the Administrator permission, can uninstall the bot.", ephemeral: true });
    return;
  }
  const guild = interaction.guild;
  const record = await guildService.ensureGuild(guild.id, guild.name);
  const guildId = record.id;
  const settings = await guildService.getSettings(guildId);
  if (!settings) {
    await interaction.reply({ content: `${BRAND.name} has no settings saved for this server — there is nothing to uninstall. Just remove the bot if you want it gone.`, ephemeral: true });
    return;
  }

  const impact = await gatherImpact(guild, guildId, settings);
  await interaction.reply({
    embeds: [confirmEmbed(guild, impact)],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("uninstall:continue").setLabel("Continue").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("uninstall:cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary)
    )],
    ephemeral: true
  });
  const message = await interaction.fetchReply();
  const collector = message.createMessageComponentCollector({ time: 5 * 60_000, filter: (i) => i.user.id === interaction.user.id });

  collector.on("collect", async (i: MessageComponentInteraction) => {
    if (i.customId === "uninstall:cancel") {
      await i.update({ content: "Cancelled. Nothing was changed.", embeds: [], components: [] });
      collector.stop("closed");
      return;
    }
    if (i.customId !== "uninstall:continue" || !i.isButton()) return;
    await i.showModal(confirmModal(guild));
    const submitted = await i.awaitModalSubmit({ time: 5 * 60_000, filter: (m) => m.user.id === i.user.id }).catch(() => null);
    if (!submitted) return;
    const typed = submitted.fields.getTextInputValue("name").trim();
    if (typed.toLowerCase() !== guild.name.trim().toLowerCase()) {
      await submitted.reply({ content: `That didn't match "${guild.name}" exactly. Press Continue to try again.`, ephemeral: true });
      return;
    }
    await submitted.deferReply({ ephemeral: true });
    const result = await performUninstall(guild, guildId, impact);
    await submitted.editReply({ content: result });
    await interaction.editReply({ content: "Uninstall complete — see the reply above. Leaving the server.", embeds: [], components: [] }).catch(() => undefined);
    collector.stop("done");
    await guild.leave().catch(() => undefined);
  });

  collector.on("end", async (_collected, reason) => {
    if (reason === "closed" || reason === "done") return;
    await interaction.editReply({ content: "Uninstall timed out after 5 minutes — nothing was changed. Run `/setup uninstall` again if you want.", embeds: [], components: [] }).catch(() => undefined);
  });
}
