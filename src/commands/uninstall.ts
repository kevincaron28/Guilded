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
import { removeGuildScheduledEvents } from "../services/scheduled-events.js";
import { prisma } from "../database.js";
import { guildService } from "./context.js";
import { BRAND } from "../brand.js";
import { isPermissionRoleName, type Permission } from "../permissions.js";
import { RESET_REQUIRED_CHANNELS, isSetupLeftover, categoryNames, channelNames, type CategoryKey } from "../setup-names.js";
import { forgetAnswerSettings } from "./faq.js";
import { ALL_CHANNELS } from "./setup.js";
import { ARCHIVE_CATEGORY, coreChannelNames } from "../services/core-channels.js";

// Permanently removes Guilded from a server: deletes the channels and (empty) categories it
// made, wipes every database row for this guild (cascades from the Guild row: raids, EPGP,
// loot, imports, characters, everything), and leaves. Roles are never deleted automatically —
// they can carry permissions used for other things and affect every member who has one, so
// that blast radius is left for an admin to judge by hand. Admin-only, so (like the rest of
// the codebase's officer/admin replies) this stays in English.

export const uninstallCommand = new SlashCommandBuilder()
  .setName("uninstall")
  .setDescription(`Permanently remove ${BRAND.name}: delete what it made and wipe its data (cannot be undone).`);
export const resetCommand = new SlashCommandBuilder().setName("reset").setDescription("Erase channels and guild data; restart setup.");
export const executeSetupReset = (interaction: ChatInputCommandInteraction) => executeUninstall(interaction, true);

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
  coreCategories: string[];
  removableChannels: RemovableChannel[];
  keptChannels: string[];
  roleNames: string[];
  counts: { members: number; characters: number; raids: number; epgp: number; loot: number; imports: number; dungeonRuns: number };
}

