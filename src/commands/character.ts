import { characterName, displayCharacterName, loadFullNameBook, cleanCharacterName } from "../services/character-display.js";
import { executeAppeal } from "../services/do-not-invite-flow.js";
import { selectedCharacter } from "../services/character-match.js";
import { SlashCommandBuilder, type ChatInputCommandInteraction, MessageFlags } from "discord.js";
import { prisma } from "../database.js";
import { importCharacter, parseCharacterString } from "../services/character-import.js";
import { applySelfExport, parseSelfExport } from "../services/self-export.js";
import { autoLinkUnclaimed, linkUnclaimed } from "../services/character-autolink.js";
import { askUnlink } from "../services/companion-link-dm.js";
import { postToLogChannel } from "../services/housekeeping.js";
import { hasPermission } from "../permissions.js";
import { guildService, requireGuildContext } from "./context.js";
import { CLASSES } from "../wow-data.js";
import { characterLinkHelp } from "../services/character-link-prompt.js";
import { unlinkCharacter } from "../services/character-verify.js";
import { asLang, t, type Lang } from "../i18n.js";
import { executeWow } from "./wow.js";
import { legacyView } from "./router.js";
import { executeDeleteMyData } from "./delete-my-data.js";
import { removePictureByOfficer } from "../services/character-picture.js";
import { addRaceSubcommand, executeRace } from "./race.js";
import { characterPanel } from "../services/character-panel.js";
import { isProfileHidden, privacyReply, setProfileHidden } from "../services/profile-privacy.js";
import { isHoldingMember, officerMoveCharacter, WITH_DETACHED, DETACHED } from "../services/character-move.js";

// One line for the claim and unlink replies so members find the panel (both languages: the replies themselves are English).
const PANEL_HINT = [t("en", "panel.hint"), t("fr", "panel.hint")].join("\n");

export const characterCommand = new SlashCommandBuilder()
  .setName("character")
  .setDescription("Character links and conflicts.")
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
    .setName("unlink")
    .setDescription("Unlink a character (officers: anyone's).")
    .addStringOption((option) => option.setName("name").setDescription("The character").setAutocomplete(true).setRequired(true)))
  .addSubcommand((subcommand) => subcommand
    .setName("appeal")
    .setDescription("Ask officers to review your do-not-invite entry.")
    .addStringOption((o) => o.setName("message").setDescription("For the officers").setMaxLength(500)))
  .addSubcommand((subcommand) => subcommand
    .setName("unclaimed")
    .setDescription("Unlinked characters and conflicts."))
  .addSubcommand((subcommand) => subcommand
    .setName("link")
    .setDescription("Link a reported character to a member.")
    .addStringOption((option) => option.setName("name").setDescription("Character").setAutocomplete(true).setRequired(true))
    .addUserOption((option) => option.setName("player").setDescription("Owner").setRequired(true)))
  .addSubcommand((subcommand) => subcommand
    .setName("move")
    .setDescription("Move a character, history kept.")
    .addStringOption((option) => option.setName("name").setDescription("Character").setAutocomplete(true).setRequired(true))
    .addUserOption((option) => option.setName("player").setDescription("New owner").setRequired(true)))
  .addSubcommand((subcommand) => subcommand
    .setName("autolink")
    .setDescription("Link characters named like a member."))
  .addSubcommand((subcommand) => subcommand
    .setName("claimdm")
    .setDescription("Claim DMs on or off")
    .addBooleanOption((option) => option.setName("on").setDescription("On").setRequired(true)))
  .addSubcommand((subcommand) => subcommand
    .setName("picture")
    .setDescription("Remove a picture; pictures on/off")
    .addStringOption((option) => option.setName("action").setDescription("Action").setRequired(true)
      .addChoices({ name: "remove", value: "remove" }, { name: "off", value: "off" }, { name: "on", value: "on" }))
    .addStringOption((option) => option.setName("name").setDescription("Character").setAutocomplete(true)))
  .addSubcommand((subcommand) => subcommand
    .setName("privacy")
    .setDescription("Hide or show you on the public website pages.")
    .addStringOption((option) => option.setName("action").setDescription("Action").setRequired(true)
      .addChoices({ name: "hide", value: "hide" }, { name: "show", value: "show" }, { name: "status", value: "status" }, { name: "delete all my data", value: "delete" })))
  .addSubcommand((subcommand) => subcommand
    .setName("list")
    .setDescription("Your characters: link, set main, unlink."))
  .addSubcommand((subcommand) => addRaceSubcommand(subcommand));

