import { SlashCommandBuilder, type ChatInputCommandInteraction, type GuildMember } from "discord.js";
import type { RaidRole } from "@prisma/client";
import { prisma } from "../database.js";
import { hasPermission } from "../permissions.js";
import { runCoreWizard } from "./core-wizard.js";
import { runCoreEditor } from "./core-editor.js";
import { describeRules, effectiveRules, LOOT_MODE_LABEL, LOOT_MODES } from "../services/core-rules.js";
import { executeCoreItems } from "./core-items.js";
import { coreSpotLabel, createRaidCoreService, ensureCoreDiscord, removeCoreRosterMessage, syncCoreRoster } from "../services/raid-core.js";
import { archiveCoreDiscord, deleteCoreDiscord, renameCoreDiscord } from "../services/core-channels.js";
import { guildService, requireGuildContext } from "./context.js";

const coreService = createRaidCoreService(prisma);

const coreOption = (o: import("discord.js").SlashCommandStringOption) =>
  o.setName("core").setDescription("Raid core (start typing its name)").setAutocomplete(true).setRequired(true);
const roleOption = (o: import("discord.js").SlashCommandStringOption) =>
  o.setName("role").setDescription("Their role in the core (default DPS)").addChoices(
    { name: "Tank", value: "TANK" }, { name: "Healer", value: "HEALER" }, { name: "DPS", value: "DPS" });
const characterOption = (o: import("discord.js").SlashCommandStringOption) =>
  o.setName("character").setDescription("The character they bring to this core (one of their linked characters)").setAutocomplete(true);

