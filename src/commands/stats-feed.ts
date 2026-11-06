import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction, type GuildMember } from "discord.js";
import { prisma } from "../database.js";
import { config } from "../config.js";
import { hasPermission } from "../permissions.js";
import { asLang } from "../i18n.js";
import { feedUrl, regenerateFeedKey, revokeFeedKey } from "../services/stat-snapshots.js";
import { guildService, requireGuildContext } from "./context.js";

// Mounted as /officer stats. Private replies. The feed address contains a secret key: it is shown once, only to the officer
// who asked, and only a hash is stored (services/stat-snapshots.ts).
export const statsFeedCommand = new SlashCommandBuilder()
  .setName("stats")
  .setDescription("Daily server statistics: a Google Sheets feed and the on/off switch.")
  .addSubcommand((sub) => sub.setName("feed").setDescription("Address for Google Sheets (IMPORTDATA).")
    .addStringOption((o) => o.setName("action").setDescription("Default: create the address").addChoices(
      { name: "Create (or say one exists)", value: "show" }, { name: "New address (the old one stops)", value: "regenerate" }, { name: "Revoke (stop the feed)", value: "revoke" })))
  .addSubcommand((sub) => sub.setName("toggle").setDescription("Turn the daily statistics on or off.")
    .addBooleanOption((o) => o.setName("on").setDescription("On or off").setRequired(true)));

export async function executeStatsFeed(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuildContext(interaction);
  if (!context) return;
  const reply = (content: string) => interaction.reply({ content: content.slice(0, 1990), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  if (!interaction.member || !hasPermission(interaction.member as GuildMember, "officer")) { await reply("Only officers can manage statistics."); return; }
  const guildId = context.guildId;
  const lang = asLang((await guildService.getSettings(guildId))?.language);
  const t = (en: string, fr: string) => lang === "fr" ? fr : en;
  const settings = await prisma.guildSettings.findUnique({ where: { guildId }, select: { statsEnabled: true, statsFeedKeyHash: true, statsFeedKeyAt: true } });
  if (!settings) { await reply(t("Run /setup first.", "Lancez d'abord /setup.")); return; }

  if (interaction.options.getSubcommand() === "toggle") {
    const on = interaction.options.getBoolean("on", true);
    await prisma.guildSettings.update({ where: { guildId }, data: { statsEnabled: on } });
    await reply(on ? t("Daily statistics are on. The Statistics page and the Google Sheets feed work again.", "Les statistiques quotidiennes sont activées.")
      : t("Daily statistics are off: no new snapshots, and the page and feed stop answering. Past snapshots are kept.", "Les statistiques quotidiennes sont désactivées : plus de relevés, la page et le flux s'arrêtent. Les relevés passés sont conservés."));
    return;
  }

  const action = interaction.options.getString("action") ?? "show";
  if (action === "revoke") {
    await revokeFeedKey(prisma, guildId);
    await reply(t("The feed address no longer works. Anyone who had it gets nothing.", "L'adresse du flux ne fonctionne plus."));
    return;
  }
  if (action === "show" && settings.statsFeedKeyHash) {
    await reply(t(`A feed address already exists (made <t:${Math.floor((settings.statsFeedKeyAt ?? new Date()).getTime() / 1000)}:D>). It cannot be shown again; use \`/officer stats feed action:New address\` to get a new one (the old one stops working).`,
      "Une adresse existe déjà. Elle ne peut plus être affichée; utilisez l'action « Nouvelle adresse » (l'ancienne cesse de fonctionner)."));
    return;
  }
  if (!config.PUBLIC_SITE_URL) { await reply(t("This bot has no public website address set, so it cannot give a feed address.", "Ce bot n'a pas d'adresse de site public.")); return; }
  const key = await regenerateFeedKey(prisma, guildId);
  const url = feedUrl(config.PUBLIC_SITE_URL, guildId, key);
  await reply(`${t("**Your Google Sheets address** (secret: anyone with it can read these server numbers; only you see this message):", "**Votre adresse Google Sheets** (secrète : seul vous voyez ce message) :")}\n\`${url}\`\n${t(
    "In a Sheet, type `=IMPORTDATA(\"address\")` in cell A1. Steps and a chart recipe: docs/SERVER_STATISTICS.md. Use `action:Revoke` to stop the feed.",
    "Dans une feuille, tapez `=IMPORTDATA(\"adresse\")` en A1. Voir docs/SERVER_STATISTICS.md.")}`);
}