// Commands restructure (November 2026): one way in for members. /character link replaces pair,
// import and claim (those answer "moved" for one release, see index.ts), and /character guild
// replaces /wow list and /wow use. Mounted on /character beside the builder above.
export const characterLinkCommand = new SlashCommandBuilder()
  .setName("character")
  .setDescription("Link your characters; choose your in-game guild.")
  .addSubcommand((subcommand) => subcommand
    .setName("link")
    .setDescription("How to link your characters, or paste a line or code from the addon.")
    .addStringOption((option) => option.setName("line_or_code").setDescription("Line from /guilded character or code from /guilded share"))
    .addBooleanOption((option) => option.setName("main").setDescription("Set as your main (default: only if you have none)")))
  .addSubcommand((subcommand) => subcommand
    .setName("guild")
    .setDescription("Your in-game guild: list them, or pick one.")
    .addStringOption((option) => option.setName("guild").setDescription("Guild ID to use, or default (empty: list)")));

/** /character link and /character guild. */
export async function executeCharacterLink(interaction: ChatInputCommandInteraction): Promise<void> {
  if (interaction.options.getSubcommand() === "guild") {
    await executeWow(legacyView(interaction, "wow", interaction.options.getString("guild") ? "use" : "list"));
    return;
  }
  const pasted = interaction.options.getString("line_or_code")?.trim();
  if (interaction.guild && interaction.guildId && interaction.member) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const context = await requireGuildContext(interaction);
  if (!context) return;
  const settings = await guildService.getSettings(context.guildId);
  const lang = asLang(settings?.language);
  if (!pasted) {
    await interaction.editReply(await characterLinkHelp(prisma, context.guildId, context.memberId, lang));
    return;
  }
  await linkPastedLine(interaction, context.memberId, lang, pasted);
}

