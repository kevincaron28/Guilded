import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction, type GuildMember } from "discord.js";
import { prisma } from "../database.js";
import { hasPermission } from "../permissions.js";
import { syncRankRoles } from "../services/rank-roles.js";
import { requireGuildContext } from "./context.js";

// Mounted as /mod rankroles. Officer-only, every reply private.
export const rankRolesCommand = new SlashCommandBuilder()
  .setName("rankroles")
  .setDescription("Officers: give members a Discord role for their in-game guild rank.")
  .addSubcommand((sub) => sub.setName("set").setDescription("Map a guild rank to a Discord role.")
    .addIntegerOption((o) => o.setName("rank").setDescription("Rank number: 0 is the guild master, 1 the next rank").setMinValue(0).setMaxValue(19).setRequired(true))
    .addRoleOption((o) => o.setName("role").setDescription("The Discord role for that rank").setRequired(true)))
  .addSubcommand((sub) => sub.setName("remove").setDescription("Stop using a rank.")
    .addIntegerOption((o) => o.setName("rank").setDescription("Rank number").setMinValue(0).setMaxValue(19).setRequired(true)))
  .addSubcommand((sub) => sub.setName("list").setDescription("Show the mapped ranks and whether rank roles are on."))
  .addSubcommand((sub) => sub.setName("enabled").setDescription("Turn rank roles on or off (on by default).")
    .addBooleanOption((o) => o.setName("on").setDescription("On or off").setRequired(true)))
  .addSubcommand((sub) => sub.setName("sync").setDescription("Preview or run the role changes now (it also runs every hour).")
    .addBooleanOption((o) => o.setName("apply").setDescription("Apply the changes (default: preview only)")));

export async function executeRankRoles(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuildContext(interaction);
  if (!context) return;
  const reply = (content: string) => interaction.reply({ content: content.slice(0, 1990), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  if (!interaction.member || !hasPermission(interaction.member as GuildMember, "officer")) {
    await reply("Only officers can set rank roles.");
    return;
  }
  const guildId = context.guildId;
  const sub = interaction.options.getSubcommand();
  if (sub === "set") {
    const rank = interaction.options.getInteger("rank", true);
    const role = interaction.options.getRole("role", true);
    if (role.id === interaction.guildId || role.managed) { await reply("Pick a normal role, not @everyone or a bot role."); return; }
    await prisma.guildRankRole.upsert({
      where: { guildId_rankIndex: { guildId, rankIndex: rank } },
      create: { guildId, rankIndex: rank, discordRoleId: role.id, createdBy: interaction.user.id },
      update: { discordRoleId: role.id, createdBy: interaction.user.id }
    });
    await reply(`Rank ${rank} now gives <@&${role.id}>. Members get it within the hour, or run **/mod rankroles sync**. Only mapped roles are ever added or removed.`);
    return;
  }
  if (sub === "remove") {
    const rank = interaction.options.getInteger("rank", true);
    await prisma.guildRankRole.deleteMany({ where: { guildId, rankIndex: rank } });
    await reply(`Rank ${rank} is no longer mapped. Members keep the role they have; remove it by hand if you want.`);
    return;
  }
  if (sub === "enabled") {
    const on = interaction.options.getBoolean("on", true);
    await prisma.guildSettings.upsert({ where: { guildId }, create: { guildId, rankRolesEnabled: on }, update: { rankRolesEnabled: on } });
    await reply(on ? "Rank roles are on." : "Rank roles are off. Nothing is added or removed.");
    return;
  }
  if (sub === "list") {
    const [links, settings] = await Promise.all([
      prisma.guildRankRole.findMany({ where: { guildId }, orderBy: { rankIndex: "asc" } }),
      prisma.guildSettings.findUnique({ where: { guildId }, select: { rankRolesEnabled: true } })
    ]);
    const state = settings?.rankRolesEnabled === false ? "off" : "on";
    await reply(`Rank roles are **${state}**.\n` + (links.length ? links.map((link) => `• Rank ${link.rankIndex} → <@&${link.discordRoleId}>`).join("\n") : "No rank is mapped yet: use **/mod rankroles set**. Until then nothing changes."));
    return;
  }
  if (!interaction.guild) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const apply = interaction.options.getBoolean("apply") === true;
  const result = await syncRankRoles(prisma, interaction.guild, { dryRun: !apply });
  const send = (content: string) => interaction.editReply({ content: content.slice(0, 1990), allowedMentions: { parse: [] } });
  if (result.skipped) { await send(result.skipped); return; }
  if (!result.changes.length) { await send("Everyone already has the right rank role."); return; }
  const lines = result.changes.slice(0, 15).map((c) => `• <@${c.discordUserId}>: ${[...c.add.map((r) => `+<@&${r}>`), ...c.remove.map((r) => `−<@&${r}>`)].join(" ")}`);
  await send(apply
    ? `Changed ${result.applied} member(s)${result.failed ? `, ${result.failed} failed` : ""}.\n${lines.join("\n")}`
    : `Preview: ${result.changes.length} member(s) would change (nothing was changed). Run again with apply:true.\n${lines.join("\n")}`);
}
