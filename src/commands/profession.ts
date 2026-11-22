import { cleanCharacterName, displayCharacterName } from "../services/character-display.js";
import { SlashCommandBuilder, type ChatInputCommandInteraction, MessageFlags } from "discord.js";
import { prisma } from "../database.js";
import { findProfessionHolders, professionCoverage } from "../services/profession-search.js";
import { professionDirectoryText } from "../services/profession-directory.js";
import { asLang, tx, type Lang } from "../i18n.js";
import { describeCooldowns } from "../services/recipes.js";
import { guildService, requireGuildContext } from "./context.js";
import { PROFESSIONS } from "../wow-data.js";
import { linkNextStep, pickOwnCharacter } from "../services/own-character.js";

export const professionCommand = new SlashCommandBuilder()
  .setName("profession")
  .setDescription("Manage your character professions.")
  .addSubcommand((subcommand) => subcommand
    .setName("set")
    .setDescription("Set a profession and skill level.")
    .addStringOption((option) => option.setName("profession").setDescription("Profession (pick from the list)").setRequired(true)
      .addChoices(...PROFESSIONS.map((name) => ({ name, value: name }))))
    .addIntegerOption((option) => option.setName("skill").setDescription("Skill level").setMinValue(1).setMaxValue(1000).setRequired(true))
    .addStringOption((option) => option.setName("character").setDescription("Your character (default: your main)").setAutocomplete(true)))
  .addSubcommand((subcommand) => subcommand
    .setName("list")
    .setDescription("List your recorded professions."))
  .addSubcommand((subcommand) => subcommand
    .setName("who")
    .setDescription("Find guild characters with a profession, highest skill first.")
    .addStringOption((option) => option.setName("profession").setDescription("Profession (pick from the list)").setRequired(true)
      .addChoices(...PROFESSIONS.map((name) => ({ name, value: name })))))
  .addSubcommand((subcommand) => subcommand
    .setName("cooldowns")
    .setDescription("Profession cooldowns from the addon; a DM when ready.")
    .addBooleanOption((option) => option.setName("mine").setDescription("Only my characters"))
    .addBooleanOption((option) => option.setName("notify").setDescription("DM me when one is ready")))
  .addSubcommand((subcommand) => subcommand
    .setName("directory")
    .setDescription("Top crafters and recipe lookups."))
  .addSubcommand((subcommand) => subcommand
    .setName("coverage")
    .setDescription("How many characters have each profession, and who is highest."));

// Discord messages are capped at 2000 characters.
function fit(lines: string[], header: string, lang: Lang): string {
  let text = header;
  for (const [index, line] of lines.entries()) {
    if (text.length + line.length + 1 > 1900) return `${text}\n${tx(lang, "…and {count} more", { count: lines.length - index })}`;
    text += `\n${line}`;
  }
  return text;
}

export async function executeProfession(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuildContext(interaction);
  if (!context) return;
  const subcommand = interaction.options.getSubcommand();
  const lang = asLang((await guildService.getSettings(context.guildId))?.language);

  if (subcommand === "directory") {
    await interaction.deferReply();
    await interaction.editReply({ content: await professionDirectoryText(prisma, context.guildId, lang), allowedMentions: { parse: [] } });
    return;
  }

  if (subcommand === "who") {
    const query = interaction.options.getString("profession", true);
    const holders = await findProfessionHolders(prisma, context.guildId, query);
    const lines = holders.map((holder) =>
      `**${cleanCharacterName(holder.character)}**${holder.isMain ? "" : ` (${tx(lang, "alt")})`} - ${holder.profession} ${holder.skillLevel} (${holder.member})`);
    await interaction.reply({
      content: holders.length ? fit(lines, tx(lang, "Characters with **{query}**:", { query }), lang) : tx(lang, "Nobody has {query} recorded yet.", { query }),
      flags: MessageFlags.Ephemeral
    });
    return;
  }
  if (subcommand === "coverage") {
    const coverage = await professionCoverage(prisma, context.guildId);
    const lines = coverage.map((row) =>
      tx(lang, "**{profession}**: {count} character(s), top {skill} ({name})", { profession: row.profession, count: row.characters, skill: row.topSkill, name: row.topCharacter }));
    await interaction.reply({
      content: coverage.length ? fit(lines, tx(lang, "Guild profession coverage:"), lang) : tx(lang, "No professions recorded yet."),
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (subcommand === "cooldowns") {
    const notify = interaction.options.getBoolean("notify");
    if (notify !== null) await prisma.member.update({ where: { id: context.memberId }, data: { cooldownPings: notify } });
    const own = await guildService.listCharacters(context.memberId);
    const mine = interaction.options.getBoolean("mine") ?? false;
    const list = await describeCooldowns(prisma, context.guildId, mine ? { characters: own.map((character) => character.name) } : {});
    await interaction.reply({ content: `${notify === null ? "" : `${notify ? tx(lang, "I will DM you when a cooldown of yours is ready.") : tx(lang, "No more cooldown DMs.")}\n\n`}${list}`.slice(0, 1990), flags: MessageFlags.Ephemeral });
    return;
  }

  const characters = await guildService.listCharacters(context.memberId);
  if (subcommand === "list") {
    const lines = characters.flatMap((character) =>
      character.professions.map((skill) => `${displayCharacterName(character)}: ${skill.profession} ${skill.skillLevel}`)
    );
    await interaction.reply({ content: lines.length ? lines.join("\n") : `${tx(lang, "No professions recorded.")} ${characters.length ? tx(lang, "Add one with /character profession set, or let the addon scan them.") : linkNextStep(lang)}`, flags: MessageFlags.Ephemeral });
    return;
  }

  const character = pickOwnCharacter(characters, interaction.options.getString("character"), lang);
  const profession = interaction.options.getString("profession", true).trim();
  const skill = interaction.options.getInteger("skill", true);
  await guildService.setProfession(character.id, profession, skill);
  await interaction.reply({ content: tx(lang, "Recorded {profession} {skill} for {name}.", { profession, skill, name: displayCharacterName(character) }), flags: MessageFlags.Ephemeral });
}
