import { displayCharacterName } from "../services/character-display.js";
import { SlashCommandBuilder, type ChatInputCommandInteraction, MessageFlags } from "discord.js";
import { prisma } from "../database.js";
import { createAttunementService } from "../services/attunement.js";
import { guildService, requireGuildContext } from "./context.js";
import { pickOwnCharacter } from "../services/own-character.js";

const attunementService = createAttunementService(prisma);

export const attunementCommand = new SlashCommandBuilder()
  .setName("attunement")
  .setDescription("Track raid attunements for your characters.")
  .addSubcommand((subcommand) => subcommand
    .setName("set")
    .setDescription("Record an attunement for one of your characters.")
    .addStringOption((option) => option.setName("name").setDescription("Attunement (pick one already used, or type)").setAutocomplete(true).setRequired(true))
    .addBooleanOption((option) => option.setName("completed").setDescription("Completed? Defaults to true"))
    .addStringOption((option) => option.setName("character").setDescription("Your character (default: your main)").setAutocomplete(true)))
  .addSubcommand((subcommand) => subcommand
    .setName("list")
    .setDescription("List attunements for one of your characters.")
    .addStringOption((option) => option.setName("character").setDescription("Your character (default: your main)").setAutocomplete(true)));

export async function executeAttunement(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuildContext(interaction);
  if (!context) return;
  const subcommand = interaction.options.getSubcommand();
  const characters = await guildService.listCharacters(context.memberId);
  const character = pickOwnCharacter(characters, interaction.options.getString("character"));

  if (subcommand === "list") {
    const attunements = await attunementService.list(character.id);
    await interaction.reply({
      content: attunements.length
        ? attunements.map((a) => `${a.completed ? "✅" : "❌"} ${a.name}`).join("\n")
        : "No attunements recorded for this character.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const name = interaction.options.getString("name", true);
  const completed = interaction.options.getBoolean("completed") ?? true;
  await attunementService.set(character.id, name, completed, "discord");
  await interaction.reply({ content: `Recorded ${name} as ${completed ? "completed" : "not completed"} for ${displayCharacterName(character)}.`, flags: MessageFlags.Ephemeral });
}
