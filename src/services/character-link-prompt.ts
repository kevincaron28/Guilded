import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, escapeMarkdown } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { t, type Lang } from "../i18n.js";
import { formatVerifyCode, verifyCodeFor } from "./character-verify.js";
import { companionWebUrl } from "./companion-links.js";
import { officerSyncRecent } from "./officer-sync.js";
import { linkStatusLines, memberLinkStatus } from "./link-status.js";

// Shared by the welcome button and /character pair so the two entry points never drift.
export async function characterLinkPrompt(database: PrismaClient, guildId: string, memberId: string, discordGuildId: string, lang: Lang, mode: "addon" | "companion" = "addon") {
  const characters = await database.character.findMany({
    where: { memberId, member: { guildId } },
    select: { name: true, realm: true, isMain: true },
    orderBy: [{ isMain: "desc" }, { name: "asc" }],
    take: 6
  });
  const hasMain = characters.some((character) => character.isMain);
  const listing = characters.length
    ? [t(lang, "pair.linked"), ...characters.slice(0, 5).map((character) => t(lang, character.isMain ? "pair.main" : "pair.alt", {
      name: escapeMarkdown(character.name.slice(0, 50)), realm: escapeMarkdown(character.realm.slice(0, 50))
    })), ...(characters.length > 5 ? [t(lang, "pair.more")] : [])].join("\n")
    : t(lang, "pair.none");
  const url = companionWebUrl(discordGuildId);
  const embed = new EmbedBuilder().setTitle(t(lang, "pair.title")).setColor(0xd4af37)
    .setDescription(`${listing}\n\n${t(lang, "pair.addonDefault")}`);
  // One line to paste in game, the same every time: the easiest way for everyone, so it comes first.
  const code = formatVerifyCode(await verifyCodeFor(database, guildId, memberId));
  const guild = await database.guild.findUnique({ where: { id: guildId }, select: { officerSyncAt: true } });
  // Without a recent officer sync the code may wait a long time: the manual way is shown too.
  const officersSync = officerSyncRecent(guild?.officerSyncAt);
  // The Windows app is the way in (2 steps, links every character on the PC at once, no officer
  // needed), so it comes first in both modes; the pasted line stays for members without Windows.
  // The one-use code for older companions is only made when asked for (the button below):
  // making one on every prompt silently replaced the previous code.
  embed.addFields(
    { name: t(lang, "pair.syncTitle"), value: t(lang, "pair.sync", {
      companion: url ? t(lang, "pair.openOnline") : t(lang, "pair.askLink"), server: discordGuildId
    }) },
    {
      name: t(lang, mode === "companion" ? "pair.verifyCompanionTitle" : "pair.verifyTitle"),
      value: t(lang, "pair.verify", { code }) + (officersSync ? "" : `\n${t(lang, "pair.verifySlow")}`)
    }
  );
  if (mode === "companion") embed.addFields({ name: t(lang, "pair.checkTitle"), value: t(lang, hasMain ? "pair.addAlts" : "pair.check") });
  // Connected / Last synced / What to do next, in plain words. Never blocks the prompt.
  const status = await (async () => {
    const member = await database.member.findUnique({ where: { id: memberId }, select: { discordUserId: true } });
    return member ? memberLinkStatus(database, member.discordUserId, guildId) : null;
  })().catch(() => null);
  if (status) embed.addFields({ name: t(lang, "pair.statusTitle"), value: linkStatusLines(status, lang).join("\n") });
  const row = new ActionRowBuilder<ButtonBuilder>();
  if (url) row.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(t(lang, "pair.online")).setURL(url));
  if (mode === "companion") row.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Secondary)
    .setCustomId(`onboard:paircode:${discordGuildId}`).setLabel(t(lang, "pair.codeButton")));
  return {
    embeds: [embed],
    components: row.components.length ? [row] : [],
    allowedMentions: { parse: [] as [] }
  };
}
