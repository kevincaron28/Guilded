import { guildWhere } from "../services/guild-scope.js";
import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction, type GuildMember } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { prisma } from "../database.js";
import { hostedPilot } from "../hosted-pilot.js";
import { hasPermission } from "../permissions.js";
import { classLabel, dayLabel, factionLabel, languageLabel, parseClasses, parseDays, parseRoles, RecruitmentError, roleLabel, shortText, type ListingFields } from "../services/recruitment.js";

// /mod recruit: the structured listing on guilded.kcaron.top/recruitment/ for the guild and
// for each raid core (7.0, roadmap request 5). Officers and Guild Masters only.

export const recruitCommand = new SlashCommandBuilder()
  .setName("recruit")
  .setDescription("Your listing on the website's recruitment page.")
  .addSubcommand((sub) => sub.setName("set").setDescription("Edit the guild's listing, or a core's.")
    .addBooleanOption((o) => o.setName("open").setDescription("Listed, taking applications").setRequired(true))
    .addStringOption((o) => o.setName("core").setDescription("A raid core (empty: guild)").setAutocomplete(true))
    .addStringOption((o) => o.setName("classes").setDescription("Priest, Mage... or any").setMaxLength(200))
    .addStringOption((o) => o.setName("roles").setDescription("tank, healer, dps, melee, ranged").setMaxLength(40))
    .addStringOption((o) => o.setName("days").setDescription("wed, sun...").setMaxLength(80))
    .addStringOption((o) => o.setName("times").setDescription("20:00-23:00 ET").setMaxLength(60))
    .addStringOption((o) => o.setName("language").setDescription("Language").addChoices({ name: "English", value: "en" }, { name: "Français", value: "fr" }, { name: "Both", value: "both" }))
    .addStringOption((o) => o.setName("faction").setDescription("Faction").addChoices({ name: "Alliance", value: "ALLIANCE" }, { name: "Horde", value: "HORDE" }))
    .addStringOption((o) => o.setName("realm").setDescription("Realm").setMaxLength(40))
    .addStringOption((o) => o.setName("note").setDescription("Short note (none clears)").setMaxLength(300)))
  .addSubcommand((sub) => sub.setName("status").setDescription("Show this server's listings."));

export interface ListingInput {
  open: boolean; classes?: string | null; roles?: string | null; days?: string | null; times?: string | null;
  language?: string | null; faction?: string | null; realm?: string | null; note?: string | null;
}

// Options left empty keep their saved value; "none" clears a text field.
export function listingPatch(input: ListingInput): Partial<ListingFields> & { open: boolean } {
  const clear = (value: string) => ["none", "-", "aucun"].includes(value.trim().toLowerCase());
  const text = (value: string | null | undefined, limit: number, label: string) => value == null ? undefined : clear(value) ? null : shortText(value, limit, label);
  const patch: Partial<ListingFields> & { open: boolean } = { open: input.open };
  if (input.classes != null) patch.classes = parseClasses(input.classes);
  if (input.roles != null) patch.roles = parseRoles(input.roles);
  if (input.days != null) patch.raidDays = parseDays(input.days);
  const times = text(input.times, 60, "Times");
  if (times !== undefined) patch.raidTimes = times;
  if (input.language) patch.language = input.language;
  if (input.faction) patch.faction = input.faction;
  const realm = text(input.realm, 40, "Realm");
  if (realm !== undefined) patch.realm = realm;
  const note = text(input.note, 300, "The note");
  if (note !== undefined) patch.note = note;
  return patch;
}

export async function saveListing(database: Pick<PrismaClient, "recruitmentListing">, guildId: string, core: { id: string } | null, patch: Partial<ListingFields> & { open: boolean }, actorId: string) {
  const scopeKey = core ? `core:${core.id}` : `guild:${guildId}`;
  return database.recruitmentListing.upsert({
    where: { scopeKey },
    create: { guildId, scopeKey, ...(core ? { coreId: core.id } : {}), ...patch, updatedBy: actorId },
    update: { ...patch, updatedBy: actorId }
  });
}

