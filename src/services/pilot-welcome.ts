import { EmbedBuilder, escapeMarkdown, type Client, type Guild } from "discord.js";
import { BRAND } from "../brand.js";

const ADDON_URL = "https://www.curseforge.com/wow/addons/guilded";

// Bilingual: the server has not picked a language yet when it is approved.
export function approvalWelcome(guildName: string) {
  const name = escapeMarkdown(guildName).slice(0, 100);
  return new EmbedBuilder()
    .setColor(BRAND.color)
    .setTitle(`${BRAND.emoji} ${BRAND.name} — ${name}`)
    .setDescription([
      `**Your server was approved.** ${BRAND.name} is now active on **${name}**.`,
      "",
      "**Next steps**",
      "1. In your server, run **`/setup start`**: a 2-minute click-through guide. You pick English or Français on its first screen.",
      `2. Officers install the addon: ${ADDON_URL}`,
      "3. Optional: members link their character with `/character pair` and the companion.",
      "4. Stuck? `/help`, or `/report bug` to report a problem to the developer.",
      "",
      "─────────",
      "",
      `**Votre serveur a été approuvé.** ${BRAND.name} est maintenant actif sur **${name}**.`,
      "",
      "**Prochaines étapes**",
      "1. Dans votre serveur, lancez **`/setup start`** : un guide de 2 minutes avec des boutons. Vous choisirez English ou Français au premier écran.",
      `2. Les officiers installent l'addon : ${ADDON_URL}`,
      "3. Facultatif : les membres lient leur personnage avec `/character pair` et le compagnon.",
      "4. Besoin d'aide ? `/help`, ou `/report bug` pour signaler un problème au développeur."
    ].join("\n"))
    .setFooter({ text: "You receive this because you own the server. / Vous recevez ceci car vous êtes propriétaire du serveur." });
}

// One private message to the approved server's owner. Never throws: closed DMs or a
// missing owner must not undo an approval. Returns whether the message was delivered.
export async function welcomeApprovedOwner(client: Client, guild: Guild): Promise<boolean> {
  try {
    if (!guild.ownerId) return false;
    const owner = await client.users.fetch(guild.ownerId);
    if (owner.bot) return false;
    await owner.send({ embeds: [approvalWelcome(guild.name)], allowedMentions: { parse: [] } });
    return true;
  } catch {
    return false;
  }
}

export const LITE_IDLE_NOTICE = `${BRAND.emoji} **${BRAND.name} Lite**: nobody has used ${BRAND.name} on this server for 30 days. `
  + `It will leave in 7 days unless someone uses a command (for example \`/help\`). You can add it back any time.\n`
  + `Personne n'a utilisé ${BRAND.name} sur ce serveur depuis 30 jours. Il quittera le serveur dans 7 jours, sauf si quelqu'un utilise une commande (par exemple \`/help\`). Vous pourrez le réinviter en tout temps.`;

// Idle Lite server: the system channel, or the server owner's DMs when there is none.
// Never throws; returns whether the notice was delivered.
export async function warnIdleLite(client: Client, guild: Guild): Promise<boolean> {
  try {
    if (guild.systemChannel) { await guild.systemChannel.send({ content: LITE_IDLE_NOTICE, allowedMentions: { parse: [] } }); return true; }
    const owner = await client.users.fetch(guild.ownerId);
    if (owner.bot) return false;
    await owner.send({ content: LITE_IDLE_NOTICE, allowedMentions: { parse: [] } });
    return true;
  } catch {
    return false;
  }
}
