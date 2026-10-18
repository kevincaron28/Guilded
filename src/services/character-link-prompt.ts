import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, escapeMarkdown } from "discord.js";
import type { PrismaClient } from "@prisma/client";
import { t, type Lang } from "../i18n.js";
import { issueCharacterPairingCode } from "./character-pairing.js";
import { companionWebUrl } from "./companion-links.js";

// Shared by the welcome button and /character pair so the two entry points never drift.
export async function characterLinkPrompt(database: PrismaClient, guildId: string, memberId: string, discordGuildId: string, lang: Lang, mode: "addon" | "companion" = "addon") {
  const characters = await database.character.findMany({
    where: { memberId, member: { guildId } },
    select: { name: true, realm: true, isMain: true },
    orderBy: [{ isMain: "desc" }, { name: "asc" }],
    take: 6
  });
  const hasMain = characters.some((character) => character.isMain);
  const status = characters.length
    ? [t(lang, "pair.linked"), ...characters.slice(0, 5).map((character) => t(lang, character.isMain ? "pair.main" : "pair.alt", {
      name: escapeMarkdown(character.name.slice(0, 50)), realm: escapeMarkdown(character.realm.slice(0, 50))
    })), ...(characters.length > 5 ? [t(lang, "pair.more")] : [])].join("\n")
    : t(lang, "pair.none");
  const url = companionWebUrl(discordGuildId);
  const embed = new EmbedBuilder().setTitle(t(lang, "pair.title")).setColor(0xd4af37)
    .setDescription(`${status}\n\n${t(lang, "pair.addonDefault")}`);
  if (mode === "companion") {
    const pairing = await issueCharacterPairingCode(database, guildId, memberId);
    embed.addFields(
      { name: t(lang, "pair.codeTitle"), value: t(lang, "pair.code", {
        code: pairing.code, expires: `<t:${Math.floor(pairing.expiresAt.getTime() / 1000)}:R>`
      }) },
      { name: t(lang, "pair.characterOrderTitle"), value: t(lang, hasMain ? "pair.addAlts" : "pair.firstMain") },
      { name: t(lang, "pair.syncTitle"), value: t(lang, "pair.sync", {
        companion: url ? t(lang, "pair.openOnline") : t(lang, "pair.askLink"), server: discordGuildId
      }) },
      { name: t(lang, "pair.checkTitle"), value: t(lang, "pair.check") }
    );
  } else {
    embed.addFields(
      { name: t(lang, hasMain ? "pair.manualAltTitle" : "pair.manualMainTitle"), value: t(lang, hasMain ? "pair.manualAlt" : "pair.manualMain") },
      { name: t(lang, "pair.optionalTitle"), value: t(lang, "pair.optional") }
    );
  }
  const row = new ActionRowBuilder<ButtonBuilder>();
  if (mode === "addon") row.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Secondary)
    .setCustomId(`onboard:companion:${discordGuildId}`).setLabel(t(lang, "pair.connectOptional")));
  if (url) row.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(t(lang, "pair.online")).setURL(url));
  return {
    embeds: [embed],
    components: row.components.length ? [row] : [],
    allowedMentions: { parse: [] as [] }
  };
}
