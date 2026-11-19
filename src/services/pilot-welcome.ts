import { EmbedBuilder, escapeMarkdown, type Client, type Guild } from "discord.js";
import { BRAND } from "../brand.js";
import type { Lang } from "../i18n.js";

const ADDON_URL = "https://www.curseforge.com/wow/addons/guilded";

/** One language: the one Discord reports for the server (the server has not picked a Guilded language yet when it is approved or idle). */
const langOf = (guild: Guild): Lang => guild.preferredLocale?.startsWith("fr") ? "fr" : "en";

// Three short lines in one language.
export function approvalWelcome(guildName: string, lang: Lang = "en") {
  const name = escapeMarkdown(guildName).slice(0, 100);
  const fr = lang === "fr";
  return new EmbedBuilder()
    .setColor(BRAND.color)
    .setTitle(`${BRAND.emoji} ${BRAND.name} — ${name}`)
    .setDescription((fr ? [
      `**Votre serveur est approuvé.** ${BRAND.name} est actif sur **${name}**.`,
      "Lancez **`/setup start`** : un guide de 2 minutes (English ou Français au premier écran).",
      `Les officiers installent l'addon : ${ADDON_URL} · Besoin d'aide ? \`/help\``
    ] : [
      `**Your server was approved.** ${BRAND.name} is active on **${name}**.`,
      "Run **`/setup start`**: a 2-minute guide (English or Français on its first screen).",
      `Officers install the addon: ${ADDON_URL} · Need help? \`/help\``
    ]).join("\n"))
    .setFooter({ text: fr ? "Vous recevez ceci car vous êtes propriétaire du serveur." : "You receive this because you own the server." });
}

// One private message to the approved server's owner. Never throws: closed DMs or a
// missing owner must not undo an approval. Returns whether the message was delivered.
export async function welcomeApprovedOwner(client: Client, guild: Guild): Promise<boolean> {
  try {
    if (!guild.ownerId) return false;
    const owner = await client.users.fetch(guild.ownerId);
    if (owner.bot) return false;
    await owner.send({ embeds: [approvalWelcome(guild.name, langOf(guild))], allowedMentions: { parse: [] } });
    return true;
  } catch {
    return false;
  }
}

export const liteIdleNotice = (lang: Lang = "en") => lang === "fr"
  ? `${BRAND.emoji} **${BRAND.name} Lite** : personne ne l'a utilisé ici depuis 30 jours. Il quittera le serveur dans 7 jours, sauf si quelqu'un lance une commande (par exemple \`/help\`). Vous pourrez le réinviter.`
  : `${BRAND.emoji} **${BRAND.name} Lite**: unused here for 30 days. It leaves in 7 days unless someone runs a command (for example \`/help\`). You can add it back any time.`;
export const LITE_IDLE_NOTICE = liteIdleNotice("en");

// Idle Lite server: the system channel, or the server owner's DMs when there is none.
// Never throws; returns whether the notice was delivered.
export async function warnIdleLite(client: Client, guild: Guild): Promise<boolean> {
  try {
    const content = liteIdleNotice(langOf(guild));
    if (guild.systemChannel) { await guild.systemChannel.send({ content, allowedMentions: { parse: [] } }); return true; }
    const owner = await client.users.fetch(guild.ownerId);
    if (owner.bot) return false;
    await owner.send({ content, allowedMentions: { parse: [] } });
    return true;
  } catch {
    return false;
  }
}