// Was /character import: an addon line (/guilded character) or a self-export code (/guilded share).
async function linkPastedLine(interaction: ChatInputCommandInteraction, memberId: string, lang: Lang, code: string): Promise<void> {
  const linkedText = (outcome: { action: "created" | "updated"; name: string; isMain: boolean }) => t(lang, "character.linkResult", {
    action: t(lang, outcome.action === "created" ? "character.created" : "character.updated"), name: outcome.name,
    kind: t(lang, outcome.isMain ? "character.mainKind" : "character.altKind")
  });
  if (code.startsWith("QGEXP1:")) {
    const data = parseSelfExport(code);
    const outcome = await applySelfExport(prisma, memberId, data, interaction.options.getBoolean("main") ?? undefined);
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
  const outcome = await importCharacter(prisma, memberId, parsed, interaction.options.getBoolean("main") ?? undefined);
  const details = [parsed.race, parsed.className, parsed.spec ? `(${parsed.spec})` : "", parsed.level ? `level ${parsed.level}` : ""].filter(Boolean).join(" ");
  await interaction.editReply({
    content: `${linkedText(outcome)} ${parsed.realm} · ${details}.`
      + (parsed.professions.length ? `\nProfessions: ${parsed.professions.map((p) => `${p.name} ${p.skillLevel}`).join(", ")}.` : "")
      + `\n${t(lang, outcome.isMain ? "character.mainNext" : "character.altNext")}`
  });
}

// The realm most of the guild's characters use, so nobody types it.
async function defaultRealm(guildId: string): Promise<string> {
  const rows = await prisma.character.groupBy({ by: ["realm"], where: { member: { guildId } }, _count: { realm: true }, orderBy: { _count: { realm: "desc" } }, take: 1 });
  const realm = rows[0]?.realm;
  if (!realm) throw new Error("Nobody has a character linked yet, so I don't know your realm: add the realm option once (or use /character link).");
  return realm;
}

export async function executeCharacter(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand();
  // 9.4: the listed person's appeal (do-not-invite-flow.ts), under /character to keep the top-level command count.
  if (subcommand === "appeal") { await executeAppeal(interaction); return; }
  // "Hide my profile": per Discord user, so it needs no server context (profile-privacy.ts).
  if (subcommand === "privacy") {
    const asked = interaction.options.getString("action", true);
    // Was /delete-my-data (commands restructure, November 2026): main.ts routes it with error reporting.
    if (asked === "delete") { await executeDeleteMyData(interaction); return; }
    if (asked !== "hide" && asked !== "show" && asked !== "status") { await interaction.reply({ content: "Choose hide, show or status.", flags: MessageFlags.Ephemeral }); return; }
    const action = asked;
    if (action !== "status") await setProfileHidden(prisma, interaction.user.id, action === "hide");
    await interaction.reply({ content: privacyReply(interaction.locale.startsWith("fr") ? "fr" : "en", action, action === "status" ? await isProfileHidden(prisma, interaction.user.id) : action === "hide"), flags: MessageFlags.Ephemeral });
    return;
  }
  const context = await requireGuildContext(interaction);
  if (!context) return;
  if (subcommand === "race") { await executeRace(interaction, context); return; }
  if (subcommand === "list") {
    // The panel: the member's characters with Link, Set main, Unlink, Picture and Refresh (character-panel.ts).
    await interaction.reply({ ...await characterPanel(prisma, interaction.user.id, interaction.guildId!), flags: MessageFlags.Ephemeral });
    return;
  }

  if (subcommand === "unlink") {
    const wanted = interaction.options.getString("name", true).trim();
    const character = selectedCharacter(await prisma.character.findMany({
      where: { member: { guildId: context.guildId } },
      include: { member: true }
    }), wanted);
    if (!character) throw new Error(`No linked character called "${wanted}". /character list shows what is linked.`);
    const isOwn = character.memberId === context.memberId;
    if (!isOwn && !(interaction.member && hasPermission(interaction.member as Parameters<typeof hasPermission>[0], "officer"))) {
      throw new Error(`${characterName(character)} is linked to ${character.member.displayName}. Only Officers and Guild Masters can unlink someone else's character.`);
    }
    if (isOwn) {
      // Same rules as the DM and the panel: a private confirm step first, then "Link it back" under the result (companion-link-dm.ts).
      await interaction.reply({ ...await askUnlink(prisma, interaction.user.id, character.id), flags: MessageFlags.Ephemeral });
      return;
    }
    // Detached, not deleted (owner decision, 10 November 2026): pictures, wishlist, professions and the
    // rest of its history stay with the row and come back when it is linked again or an officer moves it.
    // The /guilded verify code that character keeps repeating in game must not link it back.
    // An officer unlinking someone else's character is a correction: their companion uploads must
    // not relink it either. Only this character is affected; their devices stay connected.
    await unlinkCharacter(prisma, character, context.guildId, !isOwn);
    if (interaction.guild) {
      await postToLogChannel(interaction.guild, lang => isOwn
        ? lang === "fr" ? `${interaction.user.username} a délié son personnage ${characterName(character)}.` : `${interaction.user.username} unlinked their character ${characterName(character)}.`
        : lang === "fr" ? `${interaction.user.username} a délié ${characterName(character)} de ${character.member.displayName}.` : `${interaction.user.username} unlinked ${characterName(character)} from ${character.member.displayName}.`);
    }
    await interaction.reply({
      content: `Unlinked **${characterName(character)}**${isOwn ? "" : ` from ${character.member.displayName}. Their uploads won't relink it; an officer can still move it to anyone (\`/officer character move\`)`}. Nothing was deleted: its history comes back when it is linked again. If the addon reports it again, it will show up as unclaimed until then.

${PANEL_HINT}`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }
  if (["unclaimed", "link", "move", "autolink", "picture", "claimdm"].includes(subcommand)) {
    if (!interaction.member || !hasPermission(interaction.member as Parameters<typeof hasPermission>[0], "officer")) {
      await interaction.reply({ content: "Only Officers and Guild Masters can do that.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (subcommand === "unclaimed") {
      const rows = await prisma.unclaimedCharacter.findMany({ where: { guildId: context.guildId }, orderBy: { name: "asc" }, take: 60 });
      const book = await loadFullNameBook(prisma, context.guildId);
      // The officer queue: two members claim one character with the same proof. And what was unlinked, history kept.
      const queue = await prisma.characterLinkConflict.findMany({ where: { guildId: context.guildId, status: "OPEN" }, include: { character: { select: { name: true, displayName: true } } }, orderBy: { createdAt: "asc" }, take: 15 });
      const people = queue.length ? await prisma.member.findMany({ where: { id: { in: queue.flatMap((row) => [row.ownerMemberId, row.claimantMemberId]) } }, select: { id: true, discordUserId: true } }) : [];
      const mention = (memberId: string) => { const member = people.find((row) => row.id === memberId); return member && !isHoldingMember(member) ? `<@${member.discordUserId}>` : "someone"; };
      const detached = await prisma.character.findMany({ where: { member: { guildId: context.guildId }, ...DETACHED }, select: { name: true, displayName: true }, orderBy: { name: "asc" }, take: 30 });
      const parts = [
        rows.length
          ? `**${rows.length} unclaimed:** ${rows.map((row) => `${displayCharacterName(row, book)} — ${row.realm} (${row.className}${row.level ? ` ${row.level}` : ""})`).join(", ")}\nOwners: DM the bot your character's full name (First Last), or type it in the guild-invite channel. Officers: \`/officer character link\` or \`/officer character autolink\`.`.slice(0, 1200)
          : "Every character the addons reported is linked.",
        ...(queue.length ? [`**Waiting for you (two members, same proof):** ${queue.map((row) => `${characterName(row.character)}: linked to ${mention(row.ownerMemberId)}, claimed by ${mention(row.claimantMemberId)}`).join("; ")}\nDecide with \`/officer character move\`.`.slice(0, 450)] : []),
        ...(detached.length ? [`**Unlinked, history kept:** ${detached.map((row) => characterName(row)).join(", ")}`.slice(0, 280)] : [])
      ];
      await interaction.reply({ content: parts.join("\n\n"), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
      return;
    }
    if (subcommand === "move") {
      const wanted = interaction.options.getString("name", true).trim();
      const character = selectedCharacter(await prisma.character.findMany({ where: { member: { guildId: context.guildId }, ...WITH_DETACHED }, include: { member: true } }), wanted);
      if (!character) throw new Error(`No character called "${wanted}" is linked or was unlinked here. For one the addons reported and nobody linked, use /officer character link.`);
      const user = interaction.options.getUser("player", true);
      if (user.bot) throw new Error("A bot cannot own a character.");
      const target = await guildService.ensureMember(context.guildId, user.id, user.username);
      if (!character.detachedAt && character.memberId === target.id) {
        await interaction.reply({ content: `**${characterName(character)}** is already linked to ${user.username}.`, flags: MessageFlags.Ephemeral });
        return;
      }
      const moved = await officerMoveCharacter(prisma, character.id, target.id);
      if (!moved) throw new Error(`${characterName(character)} is gone. /officer character unclaimed shows what can be linked.`);
      const from = character.detachedAt ? "the unlinked characters" : character.member.displayName;
      if (interaction.guild) await postToLogChannel(interaction.guild, lang => lang === "fr" ? `${interaction.user.username} a déplacé ${characterName(character)} de ${from} vers ${user.username} (historique conservé).` : `${interaction.user.username} moved ${characterName(character)} from ${from} to ${user.username} (history kept).`);
      await interaction.reply({
        content: `Moved **${characterName(character)}** from ${from} to ${user.username} as ${moved.character.isMain ? "their main" : "an alt"}. Its history came with it${character.detachedAt ? "" : `, and ${character.member.displayName}'s uploads and verify code won't take it back`}.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    if (subcommand === "picture") {
      const action = interaction.options.getString("action", true);
      if (action === "on" || action === "off") {
        await prisma.guildSettings.update({ where: { guildId: context.guildId }, data: { characterPicturesEnabled: action === "on" } });
        if (interaction.guild) await postToLogChannel(interaction.guild, lang => lang === "fr" ? `${interaction.user.username} a modifié les images de personnage : ${action}.` : `${interaction.user.username} turned character pictures ${action}.`);
        await interaction.reply({ content: action === "on"
          ? "Character pictures are on: cards show a character's picture when one is set. Picking pictures is paused for now."
          : "Character pictures are off for this server: cards and pages stop showing them. Stored pictures are kept; turn them on again to show them.", flags: MessageFlags.Ephemeral });
        return;
      }
      const wanted = interaction.options.getString("name")?.trim();
      if (!wanted) throw new Error("Pick the character whose picture to remove.");
      const character = selectedCharacter(await prisma.character.findMany({ where: { member: { guildId: context.guildId } }, include: { member: true } }), wanted);
      if (!character) throw new Error(`No linked character called "${wanted}".`);
      const removed = await removePictureByOfficer(prisma, context.guildId, character.id, context.memberId);
      if (removed && interaction.guild) await postToLogChannel(interaction.guild, lang => lang === "fr" ? `${interaction.user.username} a retiré l'image de ${characterName(character)} (${character.member.displayName}).` : `${interaction.user.username} removed the picture of ${characterName(character)} (${character.member.displayName}).`);
      await interaction.reply({ content: removed
        ? `Removed the picture of **${characterName(character)}**. New cards no longer show it; cards already posted keep it. ${character.member.displayName} can pick another one.`
        : `${characterName(character)} has no picture.`, flags: MessageFlags.Ephemeral });
      return;
    }
    if (subcommand === "claimdm") {
      const on = interaction.options.getBoolean("on", true);
      await prisma.guildSettings.upsert({ where: { guildId: context.guildId }, create: { guildId: context.guildId, claimDmEnabled: on }, update: { claimDmEnabled: on } });
      await interaction.reply({ content: on ? "The \"Link these characters?\" DMs are on (members can also turn them off for themselves)." : "The \"Link these characters?\" DMs are off for this server. Members still see the offer in the companion.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (subcommand === "autolink") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const linked = await autoLinkUnclaimed(interaction.guild!, prisma, context.guildId);
      await interaction.editReply({ content: linked.length ? `Linked ${linked.map((row) => `${cleanCharacterName(row.character)} to ${row.member}`).join(", ")}.` : "Nothing matched by name (a Discord nickname must be the character's name, e.g. \"Ray\" or \"[GOLD] Ray\"). Each owner can DM the bot their character's full name (First Last), or type it in the guild-invite channel; /officer character link does it for them." });
      return;
    }
    const wanted = interaction.options.getString("name", true).trim();
    const row = await prisma.unclaimedCharacter.findFirst({ where: { guildId: context.guildId, OR: [{ id: wanted }, { nameKey: wanted.toLowerCase() }] } });
    if (!row) throw new Error(`No unclaimed character called "${wanted}".`);
    const user = interaction.options.getUser("player", true);
    const target = await guildService.ensureMember(context.guildId, user.id, user.username);
    const outcome = await linkUnclaimed(prisma, target.id, row, { confirmed: true });
    await interaction.reply({ content: `Linked **${characterName(row)}** to ${user.username} as ${outcome.isMain ? "their main" : "an alt"}.`, flags: MessageFlags.Ephemeral });
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
  await interaction.reply({ content: `Linked ${characterName(character)} as ${character.isMain ? "your main character" : "an alt"}.`, flags: MessageFlags.Ephemeral });
}