export async function gatherImpact(guild: DiscordGuild, guildId: string, settings: GuildSettings): Promise<Impact> {
  const removableChannels: RemovableChannel[] = [];
  const keptChannels: string[] = [];
  for (const field of ALL_CHANNELS) {
    const id = settings[field];
    if (!id) continue;
    const channel = await guild.channels.fetch(id).catch(() => null);
    if (!channel) continue;
    // General signups, guide and FAQ are explicitly included in the reset,
    // using their configured IDs even after a rename. Other channels retain
    // the conservative name check.
    if (RESET_REQUIRED_CHANNELS.includes(field) || channelNames(field).includes(channel.name)) removableChannels.push({ id: channel.id, name: channel.name });
    else keptChannels.push(`<#${channel.id}>`);
  }
  // The welcome channel has no standard name (it's always admin-picked), so never auto-delete it.
  if (settings.welcomeChannelId) {
    const channel = await guild.channels.fetch(settings.welcomeChannelId).catch(() => null);
    if (channel && !removableChannels.some(row => row.id === channel.id) && !keptChannels.includes(`<#${channel.id}>`)) keptChannels.push(`<#${channel.id}>`);
  }

  const coreCategories: string[] = [];
  await guild.channels.fetch();
  for (const channel of guild.channels.cache.values()) {
    if (channel.type !== ChannelType.GuildText) continue;
    const parentName = channel.parentId ? guild.channels.cache.get(channel.parentId)?.name : undefined;
    if (ALL_CHANNELS.some(field => isSetupLeftover(field, channel.name, parentName))
      && !removableChannels.some(row => row.id === channel.id)) removableChannels.push({ id: channel.id, name: channel.name });
  }
  for (const category of guild.channels.cache.values()) {
    if (category.type !== ChannelType.GuildCategory || !(category.name === ARCHIVE_CATEGORY || category.name.startsWith(`${ARCHIVE_CATEGORY} `))) continue;
    coreCategories.push(category.id);
    for (const channel of guild.channels.cache.values()) {
      if (channel.parentId === category.id && /-(roster|signups|butin|rapports|chat)$/.test(channel.name)
        && !removableChannels.some(row => row.id === channel.id)) removableChannels.push({ id: channel.id, name: channel.name });
    }
  }
  const cores = await prisma.raidCore.findMany({ where: { guildId } });
  for (const core of cores) {
    const names = coreChannelNames(core.name);
    const fields = { rosterChannelId: names.roster, signupChannelId: names.signups, lootChannelId: names.loot, raidLogChannelId: names.reports, chatChannelId: names.chat, voiceChannelId: names.voice };
    for (const [field, expected] of Object.entries(fields)) {
      const id = core[field as keyof typeof fields];
      if (!id) continue;
      const channel = await guild.channels.fetch(id);
      if (!channel) continue;
      if (channel.name === expected && !removableChannels.some(row => row.id === id)) removableChannels.push({ id, name: channel.name });
      else if (channel.name !== expected) keptChannels.push(`<#${id}>`);
    }
    if (core.categoryId) {
      const category = await guild.channels.fetch(core.categoryId);
      if (category?.name === names.category) coreCategories.push(category.id);
    }
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
  return { removableChannels: [...new Map(removableChannels.map(row => [row.id, row])).values()], keptChannels: keptChannels.filter(mention => !removableChannels.some(row => mention === `<#${row.id}>`)), coreCategories, roleNames: [...roleNames], counts: { members, characters, raids, epgp, loot, imports, dungeonRuns } };
}

function confirmEmbed(guild: DiscordGuild, impact: Impact, reset = false): EmbedBuilder {
  const c = impact.counts;
  const lines = [
    `**This permanently deletes everything ${BRAND.name} has for "${guild.name}". ${reset ? "The bot stays so you can restart setup. Companion pairings are revoked." : "The bot leaves this server."} This cannot be undone.**`,
    "Discord events created and linked by Guilded are removed too. Other organizers' events are kept.",
    "",
    `**Database:** ${c.raids} raid(s), ${c.epgp} EPGP entr${c.epgp === 1 ? "y" : "ies"}, ${c.loot} loot award(s), ${c.imports} addon import(s), ` +
      `${c.dungeonRuns} dungeon run(s), ${c.characters} linked character(s) across ${c.members} member record(s) — all deleted.`,
    "",
    impact.removableChannels.length
      ? `**Channels to delete** (configured signup, guide and FAQ channels, plus recognized Guilded channels): ${impact.removableChannels.map((ch) => `#${ch.name}`).join(", ")}. Their categories too, if that empties them.`
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
  return new EmbedBuilder().setTitle(`⚠️ ${reset ? "Reset" : "Uninstall"} ${BRAND.name}`).setColor(0xcc3333).setDescription(lines.join("\n").slice(0, 4000));
}

function confirmModal(guild: DiscordGuild, reset = false): ModalBuilder {
  return new ModalBuilder().setCustomId("uninstall:confirm-modal").setTitle(reset ? "Confirm full reset" : "Confirm uninstall").addComponents(
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

export async function performUninstall(guild: DiscordGuild, guildId: string, impact: Impact, reset = false): Promise<string> {
  await removeGuildScheduledEvents(guild, prisma, guildId);
  const deletedChannels: string[] = [];
  for (const { id, name } of impact.removableChannels) {
    const channel = await guild.channels.fetch(id).catch(() => null);
    if (!channel) continue;
    await channel.delete(`${BRAND.name} ${reset ? "reset" : "uninstall"}`);
    deletedChannels.push(name);
  }
  for (const id of impact.coreCategories) {
    await guild.channels.fetch();
    const category = guild.channels.cache.get(id);
    if (category && !guild.channels.cache.some(channel => channel.parentId === id)) await category.delete(`${BRAND.name} reset`);
  }
  const deletedCategories = await deleteEmptyCategories(guild);
  try {
    await prisma.$transaction(async tx => {
      await tx.guild.delete({ where: { id: guildId } });
      if (reset) await tx.guild.create({ data: { discordId: guild.id, name: guild.name, settings: { create: { dataResetAt: new Date() } } } });
    });
  } catch (error) {
    console.error("Uninstall: could not delete the guild's database row", error);
    throw new Error("Database wipe failed; the bot remains in this server.");
  }

  forgetAnswerSettings(guild.id);
  return [
    `**${BRAND.name} is ${reset ? "reset" : "uninstalled"} for "${guild.name}".**`,
    deletedChannels.length ? `Deleted channels: ${deletedChannels.map((n) => `#${n}`).join(", ")}.` : "No channels of mine matched to delete.",
    deletedCategories.length ? `Deleted empty categories: ${deletedCategories.join(", ")}.` : "",
    "All of its data for this server — raids, EPGP, loot log, imports, characters, recipes, everything — is gone. Its linked Discord events were removed.",
    impact.keptChannels.length ? `Left alone: ${impact.keptChannels.join(", ")}.` : "",
    impact.roleNames.length ? `Roles left alone: ${impact.roleNames.join(", ")}.` : "",
    reset ? "Run `/setup start` to create fresh channels, then pair companions again." : "Leaving the server now."
  ].filter((line) => line !== "").join("\n");
}

export async function executeUninstall(interaction: ChatInputCommandInteraction, reset = false): Promise<void> {
  if (!interaction.guild || !interaction.guildId) {
    await interaction.reply({ content: `This command can only be used inside the ${BRAND.name} Discord server.`, ephemeral: true });
    return;
  }
  if (!canUninstall(interaction)) {
    await interaction.reply({ content: "Only the server owner, or someone with the Administrator permission, can uninstall the bot.", ephemeral: true });
    return;
  }
  const guild = interaction.guild;
  await interaction.deferReply({ ephemeral: true });
  const record = await guildService.ensureGuild(guild.id, guild.name);
  const guildId = record.id;
  const settings = await guildService.getSettings(guildId);
  if (!settings) {
    await interaction.editReply({ content: `${BRAND.name} has no saved settings for this server.` });
    return;
  }

  const impact = await gatherImpact(guild, guildId, settings);
  await interaction.editReply({
    embeds: [confirmEmbed(guild, impact, reset)],
    files: [{ attachment: Buffer.from([
      `Server: ${guild.name} (${guild.id})`,
      "All Guilded database records for this server will be erased, including character links, professions, recipes, raid and dungeon history, loot, points and companion pairings.",
      "Channels to delete:", ...impact.removableChannels.map(channel => `${channel.name} (${channel.id})`),
      "Channels kept:", ...impact.keptChannels,
      "Roles kept:", ...impact.roleNames,
      reset ? "The bot stays. Run /setup start after resetting." : "The bot leaves."
    ].join("\n")), name: "guilded-deletion-preview.txt" }],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("uninstall:continue").setLabel("Continue").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("uninstall:cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary)
    )]
  });
  const message = await interaction.fetchReply();
  const collector = message.createMessageComponentCollector({ time: 5 * 60_000, filter: (i) => i.user.id === interaction.user.id });

  let busy = false;
  collector.on("collect", async (i: MessageComponentInteraction) => {
    if (i.customId === "uninstall:cancel") {
      await i.update({ content: "Cancelled. Nothing was changed.", embeds: [], components: [] });
      collector.stop("closed");
      return;
    }
    if (busy || i.customId !== "uninstall:continue" || !i.isButton()) return;
    busy = true;
    await i.showModal(confirmModal(guild, reset));
    const submitted = await i.awaitModalSubmit({ time: 5 * 60_000, filter: (m) => m.user.id === i.user.id && m.customId === "uninstall:confirm-modal" }).catch(() => null);
    if (!submitted) { busy = false; return; }
    if (collector.ended) { await submitted.reply({ content: "Confirmation expired or was cancelled. Run the command again.", ephemeral: true }); return; }
    const typed = submitted.fields.getTextInputValue("name").trim();
    if (typed.toLowerCase() !== guild.name.trim().toLowerCase()) {
      await submitted.reply({ content: `That didn't match "${guild.name}" exactly. Press Continue to try again.`, ephemeral: true });
      busy = false;
      return;
    }
    await submitted.deferReply({ ephemeral: true });
    const administrator = await guild.members.fetch(i.user.id);
    if (guild.ownerId !== i.user.id && !administrator.permissions.has(PermissionFlagsBits.Administrator)) {
      await submitted.editReply({ content: "Administrator permission is required to confirm." });
      collector.stop("closed");
      return;
    }
    collector.stop("done");
    let result: string;
    try { result = await performUninstall(guild, guildId, impact, reset); }
    catch (error) {
      console.error("Guild reset/uninstall failed", error);
      await submitted.editReply({ content: "Stopped because a channel or database operation failed. Some channels may already be gone. The bot remains here; check its logs before retrying." });
      await interaction.editReply({ content: "Reset stopped; see the reply above.", embeds: [], components: [] });
      return;
    }
    await submitted.editReply({ content: result });
    await interaction.editReply({ content: reset ? "Reset complete. Run `/setup start`." : "Uninstall complete — see the reply above. Leaving the server.", embeds: [], components: [] }).catch(() => undefined);
    collector.stop("done");
    if (!reset) await guild.leave().catch(() => undefined);
  });

  collector.on("end", async (_collected, reason) => {
    if (reason === "closed" || reason === "done") return;
    await interaction.editReply({ content: "Uninstall timed out after 5 minutes — nothing was changed. Run the command again if you want.", embeds: [], components: [] }).catch(() => undefined);
  });
}