export function describeListing(listing: ListingFields, lang: "en" | "fr" = "en"): string {
  const parts = [
    listing.open ? "🟢 open" : "⚪ closed",
    listing.classes.length ? listing.classes.map((name) => classLabel(name, lang)).join(", ") : "all classes",
    listing.roles.length ? listing.roles.map((role) => roleLabel(role, lang)).join(", ") : "all roles",
    listing.raidDays.length ? listing.raidDays.map((day) => dayLabel(day, lang)).join(" ") : null,
    listing.raidTimes, listing.language ? languageLabel(listing.language, lang) : null, listing.faction ? factionLabel(listing.faction, lang) : null, listing.realm
  ];
  return parts.filter(Boolean).join(" · ") + (listing.note ? `\n> ${listing.note.replace(/\n/g, " ")}` : "");
}

const SITE = "https://guilded.kcaron.top/recruitment/";

export async function executeRecruit(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId || !interaction.guild || !hasPermission(interaction.member as GuildMember, "officer")) {
    await interaction.reply({ content: "Only Officers, Guild Masters and server administrators can manage recruitment listings.", flags: MessageFlags.Ephemeral });
    return;
  }
  const guild = await prisma.guild.findUnique({ where: guildWhere(interaction.guildId), select: { id: true, settings: { select: { applicationChannelId: true, logChannelId: true } } } });
  if (!guild) { await interaction.reply({ content: "Run `/setup start` first.", flags: MessageFlags.Ephemeral }); return; }
  const sub = interaction.options.getSubcommand();
  const notes: string[] = [];
  if (!hostedPilot.allows(interaction.guildId)) notes.push("This server is not approved yet (Guilded Lite): listings appear once the owner approves it.");
  if (!guild.settings?.applicationChannelId && !guild.settings?.logChannelId) notes.push("No applications channel or officer log is set, so website applications cannot reach you yet: set one with `/config`.");
  if (sub === "status") {
    const listings = await prisma.recruitmentListing.findMany({ where: { guildId: guild.id }, include: { core: { select: { name: true } } }, orderBy: { createdAt: "asc" } });
    const lines = listings.map((listing) => `**${listing.core ? listing.core.name : "Guild"}**: ${describeListing(listing)}`);
    await interaction.reply({ content: [lines.length ? lines.join("\n") : "No listing yet: use `/mod recruit set` (add `core` for a raid core).", ...notes, `Public page: ${SITE}`].join("\n").slice(0, 1900), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return;
  }
  let core: { id: string; name: string } | null = null;
  const coreName = interaction.options.getString("core")?.trim();
  if (coreName) {
    const name = coreName;
    core = await prisma.raidCore.findFirst({ where: { guildId: guild.id, name: { equals: name, mode: "insensitive" } }, select: { id: true, name: true } });
    if (!core) { await interaction.reply({ content: `No raid core named "${name}" in this server.`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } }); return; }
  }
  let listing;
  try {
    const patch = listingPatch({
      open: interaction.options.getBoolean("open", true),
      classes: interaction.options.getString("classes"), roles: interaction.options.getString("roles"), days: interaction.options.getString("days"),
      times: interaction.options.getString("times"), language: interaction.options.getString("language"), faction: interaction.options.getString("faction"),
      realm: interaction.options.getString("realm"), note: interaction.options.getString("note")
    });
    listing = await saveListing(prisma, guild.id, core, patch, interaction.user.id);
  } catch (error) {
    if (!(error instanceof RecruitmentError)) throw error;
    await interaction.reply({ content: error.message, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return;
  }
  await interaction.reply({
    content: [`**${core ? core.name : "Guild"}** listing saved: ${describeListing(listing)}`, ...notes, `Public page: ${SITE}`].join("\n").slice(0, 1900),
    flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] }
  });
}