export const coreCommand = new SlashCommandBuilder()
  .setName("core")
  .setDescription("Raid cores: named rosters whose members get priority at that core's raid signups.")
  .addSubcommand((sub) => sub.setName("setup").setDescription("Guided: name a raid core, pick its players from menus, choose its rules (Raid Leaders). Start here."))
  .addSubcommand((sub) => sub.setName("edit").setDescription("Change a core by clicking: add or move players, roles, the bench, remove, rename (Raid Leaders).")
    .addStringOption(coreOption))
  .addSubcommand((sub) => sub.setName("create").setDescription("Create a raid core with a command (Raid Leaders). /core setup is easier.")
    .addStringOption((o) => o.setName("name").setDescription("e.g. Tuesday MC core").setMinLength(2).setMaxLength(50).setRequired(true))
    .addStringOption((o) => o.setName("description").setDescription("Optional: goals, progression").setMaxLength(300))
    .addStringOption((o) => o.setName("schedule").setDescription("Optional: raid nights, e.g. Tue/Thu 8-11pm EST").setMaxLength(100)))
  .addSubcommand((sub) => sub.setName("add").setDescription("Add a player to a core (Raid Leaders).")
    .addStringOption(coreOption)
    .addUserOption((o) => o.setName("player").setDescription("Discord member").setRequired(true))
    .addStringOption(roleOption)
    .addBooleanOption((o) => o.setName("bench").setDescription("Put them on the bench (a replacement) instead of the main roster"))
    .addStringOption(characterOption))
  .addSubcommand((sub) => sub.setName("character").setDescription("Set the character a player brings to a core, or a backup character (Raid Leaders).")
    .addStringOption(coreOption)
    .addUserOption((o) => o.setName("player").setDescription("Discord member").setRequired(true))
    .addStringOption(characterOption)
    .addBooleanOption((o) => o.setName("backup").setDescription("Add it as a backup character (e.g. a healer alt) instead"))
    .addStringOption((o) => o.setName("role").setDescription("The backup's role (default DPS)").addChoices(
      { name: "Tank", value: "TANK" }, { name: "Healer", value: "HEALER" }, { name: "DPS", value: "DPS" }))
    .addBooleanOption((o) => o.setName("remove").setDescription("Remove that backup character")))
  .addSubcommand((sub) => sub.setName("remove").setDescription("Remove a player from a core (Raid Leaders).")
    .addStringOption(coreOption)
    .addUserOption((o) => o.setName("player").setDescription("Discord member").setRequired(true)))
  .addSubcommand((sub) => sub.setName("rules").setDescription("A core's point rules. Every core follows the guild's rules unless you change a value here.")
    .addStringOption(coreOption)
    .addIntegerOption((o) => o.setName("attendance").setDescription("EP for attending").setMinValue(0))
    .addIntegerOption((o) => o.setName("late").setDescription("EP for arriving late").setMinValue(0))
    .addIntegerOption((o) => o.setName("boss").setDescription("EP per boss killed").setMinValue(0))
    .addIntegerOption((o) => o.setName("clear").setDescription("Bonus EP for a full clear").setMinValue(0))
    .addIntegerOption((o) => o.setName("base_gp").setDescription("Base GP for this core's PR").setMinValue(0))
    .addIntegerOption((o) => o.setName("decay").setDescription("Decay percent for this core's /epgp decay").setMinValue(0).setMaxValue(100))
    .addStringOption((o) => o.setName("loot_mode").setDescription("How this core's loot is decided").addChoices(
      { name: "Follow the guild", value: "DEFAULT" }, ...LOOT_MODES.map((mode) => ({ name: LOOT_MODE_LABEL[mode], value: mode }))))
    .addIntegerOption((o) => o.setName("reserves").setDescription("Soft reserves per player (soft reserves mode, 1 to 5)").setMinValue(1).setMaxValue(5))
    .addIntegerOption((o) => o.setName("offspec_percent").setDescription("Share of the GP an off-spec winner pays (default 50)").setMinValue(0).setMaxValue(100))
    .addIntegerOption((o) => o.setName("min_ep").setDescription("EP needed before a player takes loot priority (0 = off)").setMinValue(0))
    .addStringOption((o) => o.setName("pool").setDescription("Points: shared guild pool, or this core's own pool (applies to future points)").addChoices(
      { name: "Shared guild pool", value: "shared" }, { name: "Its own pool", value: "separate" }))
    .addStringOption((o) => o.setName("schedule").setDescription("Raid nights, e.g. Tue/Thu 8-11pm EST (empty clears it)").setMaxLength(100))
    .addBooleanOption((o) => o.setName("reset").setDescription("Go back to the guild defaults for every rule (points already in a pool stay there)")))
  .addSubcommand((sub) => sub.setName("items").setDescription("Set GP prices for items (EPGP priority loot): for one core, or the whole guild (Raid Leaders).")
    .addStringOption((o) => o.setName("action").setDescription("What to do").setRequired(true).addChoices(
      { name: "List the prices", value: "list" }, { name: "Set one price", value: "set" }, { name: "Remove one price", value: "remove" },
      { name: "Import a list from a file", value: "import" }, { name: "Remove all prices", value: "clear" }))
    .addStringOption((o) => o.setName("core").setDescription("Raid core (default: the guild-wide prices every core uses)").setAutocomplete(true))
    .addStringOption((o) => o.setName("item").setDescription("Item name or id (to set or remove)").setMaxLength(100))
    .addIntegerOption((o) => o.setName("gp").setDescription("Price in GP (to set)").setMinValue(0).setMaxValue(100000))
    .addAttachmentOption((o) => o.setName("file").setDescription("Text or CSV file, one 'item = price' per line (to import)")))
  .addSubcommand((sub) => sub.setName("show").setDescription("Show one core's roster.")
    .addStringOption(coreOption))
  .addSubcommand((sub) => sub.setName("list").setDescription("All raid cores and how many players each has."))
  .addSubcommand((sub) => sub.setName("post").setDescription("Refresh the roster messages in the roster channel (Raid Leaders).")
    .addStringOption((o) => o.setName("core").setDescription("One core (default: all)").setAutocomplete(true)))
  .addSubcommand((sub) => sub.setName("rename").setDescription("Rename a core (Raid Leaders). Its raids, prices and roster follow.")
    .addStringOption(coreOption)
    .addStringOption((o) => o.setName("name").setDescription("New name").setMinLength(2).setMaxLength(50).setRequired(true)))
  .addSubcommand((sub) => sub.setName("delete").setDescription("Delete a core (Raid Leaders). Raids created for it keep their signups.")
    .addStringOption(coreOption)
    .addBooleanOption((o) => o.setName("channels").setDescription("Delete its channels and role instead of archiving them read-only (default: archive)")));

