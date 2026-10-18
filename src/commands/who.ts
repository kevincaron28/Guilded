import { EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction, MessageFlags } from "discord.js";
import { prisma } from "../database.js";
import { createEpgpService } from "../services/epgp.js";
import { createMeritService } from "../services/merit.js";
import { findPlayer } from "../services/player-search.js";
import { guildService, requireGuildContext } from "./context.js";

const epgpService = createEpgpService(prisma);
const meritService = createMeritService(prisma);

export const whoCommand = new SlashCommandBuilder()
  .setName("who")
  .setDescription("Look up a player by character name: main, alts, professions, EPGP, attendance.")
  .addStringOption((o) => o.setName("character").setDescription("Character name (partial works)").setRequired(true));

export async function executeWho(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuildContext(interaction);
  if (!context) return;
  const query = interaction.options.getString("character", true);
  const found = await findPlayer(prisma, context.guildId, query);
  if (!found) {
    await interaction.reply({ content: `No linked character matches "${query}".`, flags: MessageFlags.Ephemeral });
    return;
  }
  const settings = await guildService.getSettings(context.guildId);
  const [standing, rates] = await Promise.all([
    epgpService.getStanding(found.member.id, settings?.baseGp ?? 0),
    meritService.getAttendanceRates(context.guildId)
  ]);
  const lines = found.characters.map((character) => {
    const professions = character.professions.map((skill) => `${skill.profession} ${skill.skillLevel}`).join(", ");
    const seen = character.lastSeenAt ? ` · seen <t:${Math.floor(character.lastSeenAt.getTime() / 1000)}:R>` : "";
    const details = [character.level ? `${character.level}` : null, character.race, character.className, character.spec].filter(Boolean).join(" ");
    return `${character.isMain ? "⭐" : "•"} **${character.name}** — ${details}${professions ? ` — ${professions}` : ""}${seen}`;
  });
  const rate = rates.get(found.member.id);
  await interaction.reply({
    embeds: [new EmbedBuilder()
      .setTitle(`⚜️ ${found.member.displayName}`)
      .setDescription(lines.join("\n").slice(0, 3900))
      .addFields(
        { name: "EP / GP / PR", value: `${standing.ep} / ${standing.gp} / ${standing.pr.toFixed(3)}`, inline: true },
        { name: "Attendance (30 days)", value: rate === undefined ? "no raids recorded" : `${Math.round(rate * 100)}%`, inline: true },
        { name: "Discord", value: `<@${found.member.discordUserId}>`, inline: true }
      )],
    allowedMentions: { parse: [] }
  });
}
