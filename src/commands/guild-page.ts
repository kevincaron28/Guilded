import { SlashCommandBuilder, type ChatInputCommandInteraction, type GuildMember, MessageFlags } from "discord.js";
import { prisma } from "../database.js";
import { hasPermission } from "../permissions.js";
import { companionWebUrl } from "../services/companion-links.js";
import { editGuildPage, forgetGuildPage, PAGE_SECTIONS, type PageSection } from "../services/guild-page.js";

// /mod page: officers manage their guild's public web page (docs/GUILD_PAGES_DESIGN.md).
// Officers, Guild Masters and server administrators only; raid leaders cannot.

const SECTION_LABELS: Record<PageSection, string> = {
  cores: "Raid cores and times", loot: "Loot system", rosters: "Rosters (character names)",
  rankings: "EPGP rankings (character names and points)", recruitment: "Recruitment text and Discord invite"
};

export const guildPageCommand = new SlashCommandBuilder()
  .setName("guildpage")
  .setDescription("Your guild's public web page (officers).")
  .setDescriptionLocalizations({ fr: "La page web publique de la guilde (officiers)." })
  .addSubcommand((sub) => sub.setName("status").setDescription("Show the page's address and what is public."))
  .addSubcommand((sub) => sub.setName("create").setDescription("Create the page as a private draft.")
    .addStringOption((o) => o.setName("address").setDescription("Address after /g/: lowercase letters, digits and dashes").setMaxLength(40)))
  .addSubcommand((sub) => sub.setName("section").setDescription("Show or hide one section.")
    .addStringOption((o) => o.setName("name").setDescription("Section").setRequired(true)
      .addChoices(...PAGE_SECTIONS.map((value) => ({ name: SECTION_LABELS[value], value }))))
    .addBooleanOption((o) => o.setName("show").setDescription("Show it on the page").setRequired(true)))
  .addSubcommand((sub) => sub.setName("text").setDescription("Set the intro or recruitment text; leave empty to clear it.")
    .addStringOption((o) => o.setName("field").setDescription("Which text").setRequired(true)
      .addChoices({ name: "Intro", value: "intro" }, { name: "Recruitment", value: "recruitment" }))
    .addStringOption((o) => o.setName("value").setDescription("The text").setMaxLength(2000)))
  .addSubcommand((sub) => sub.setName("invite").setDescription("Discord invite shown on the page (empty removes it).")
    .addStringOption((o) => o.setName("url").setDescription("https://discord.gg/...").setMaxLength(100)))
  .addSubcommand((sub) => sub.setName("search").setDescription("Let search engines list the page.")
    .addBooleanOption((o) => o.setName("allow").setDescription("Allow Google and others").setRequired(true)))
  .addSubcommand((sub) => sub.setName("publish").setDescription("Make the page public."))
  .addSubcommand((sub) => sub.setName("unpublish").setDescription("Hide the page again (its settings are kept)."));

export async function executeGuildPage(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId || !interaction.member || !hasPermission(interaction.member as GuildMember, "officer")) {
    await interaction.reply({ content: "Only Officers, Guild Masters and server administrators can manage the guild page.", flags: MessageFlags.Ephemeral });
    return;
  }
  const sub = interaction.options.getSubcommand();
  const discordId = interaction.guildId;
  const page = await prisma.guildPage.findFirst({ where: { guild: { discordId } }, select: { slug: true, sections: true } });
  if (!page && sub !== "create" && sub !== "status") {
    await interaction.reply({ content: "This server has no guild page yet: start with `/mod page create`.", flags: MessageFlags.Ephemeral });
    return;
  }
  let action = sub;
  let value: string | undefined;
  if (sub === "create") value = interaction.options.getString("address") ?? undefined;
  if (sub === "section") {
    const name = interaction.options.getString("name", true) as PageSection;
    const show = interaction.options.getBoolean("show", true);
    const current = new Set(page!.sections);
    if (show) current.add(name); else current.delete(name);
    action = "sections";
    value = PAGE_SECTIONS.filter((section) => current.has(section)).join(",");
  }
  if (sub === "text") { action = interaction.options.getString("field", true); value = interaction.options.getString("value") ?? ""; }
  if (sub === "invite") value = interaction.options.getString("url") ?? "none";
  if (sub === "search") { action = "index"; value = interaction.options.getBoolean("allow", true) ? "on" : "off"; }
  let summary: string;
  try {
    summary = await editGuildPage(prisma, action, discordId, value);
  } catch (error) {
    await interaction.reply({ content: error instanceof Error ? error.message : "The guild page could not be updated.", flags: MessageFlags.Ephemeral });
    return;
  }
  forgetGuildPage();
  const slug = /\/g\/([a-z0-9-]+)\//.exec(summary)?.[1];
  const base = companionWebUrl();
  const link = slug ? (base ? new URL(`/g/${slug}/`, base).href : `/g/${slug}/`) : null;
  await interaction.reply({ content: `${summary}${link ? `\nAddress: ${link}` : ""}`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}