function requireRaidLeader(interaction: ChatInputCommandInteraction): void {
  if (!interaction.member || !hasPermission(interaction.member as GuildMember, "raidLeader")) {
    throw new Error("Only Raid Leaders, Officers, Guild Masters, or Administrators can manage raid cores.");
  }
}

export async function executeCore(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuildContext(interaction);
  if (!context) return;
  const guildId = context.guildId;
  const subcommand = interaction.options.getSubcommand();
  // Only leadership changes a core; members join through the Apply button on its roster.
  if (["setup", "edit", "create", "add", "remove", "character", "post", "delete", "rules", "rename"].includes(subcommand)) requireRaidLeader(interaction);
  if (subcommand === "items") {
    // Anyone can look at the prices; changing them is for Raid Leaders.
    if (interaction.options.getString("action", true) !== "list") requireRaidLeader(interaction);
    await executeCoreItems(interaction, guildId);
    return;
  }

  if (subcommand === "setup") {
    await runCoreWizard(interaction);
    return;
  }

  if (subcommand === "edit") {
    await runCoreEditor(interaction, guildId, interaction.options.getString("core", true));
    return;
  }

  if (subcommand === "create") {
    const core = await coreService.create(guildId, interaction.options.getString("name", true), interaction.options.getString("description"), interaction.options.getString("schedule"));
    // Discord work (a role, a category, four channels) can take longer than the 3 s reply window.
    await interaction.deferReply({ ephemeral: true });
    const discord = await ensureCoreDiscord(interaction.guild, prisma, guildId, core.id);
    const made = await prisma.raidCore.findUnique({ where: { id: core.id } });
    await interaction.editReply({
      content: `Created raid core **${core.name}**. Add players with \`/core add\`, and create its raids with \`/raid create core:${core.name}\`.`
        + (made?.categoryId ? ` Its channels are ready${made.chatChannelId ? ` (<#${made.chatChannelId}>)` : ""}.` : "")
        + (discord.error ? ` Its channels could not be made: ${discord.error} It uses the shared channels until then (\`/core edit\` > Create channels & role).` : "")
    });
    return;
  }

  if (subcommand === "rename") {
    const before = await coreService.byIdOrName(guildId, interaction.options.getString("core", true));
    const renamed = await coreService.rename(guildId, before.id, interaction.options.getString("name", true));
    if (interaction.guild) await renameCoreDiscord(interaction.guild, renamed);
    await syncCoreRoster(interaction.guild, prisma, guildId, renamed.id);
    await interaction.reply({ content: `Renamed **${before.name}** to **${renamed.name}**. In game the new name arrives with the next companion upload.`, ephemeral: true });
    return;
  }

  if (subcommand === "add" || subcommand === "remove") {
    const user = interaction.options.getUser("player", true);
    const target = await guildService.ensureMember(guildId, user.id, user.username);
    const core = subcommand === "add"
      ? await coreService.addMember(guildId, interaction.options.getString("core", true), target.id, (interaction.options.getString("role") ?? "DPS") as RaidRole, interaction.options.getBoolean("bench") ?? false, interaction.options.getString("character"))
      : await coreService.removeMember(guildId, interaction.options.getString("core", true), target.id);
    await syncCoreRoster(interaction.guild, prisma, guildId, core.id);
    // Being in several cores is fine: say where else they are, so nobody thinks it was a move.
    const others = subcommand === "add" ? (await coreService.spotsOf(guildId, target.id)).filter((spot) => spot.coreId !== core.id) : [];
    const character = interaction.options.getString("character");
    await interaction.reply({
      content: subcommand === "add"
        ? `Added ${user.username} to **${core.name}**${character ? ` with ${character}` : ""}${interaction.options.getBoolean("bench") ? " (bench)" : ""}.`
          + (others.length ? ` Also in: ${others.map((spot) => `${spot.core.name}${spot.character ? ` (${spot.character.name})` : ""}`).join(", ")}.` : "")
        : `Removed ${user.username} from **${core.name}**.`,
      ephemeral: true
    });
    return;
  }

  if (subcommand === "character") {
    const user = interaction.options.getUser("player", true);
    const target = await guildService.ensureMember(guildId, user.id, user.username);
    const coreValue = interaction.options.getString("core", true);
    const name = interaction.options.getString("character");
    let content: string;
    let coreId: string;
    if (interaction.options.getBoolean("backup") || interaction.options.getBoolean("remove")) {
      if (!name) throw new Error("Pick the backup character.");
      if (interaction.options.getBoolean("remove")) {
        const { core, character } = await coreService.removeBackup(guildId, coreValue, target.id, name);
        content = `${character.name} is no longer a backup of ${user.username} in **${core.name}**.`;
        coreId = core.id;
      } else {
        const role = (interaction.options.getString("role") ?? "DPS") as RaidRole;
        const { core, character } = await coreService.addBackup(guildId, coreValue, target.id, name, role);
        content = `${user.username} can also bring **${character.name}** (${role}) to **${core.name}**.`;
        coreId = core.id;
      }
    } else {
      // No character clears it: the roster then shows only their name.
      const { core, character } = await coreService.setCharacter(guildId, coreValue, target.id, name);
      content = character ? `${user.username} brings **${character.name}** to **${core.name}**.` : `Cleared the character for ${user.username} in **${core.name}**.`;
      coreId = core.id;
    }
    await syncCoreRoster(interaction.guild, prisma, guildId, coreId);
    await interaction.reply({ content, ephemeral: true });
    return;
  }

  if (subcommand === "rules") {
    const core = await coreService.byIdOrName(guildId, interaction.options.getString("core", true));
    const settings = await guildService.getSettings(guildId);
    const number = (name: string) => interaction.options.getInteger(name);
    const data: Record<string, number | string | boolean | null> = {};
    if (interaction.options.getBoolean("reset")) {
      Object.assign(data, { attendanceEp: null, lateEp: null, bossEp: null, completionEp: null, baseGp: null, decayPercent: null, lootMode: null, reservesPerPlayer: null, offspecPercent: null, minEp: null });
    } else {
      for (const [option, field] of [["attendance", "attendanceEp"], ["late", "lateEp"], ["boss", "bossEp"], ["clear", "completionEp"], ["base_gp", "baseGp"]] as const) {
        if (number(option) !== null) data[field] = number(option);
      }
      if (number("decay") !== null) data["decayPercent"] = (number("decay") ?? 0) / 100;
      if (number("reserves") !== null) data["reservesPerPlayer"] = number("reserves");
      if (number("offspec_percent") !== null) data["offspecPercent"] = number("offspec_percent");
      if (number("min_ep") !== null) data["minEp"] = number("min_ep");
      const mode = interaction.options.getString("loot_mode");
      if (mode) data["lootMode"] = mode === "DEFAULT" ? null : mode;
    }
    const schedule = interaction.options.getString("schedule");
    if (schedule !== null) data["schedule"] = schedule.trim() || null;
    const pool = interaction.options.getString("pool");
    if (pool === "separate" && !core.separatePool) data["separatePool"] = true;
    if (pool === "shared" && core.separatePool) {
      // Going back to the shared pool would strand the points already in the core's pool.
      const stranded = await prisma.epgpTransaction.count({ where: { guildId, coreId: core.id } });
      if (stranded > 0) throw new Error(`${core.name} already has ${stranded} entries in its own pool. Those points would disappear from view, so it stays separate.`);
      data["separatePool"] = false;
    }
    const updated = Object.keys(data).length ? await prisma.raidCore.update({ where: { id: core.id }, data }) : core;
    const note = pool === "separate" && data["separatePool"] === true
      ? "\nFrom now on this core's raids pay EP and GP into its own pool (`/epgp balance core:...`). Points already in the guild pool stay there."
      : "";
    await interaction.reply({ content: describeRules(effectiveRules(settings, updated), core.name) + note, ephemeral: true });
    return;
  }

  if (subcommand === "show") {
    const core = await coreService.byIdOrName(guildId, interaction.options.getString("core", true));
    const byRole = (role: RaidRole) => core.members.filter((entry) => entry.role === role && !entry.bench).map(coreSpotLabel).join(", ") || "—";
    const benchNames = core.members.filter((entry) => entry.bench).map((entry) => `${coreSpotLabel(entry)} (${entry.role})`).join(", ");
    const backupNames = core.members.flatMap((entry) => entry.backups.map((backup) => `${entry.member.displayName} · ${backup.character.name} (${backup.role})`)).join(", ");
    const rules = describeRules(effectiveRules(await guildService.getSettings(guildId), core), core.name);
    await interaction.reply({
      content: `${core.description ? `${core.description}\n` : ""}${rules}\n🛡️ Tanks: ${byRole("TANK")}\n💚 Healers: ${byRole("HEALER")}\n⚔️ DPS: ${byRole("DPS")}${benchNames ? `
🪑 Bench: ${benchNames}` : ""}${backupNames ? `
🔁 Backups: ${backupNames}` : ""}`,
      ephemeral: true
    });
    return;
  }

  if (subcommand === "list") {
    const cores = await coreService.list(guildId);
    const me = await prisma.member.findFirst({ where: { guildId, discordUserId: interaction.user.id }, select: { id: true } });
    // The cores you are in, with your role and character there.
    const mine = (core: (typeof cores)[number]) => {
      const spot = me ? core.members.find((entry) => entry.memberId === me.id) : undefined;
      if (!spot) return "";
      const state = spot.trial ? ", trial" : spot.bench ? ", bench" : "";
      return ` · you: ${spot.role}${spot.character ? ` (${spot.character.name})` : ""}${state}`;
    };
    await interaction.reply({
      content: cores.length
        ? cores.map((core) => `• **${core.name}** — ${core.members.length} player${core.members.length === 1 ? "" : "s"}, ${core._count.raids} raid${core._count.raids === 1 ? "" : "s"}${mine(core)}`).join("\n").slice(0, 1990)
        : "No raid cores yet. Create one with `/core create`.",
      ephemeral: true
    });
    return;
  }

  if (subcommand === "post") {
    const value = interaction.options.getString("core");
    const settings = await guildService.getSettings(guildId);
    if (!settings?.coreChannelId) throw new Error("No roster channel is set. Use /setup or /setup config channel first.");
    const cores = value ? [await coreService.byIdOrName(guildId, value)] : await coreService.list(guildId);
    let posted = 0;
    for (const core of cores) if (await syncCoreRoster(interaction.guild, prisma, guildId, core.id)) posted++;
    await interaction.reply({ content: `Refreshed ${posted} roster message${posted === 1 ? "" : "s"} in <#${settings.coreChannelId}>.`, ephemeral: true });
    return;
  }

  const toDelete = await coreService.byIdOrName(guildId, interaction.options.getString("core", true));
  const pooled = toDelete.separatePool ? await prisma.epgpTransaction.count({ where: { guildId, coreId: toDelete.id } }) : 0;
  if (pooled > 0) throw new Error(`${toDelete.name} has ${pooled} entries in its own point pool. Deleting it would orphan them, so it can't be deleted while it keeps its own points.`);
  const core = await coreService.remove(guildId, toDelete.id);
  await removeCoreRosterMessage(interaction.guild, prisma, guildId, core.rosterMessageId, core.rosterChannelId);
  // Its channels are archived (read-only, history kept) unless the officer asks to delete them.
  const deleteChannels = interaction.options.getBoolean("channels") === true;
  const hasDiscord = !!(core.roleId || core.categoryId);
  if (hasDiscord) await interaction.deferReply({ ephemeral: true });
  const removed = deleteChannels && hasDiscord && interaction.guild ? await deleteCoreDiscord(interaction.guild, core) : 0;
  const archived = !deleteChannels && hasDiscord && interaction.guild ? await archiveCoreDiscord(interaction.guild, core) : 0;
  const content = `Deleted raid core **${core.name}**.`
    + (removed ? ` Removed ${removed} channel(s)/role.` : "")
    + (archived ? ` Its ${archived} text channel(s) moved, read-only, to the Archived cores category; delete them there when you no longer need them.` : "");
  if (hasDiscord) await interaction.editReply({ content });
  else await interaction.reply({ content, ephemeral: true });
}
