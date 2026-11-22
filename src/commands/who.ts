import { EmbedBuilder, SlashCommandBuilder, type ChatInputCommandInteraction, MessageFlags } from "discord.js";
import { prisma } from "../database.js";
import { createEpgpService } from "../services/epgp.js";
import { createMeritService } from "../services/merit.js";
import { findPlayer } from "../services/player-search.js";
import { guildService, memberLang, requireGuildContext } from "./context.js";
import { tx } from "../i18n.js";
import { canonicalClass, displayCharacterName } from "../services/character-display.js";
import { canonicalSpecialization } from "../wow-specializations.js";
import { specRole } from "../services/dps-kind.js";
import { characterTrustMap, REPORTED_HINT, trustSuffix } from "../services/character-trust.js";

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
  const lang = await memberLang(context.guildId);
  const found = await findPlayer(prisma, context.guildId, query);
  if (!found) {
    await interaction.reply({ content: tx(lang, "No linked character matches \"{query}\". Check the spelling (First Last works). The owner can link it: DM the bot the character's full name (First Last), or type it in the guild-invite channel.", { query }), flags: MessageFlags.Ephemeral });
    return;
  }
  const settings = await guildService.getSettings(context.guildId);
  const [standing, rates] = await Promise.all([
    epgpService.getStanding(found.member.id, settings?.baseGp ?? 0),
    meritService.getAttendanceRates(context.guildId)
  ]);
  const trust = await characterTrustMap(prisma, context.guildId, found.characters);
  const lines = found.characters.map((character) => {
    const professions = character.professions.map((skill) => `${skill.profession} ${skill.skillLevel}`).join(", ");
    const seen = character.lastSeenAt ? ` · ${tx(lang, "seen")} <t:${Math.floor(character.lastSeenAt.getTime() / 1000)}:R>` : "";
    // A damage spec says whether it plays melee or ranged.
    const className = canonicalClass(character.className);
    const spec = className ? canonicalSpecialization(className, character.spec) : undefined;
    const role = spec ? specRole(spec) : null;
    const kind = role === "MELEE" ? `(${tx(lang, "melee")})` : role === "RANGED" ? `(${tx(lang, "ranged")})` : null;
    const details = [character.level ? `${character.level}` : null, character.race, character.className, character.spec, kind].filter(Boolean).join(" ");
    return `${character.isMain ? "⭐" : "•"} **${displayCharacterName(character)}** — ${details}${professions ? ` — ${professions}` : ""}${seen}${trustSuffix(trust.get(character.id), lang)}`;
  });
  const rate = rates.get(found.member.id);
  await interaction.reply({
    embeds: [new EmbedBuilder()
      .setTitle(`⚜️ ${found.member.displayName}`)
      .setDescription(lines.join("\n").slice(0, 3600) + ([...trust.values()].includes("reported") ? `\n-# ${tx(lang, REPORTED_HINT)}` : ""))
      .addFields(
        { name: "EP / GP / PR", value: `${standing.ep} / ${standing.gp} / ${standing.pr.toFixed(3)}`, inline: true },
        { name: tx(lang, "Attendance (30 days)"), value: rate === undefined ? tx(lang, "no raids recorded") : `${Math.round(rate * 100)}%`, inline: true },
        { name: "Discord", value: `<@${found.member.discordUserId}>`, inline: true }
      )],
    allowedMentions: { parse: [] }
  });
}
