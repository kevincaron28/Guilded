import { SlashCommandBuilder, type ChatInputCommandInteraction, MessageFlags } from "discord.js";
import { prisma } from "../database.js";
import { importCharacter, parseCharacterString } from "../services/character-import.js";
import { applySelfExport, parseSelfExport } from "../services/self-export.js";
import { autoLinkUnclaimed, claimCharacter, linkUnclaimed } from "../services/character-autolink.js";
import { postToLogChannel } from "../services/housekeeping.js";
import { hasPermission } from "../permissions.js";
import { guildService, requireGuildContext } from "./context.js";
import { CLASSES } from "../wow-data.js";
import { revokeCompanionCredentials } from "../services/character-pairing.js";
import { characterLinkPrompt } from "../services/character-link-prompt.js";
import { asLang, t } from "../i18n.js";

export const characterCommand = new SlashCommandBuilder()
  .setName("character")
  .setDescription("Manage your WoW Forever characters.")
  .addSubcommand((subcommand) => subcommand
    .setName("pair")
    .setDescription("Connect the optional online companion for your main and alts."))
  .addSubcommand((subcommand) => subcommand
    .setName("add")
    .setDescription("Link a character to your profile.")
    .addStringOption((option) => option.setName("name").setDescription("Character name").setRequired(true))
    .addStringOption((option) => option.setName("class").setDescription("Class (pick from the list)").setRequired(true)
      .addChoices(...CLASSES.map((name) => ({ name, value: name }))))
    .addBooleanOption((option) => option.setName("main").setDescription("Set as your main character").setRequired(true))
    .addStringOption((option) => option.setName("realm").setDescription("Realm (default: the one your guild already uses)"))
    .addStringOption((option) => option.setName("spec").setDescription("Specialization (pick or type)").setAutocomplete(true))
    .addIntegerOption((option) => option.setName("level").setDescription("Character level").setMinValue(1).setMaxValue(100))
    .addStringOption((option) => option.setName("race").setDescription("Race (pick or type)").setAutocomplete(true)))
  .addSubcommand((subcommand) => subcommand
    .setName("import")
    .setDescription("Link a character, or send a gear check, from the /guilded character or /guilded share line.")
    .addStringOption((option) => option.setName("code").setDescription("Paste the line from /guilded character, or the code from /guilded share").setRequired(true))
    .addBooleanOption((option) => option.setName("main").setDescription("Set as your main (default: main only if you have none)")))
  .addSubcommand((subcommand) => subcommand
    .setName("claim")
    .setDescription("Link a character your addon has already reported (pick it from the list, nothing to type or paste).")
    .addStringOption((option) => option.setName("name").setDescription("Your character").setAutocomplete(true).setRequired(true)))
  .addSubcommand((subcommand) => subcommand
    .setName("unlink")
    .setDescription("Unlink a character (yours, or an officer can unlink anyone's).")
    .addStringOption((option) => option.setName("name").setDescription("The character").setAutocomplete(true).setRequired(true)))
  .addSubcommand((subcommand) => subcommand
    .setName("unclaimed")
    .setDescription("Officers: characters the addons reported that nobody has linked yet."))
  .addSubcommand((subcommand) => subcommand
    .setName("link")
    .setDescription("Officers: link a reported character to a Discord member.")
    .addStringOption((option) => option.setName("name").setDescription("The character").setAutocomplete(true).setRequired(true))
    .addUserOption((option) => option.setName("player").setDescription("Who it belongs to").setRequired(true)))
  .addSubcommand((subcommand) => subcommand
    .setName("autolink")
    .setDescription("Officers: link reported characters whose name matches a Discord member's name."))
  .addSubcommand((subcommand) => subcommand
    .setName("list")
    .setDescription("List your linked characters."));

// The realm most of the guild's characters use, so nobody types it.
async function defaultRealm(guildId: string): Promise<string> {
  const rows = await prisma.character.groupBy({ by: ["realm"], where: { member: { guildId } }, _count: { realm: true }, orderBy: { _count: { realm: "desc" } }, take: 1 });
  const realm = rows[0]?.realm;
  if (!realm) throw new Error("Nobody has a character linked yet, so I don't know your realm: add the realm option once (or use /character import).");
  return realm;
}

