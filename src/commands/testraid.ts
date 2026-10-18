import { SlashCommandBuilder, type ChatInputCommandInteraction, type GuildMember, MessageFlags } from "discord.js";
import { prisma } from "../database.js";
import { hasPermission } from "../permissions.js";
import { dungeonAnnouncement } from "../services/dungeon-announce.js";
import { loadClassEmojis } from "../services/character-display.js";
import { notifyDungeon } from "../services/notify.js";
import { updateDungeonLeaderboard } from "../services/dungeon-leaderboard.js";
import { cleanupTestRaids, finishTestRaid, SIM_CHARACTERS, simulateDungeonRun, startTestRaid } from "../services/simulation.js";
import { dungeonReport } from "./import-apply.js";
import { requireGuildContext } from "./context.js";
import { showEpProposal } from "./ep-award.js";
import { syncSignupEmbed } from "./raid.js";

export const testRaidCommand = new SlashCommandBuilder()
  .setName("testraid")
  .setDescription("Fake raid for testing (officers). Test data is separate and removable.")
  .addSubcommand((sub) => sub.setName("start").setDescription("Create a [TEST] raid with fake raiders signed up (caps, Maybe, waitlist).")
    .addIntegerOption((o) => o.setName("raiders").setDescription(`How many fake raiders (6-${SIM_CHARACTERS.length}, default 10)`).setMinValue(6).setMaxValue(SIM_CHARACTERS.length))
    .addIntegerOption((o) => o.setName("starts_in").setDescription("Minutes until it starts (default 70, so the reminder fires)").setMinValue(2).setMaxValue(1440))
    .addStringOption((o) => o.setName("realm").setDescription("Realm for the fake characters (default: your main's realm)")))
  .addSubcommand((sub) => sub.setName("finish").setDescription("Play the test raid: attendance, boss kills, loot, then end it and propose EP.")
    .addStringOption((o) => o.setName("raid").setDescription("Test raid (pick from the list)").setAutocomplete(true).setRequired(true))
    .addBooleanOption((o) => o.setName("via_addon").setDescription("Send attendance as an addon import to /import apply instead")))
  .addSubcommand((sub) => sub.setName("dungeon").setDescription("Fake dungeon run by 5 test characters: points, records, announcement.")
    .addNumberOption((o) => o.setName("minutes").setDescription("How long the run took (default 20-30)").setMinValue(1).setMaxValue(300))
    .addBooleanOption((o) => o.setName("deaths").setDescription("Give one player 2 deaths"))
    .addStringOption((o) => o.setName("realm").setDescription("Realm for the fake characters (default: your main's realm)")))
  .addSubcommand((sub) => sub.setName("cleanup").setDescription("Delete every test raid, test dungeon run, fake raider, and their points/loot."));

async function defaultRealm(memberId: string): Promise<string> {
  const main = await prisma.character.findFirst({ where: { memberId }, orderBy: { isMain: "desc" }, select: { realm: true } });
  return main?.realm ?? "WoW Forever";
}

export async function executeTestRaid(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuildContext(interaction);
  if (!context) return;
  if (!interaction.member || !hasPermission(interaction.member as GuildMember, "officer")) {
    await interaction.reply({ content: "Only officers can run test raids.", flags: MessageFlags.Ephemeral });
    return;
  }
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "cleanup") {
    const removed = await cleanupTestRaids(prisma, context.guildId);
    await interaction.reply({
      content: `Removed ${removed.raids} test raid(s), ${removed.dungeonRuns} test dungeon run(s), ${removed.members} fake raider(s) with their EPGP, points and loot, ${removed.auctions} test auction(s), and ${removed.imports} simulated import(s). Real data was not touched. (Delete any old test signup embeds by hand.)`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const realm = interaction.options.getString("realm") ?? await defaultRealm(context.memberId);

  if (subcommand === "dungeon") {
    const minutes = interaction.options.getNumber("minutes");
    const result = await simulateDungeonRun(prisma, {
      guildId: context.guildId, realm, officerId: interaction.user.id,
      ...(minutes !== null ? { minutes } : {}), deaths: interaction.options.getBoolean("deaths") ?? false
    });
    const emojis = interaction.guild ? await loadClassEmojis(interaction.guild).catch(() => ({})) : {};
    const post = dungeonAnnouncement(result.dungeons, "en", emojis);
    const posted = post ? await notifyDungeon(interaction.guild, (lang) => dungeonAnnouncement(result.dungeons, lang, emojis) ?? post) : false;
    if (post) await updateDungeonLeaderboard(interaction.guild);
    await interaction.reply({
      content: `Simulated a **Test Dungeon** run through the real import.${dungeonReport(result.dungeons)}

`
        + `${posted ? "The run was announced in the dungeon channel (marked [TEST])." : "No dungeon or notify channel is set, so nothing was announced."} `
        + "Try `/dungeon leaderboard`, `/dungeon records`, `/officer dungeon invalidate`. Run it again for the weekly repeat share; `/setup testraid cleanup` removes it all.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (subcommand === "start") {
    const result = await startTestRaid(prisma, {
      guildId: context.guildId,
      createdBy: interaction.user.id,
      officerMemberId: context.memberId,
      realm,
      raiders: interaction.options.getInteger("raiders") ?? 10,
      startsInMinutes: interaction.options.getInteger("starts_in") ?? 70
    });
    if (interaction.guild) await syncSignupEmbed(interaction.guild, context.guildId, result.raid.id);
    await interaction.reply({
      content: [
        `Created **${result.raid.title}** \`${result.raid.id}\` with ${result.members} fake raiders (realm ${realm}):`,
        `${result.counts.SIGNED_UP} signed up, ${result.counts.MAYBE} maybe, ${result.counts.WAITLISTED} waitlisted.`,
        "Try it: `/raid signup` yourself, `/raid cancel-signup`, `/lead edit` caps (waitlist moves up), `/raid roster`, `/lead note`.",
        "The raid reminder fires 60 minutes before start (if a signup channel is set).",
        `When ready: \`/setup testraid finish raid:${result.raid.id}\` (add \`via_addon:true\` to test the import path). Clean up with \`/setup testraid cleanup\`.`,
        `In game, \`/guilded sim\` uses the same fake names (${SIM_CHARACTERS.slice(0, 3).join(", ")}...) so an addon export matches.`
      ].join("\n"),
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const viaAddon = interaction.options.getBoolean("via_addon") ?? false;
  const result = await finishTestRaid(prisma, {
    guildId: context.guildId,
    raidId: interaction.options.getString("raid", true).trim(),
    officerId: interaction.user.id,
    realm,
    viaAddon
  });
  if (interaction.guild) await syncSignupEmbed(interaction.guild, context.guildId, result.raid.id);
  const summary = [
    `Played **${result.raid.title}**: all bosses killed, ${result.attending} raiders there` +
      `${result.late ? `, ${result.late} late` : ""}${result.noShow ? `, ${result.noShow} no-show` : ""}${result.walkIn ? `, ${result.walkIn} walked in from the waitlist` : ""}.`,
    result.loot.length ? `Loot: ${result.loot.map((row) => `${row.item} → ${row.winner} (${row.gp} GP)`).join(", ")}.` : "No loot awarded."
  ].join("\n");
  if (result.importId) {
    await interaction.reply({
      content: `${summary}\nAttendance was sent as an addon import. Apply it with \`/import apply id:${result.importId}\` (you should see the no-show and the walk-in), then \`/lead award-ep raid:${result.raid.id}\`.`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }
  await showEpProposal(interaction, context.guildId, result.raid.id, `${summary}\nApprove to test EP awards and the raid report:`);
}
