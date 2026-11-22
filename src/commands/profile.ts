import { armoryMarkdown } from "../services/armory-link.js";
import { characterName } from "../services/character-display.js";
import { EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction, MessageFlags } from "discord.js";
import { createEpgpService } from "../services/epgp.js";
import { prisma } from "../database.js";
import { guildService, memberLang, requireGuildContext } from "./context.js";
import { tx } from "../i18n.js";
import { BRAND } from "../brand.js";
import { linkNextStep } from "../services/own-character.js";

const epgpService = createEpgpService(prisma);

export const profileCommand = new SlashCommandBuilder()
  .setName("profile")
  .setDescription(`View your ${BRAND.name} member profile.`);

export async function executeProfile(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuildContext(interaction);
  if (!context) return;
  const lang = await memberLang(context.guildId);
  const [member, characters, epgp] = await Promise.all([
    prisma.member.findUnique({ where: { id: context.memberId } }),
    guildService.listCharacters(context.memberId),
    guildService.getSettings(context.guildId).then((settings) => epgpService.getStanding(context.memberId, settings?.baseGp ?? 0))
  ]);
  if (!member) throw new Error(tx(lang, "Your guild profile could not be found."));

  const characterLines = characters.length === 0
    ? [`${tx(lang, "No characters linked yet.")} ${linkNextStep(lang)}`]
    : characters.map((character) => {
      const professions = character.professions
        .map((skill) => `${skill.profession} ${skill.skillLevel}`)
        .join(", ");
      const seen = character.lastSeenAt ? ` · ${tx(lang, "seen")} <t:${Math.floor(character.lastSeenAt.getTime() / 1000)}:R>` : "";
      return `${character.isMain ? `**${tx(lang, "Main")}**` : tx(lang, "Alt")}: ${characterName(character)} (${character.race ? `${character.race} ` : ""}${character.className}${character.spec ? `, ${character.spec}` : ""})${professions ? ` — ${professions}` : ""}${seen}${armoryMarkdown(character) ? ` · ${armoryMarkdown(character)}` : ""}`;
    });
  // Your own profile is private (owner decision, 19 November 2026: personal views are ephemeral).
  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    embeds: [new EmbedBuilder()
      .setTitle(`⚜️ ${member.displayName}`)
      .setDescription(characterLines.join("\n"))
      .addFields(
        { name: "EP / GP / PR", value: `${epgp.ep} / ${epgp.gp} / ${epgp.pr.toFixed(3)}`, inline: true },
        { name: tx(lang, "Status"), value: member.status, inline: true }
      )]
  });
}
