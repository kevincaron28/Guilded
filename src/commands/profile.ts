import { characterName } from "../services/character-display.js";
import { EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { createEpgpService } from "../services/epgp.js";
import { prisma } from "../database.js";
import { guildService, requireGuildContext } from "./context.js";
import { BRAND } from "../brand.js";

const epgpService = createEpgpService(prisma);

export const profileCommand = new SlashCommandBuilder()
  .setName("profile")
  .setDescription(`View your ${BRAND.name} member profile.`);

export async function executeProfile(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuildContext(interaction);
  if (!context) return;
  const [member, characters, epgp] = await Promise.all([
    prisma.member.findUnique({ where: { id: context.memberId } }),
    guildService.listCharacters(context.memberId),
    guildService.getSettings(context.guildId).then((settings) => epgpService.getStanding(context.memberId, settings?.baseGp ?? 0))
  ]);
  if (!member) throw new Error("Your guild profile could not be found.");

  const characterLines = characters.length === 0
    ? ["No characters linked yet."]
    : characters.map((character) => {
      const professions = character.professions
        .map((skill) => `${skill.profession} ${skill.skillLevel}`)
        .join(", ");
      const seen = character.lastSeenAt ? ` · seen <t:${Math.floor(character.lastSeenAt.getTime() / 1000)}:R>` : "";
      return `${character.isMain ? "**Main**" : "Alt"}: ${characterName(character)} (${character.race ? `${character.race} ` : ""}${character.className}${character.spec ? `, ${character.spec}` : ""})${professions ? ` — ${professions}` : ""}${seen}`;
    });
  await interaction.reply({
    embeds: [new EmbedBuilder()
      .setTitle(`⚜️ ${member.displayName}`)
      .setDescription(characterLines.join("\n"))
      .addFields(
        { name: "EP / GP / PR", value: `${epgp.ep} / ${epgp.gp} / ${epgp.pr.toFixed(3)}`, inline: true },
        { name: "Status", value: member.status, inline: true }
      )]
  });
}