export async function executeCharacter(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand();
  // Acknowledge before database lookups, especially when the hosted database is waking up.
  if (["pair", "import"].includes(subcommand) && interaction.guild && interaction.guildId && interaction.member) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const context = await requireGuildContext(interaction);
  if (!context) return;
  if (subcommand === "pair") {
    const settings = await guildService.getSettings(context.guildId);
    await interaction.editReply(await characterLinkPrompt(prisma, context.guildId, context.memberId, interaction.guildId!, asLang(settings?.language), "companion"));
    return;
  }
  if (subcommand === "list") {
    const characters = await guildService.listCharacters(context.memberId);
    await interaction.reply({
      content: characters.length === 0
        ? "You have no linked characters."
        : characters.map((character) => `${character.isMain ? "⭐" : "•"} ${character.name} — ${character.race ? `${character.race} ` : ""}${character.className}${character.spec ? ` (${character.spec})` : ""}${character.lastSeenAt ? ` · last seen <t:${Math.floor(character.lastSeenAt.getTime() / 1000)}:R>` : ""}`).join("\n"),
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (subcommand === "claim") {
    const result = await claimCharacter(prisma, context.guildId, context.memberId, interaction.options.getString("name", true));
    await interaction.reply({ content: `Linked **${result.row.name}** (${result.row.className}${result.row.level ? `, level ${result.row.level}` : ""}) as ${result.isMain ? "your main" : "an alt"}. Its gear and consumables now show up by themselves.`, flags: MessageFlags.Ephemeral });
    return;
  }
  if (subcommand === "unlink") {
    const wanted = interaction.options.getString("name", true).trim();
    const character = await prisma.character.findFirst({
      where: { member: { guildId: context.guildId }, name: { equals: wanted, mode: "insensitive" } },
      include: { member: true }
    });
    if (!character) throw new Error(`No linked character called "${wanted}". /character list shows what is linked.`);
    const isOwn = character.memberId === context.memberId;
    if (!isOwn && !(interaction.member && hasPermission(interaction.member as Parameters<typeof hasPermission>[0], "officer"))) {
      throw new Error(`${character.name} is linked to ${character.member.displayName}. Only Officers and Guild Masters can unlink someone else's character.`);
    }
    await prisma.character.delete({ where: { id: character.id } });
    // An officer unlinking someone else's character is a correction, not routine
    // cleanup: revoke their paired companion access too, or their next upload
    // would silently relink this character right back.
    if (!isOwn) await revokeCompanionCredentials(prisma, character.memberId);
    if (interaction.guild) {
      await postToLogChannel(interaction.guild, isOwn
        ? `${interaction.user.username} unlinked their character ${character.name}.`
        : `${interaction.user.username} unlinked ${character.name} from ${character.member.displayName} (their companion pairing was also revoked).`);
    }
    await interaction.reply({
      content: `Unlinked **${character.name}**${isOwn ? "" : ` from ${character.member.displayName}. Their companion pairing was revoked, so a re-upload won't relink it automatically`}. If the addon reports it again, it will show up as unclaimed until it's linked again.`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }
  if (["unclaimed", "link", "autolink"].includes(subcommand)) {
    if (!interaction.member || !hasPermission(interaction.member as Parameters<typeof hasPermission>[0], "officer")) {
      await interaction.reply({ content: "Only Officers and Guild Masters can do that.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (subcommand === "unclaimed") {
      const rows = await prisma.unclaimedCharacter.findMany({ where: { guildId: context.guildId }, orderBy: { name: "asc" }, take: 60 });
      await interaction.reply({
        content: rows.length
          ? `**${rows.length} unclaimed:** ${rows.map((row) => `${row.name} (${row.className}${row.level ? ` ${row.level}` : ""})`).join(", ")}\nOwners: \`/character claim\`. Officers: \`/character link\` or \`/character autolink\`.`.slice(0, 1950)
          : "Every character the addons reported is linked.",
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    if (subcommand === "autolink") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const linked = await autoLinkUnclaimed(interaction.guild!, prisma, context.guildId);
      await interaction.editReply({ content: linked.length ? `Linked ${linked.map((row) => `${row.character} to ${row.member}`).join(", ")}.` : "Nothing matched by name (a Discord nickname must be the character's name, e.g. \"Ray\" or \"[GOLD] Ray\"). Use /character link for the rest." });
      return;
    }
    const wanted = interaction.options.getString("name", true).trim();
    const row = await prisma.unclaimedCharacter.findFirst({ where: { guildId: context.guildId, OR: [{ id: wanted }, { nameKey: wanted.toLowerCase() }] } });
    if (!row) throw new Error(`No unclaimed character called "${wanted}".`);
    const user = interaction.options.getUser("player", true);
    const target = await guildService.ensureMember(context.guildId, user.id, user.username);
    const outcome = await linkUnclaimed(prisma, target.id, row);
    await interaction.reply({ content: `Linked **${row.name}** to ${user.username} as ${outcome.isMain ? "their main" : "an alt"}.`, flags: MessageFlags.Ephemeral });
    return;
  }

  if (subcommand === "import") {
    const settings = await guildService.getSettings(context.guildId);
    const lang = asLang(settings?.language);
    const linkedText = (outcome: { action: "created" | "updated"; name: string; isMain: boolean }) => t(lang, "character.linkResult", {
      action: t(lang, outcome.action === "created" ? "character.created" : "character.updated"), name: outcome.name,
      kind: t(lang, outcome.isMain ? "character.mainKind" : "character.altKind")
    });
    const code = interaction.options.getString("code", true);
    if (code.trim().startsWith("QGEXP1:")) {
      const data = parseSelfExport(code);
      const outcome = await applySelfExport(prisma, context.memberId, data, interaction.options.getBoolean("main") ?? undefined);
      const problems = data.findings.filter((finding) => finding.severity !== "INFO").length;
      await interaction.editReply({
        content: linkedText(outcome)
          + (outcome.status ? ` Gear check: **${outcome.status}**${problems ? ` (${problems} issue${problems === 1 ? "" : "s"})` : ""}.` : " No gear check in that code (run /guilded inspect first).")
          + (data.consumables.length ? ` Consumables: ${data.consumables.map((row) => row.name).join(", ")}.` : "")
          + (outcome.attunements ? ` ${outcome.attunements} attunement${outcome.attunements === 1 ? "" : "s"} recorded.` : "")
          + `\n${t(lang, outcome.isMain ? "character.mainNext" : "character.altNext")}`
      });
      return;
    }
    const parsed = parseCharacterString(code);
    const outcome = await importCharacter(prisma, context.memberId, parsed, interaction.options.getBoolean("main") ?? undefined);
    const details = [parsed.race, parsed.className, parsed.spec ? `(${parsed.spec})` : "", parsed.level ? `level ${parsed.level}` : ""].filter(Boolean).join(" ");
    await interaction.editReply({
      content: `${linkedText(outcome)} ${parsed.realm} · ${details}.`
        + (parsed.professions.length ? `\nProfessions: ${parsed.professions.map((p) => `${p.name} ${p.skillLevel}`).join(", ")}.` : "")
        + `\n${t(lang, outcome.isMain ? "character.mainNext" : "character.altNext")}`
    });
    return;
  }

  const characterInput = {
    memberId: context.memberId,
    name: interaction.options.getString("name", true),
    realm: interaction.options.getString("realm") ?? await defaultRealm(context.guildId),
    className: interaction.options.getString("class", true),
    isMain: interaction.options.getBoolean("main", true)
  };
  const spec = interaction.options.getString("spec");
  const level = interaction.options.getInteger("level");
  const race = interaction.options.getString("race");
  const character = await guildService.addCharacter({
    ...characterInput,
    ...(spec === null ? {} : { spec }),
    ...(level === null ? {} : { level }),
    ...(race === null ? {} : { race })
  });
  await interaction.reply({ content: `Linked ${character.name} as ${character.isMain ? "your main character" : "an alt"}.`, flags: MessageFlags.Ephemeral });
}
