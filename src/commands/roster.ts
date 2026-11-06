import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, MessageFlags, SlashCommandBuilder,
  type ButtonInteraction, type ChatInputCommandInteraction, type GuildMember
} from "discord.js";
import { prisma } from "../database.js";
import { hasPermission } from "../permissions.js";
import { characterLinkPrompt } from "../services/character-link-prompt.js";
import { formatRosterGaps, inviteLines, loadRosterGaps } from "../services/roster-gaps.js";
import { DEFAULT_NICKNAME_FORMAT, NICKNAME_FORMAT_HELP, botCanRename, restoreAllNicknames, syncNicknames, validNicknameFormat } from "../services/nickname-sync.js";
import { updateWhosWhoBoard } from "../services/whos-who-board.js";
import { asLang } from "../i18n.js";
import { guildService, requireGuildContext } from "./context.js";

// Mounted as /officer roster. Officer-only, every reply private. Nothing here messages anyone on its own:
// the "ask them to link" button is an officer's click, nicknames and the Who's who board are off until switched on.

export const rosterCommand = new SlashCommandBuilder()
  .setName("roster")
  .setDescription("Who is missing, nicknames, Who's who.")
  .addSubcommand((sub) => sub.setName("gaps").setDescription("Discord-only members, unlinked members, unclaimed characters."))
  .addSubcommand((sub) => sub.setName("ignore").setDescription("Leave a role out of the gap lists.")
    .addRoleOption((o) => o.setName("role").setDescription("The role"))
    .addBooleanOption((o) => o.setName("ignore").setDescription("Ignore it (default) or count it again")))
  .addSubcommand((sub) => sub.setName("nicknames").setDescription("Nickname sync: Name (Main). Members can opt out.")
    .addBooleanOption((o) => o.setName("on").setDescription("On or off (off restores nicknames)"))
    .addStringOption((o) => o.setName("format").setDescription("{name} ({full}); {main} = first name").setMaxLength(60))
    .addBooleanOption((o) => o.setName("apply").setDescription("Run now (default: preview)")))
  .addSubcommand((sub) => sub.setName("whoswho").setDescription("One message listing mains and alts.")
    .addBooleanOption((o) => o.setName("on").setDescription("On or off"))
    .addChannelOption((o) => o.setName("channel").setDescription("Channel").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)));

export const ROSTER_BUTTON_PREFIX = "rostergap:";
const LINK_BATCH = 25;

const isOfficer = (member: unknown) => Boolean(member) && hasPermission(member as GuildMember, "officer");

export async function executeRoster(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuildContext(interaction);
  if (!context) return;
  const reply = (content: string, components: ActionRowBuilder<ButtonBuilder>[] = []) =>
    interaction.reply({ content: content.slice(0, 1990), components, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  if (!interaction.member || !isOfficer(interaction.member) || !interaction.guild) { await reply("Only officers can use the roster tools."); return; }
  const guildId = context.guildId;
  const settings = await guildService.getSettings(guildId);
  const lang = asLang(settings?.language);
  const t = (en: string, fr: string) => lang === "fr" ? fr : en;
  const sub = interaction.options.getSubcommand();

  if (sub === "gaps") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const guild = await guildService.ensureGuild(interaction.guild.id, interaction.guild.name);
    const gaps = await loadRosterGaps(prisma, interaction.guild, guildId, guild.gameEdition ?? "forever");
    const { text, invites } = formatRosterGaps(gaps, lang);
    const buttons: ButtonBuilder[] = [];
    if (invites) buttons.push(new ButtonBuilder().setCustomId(`${ROSTER_BUTTON_PREFIX}invites`).setStyle(ButtonStyle.Primary).setLabel(t("Copy all /ginvite lines", "Copier tous les /ginvite")));
    if (gaps.noLink.length) buttons.push(new ButtonBuilder().setCustomId(`${ROSTER_BUTTON_PREFIX}asklink`).setStyle(ButtonStyle.Secondary).setLabel(t("Ask them to link", "Leur demander de lier")));
    await interaction.editReply({ content: text, components: buttons.length ? [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)] : [], allowedMentions: { parse: [] } });
    return;
  }

  if (sub === "ignore") {
    const role = interaction.options.getRole("role");
    const current = settings?.rosterIgnoredRoleIds ?? [];
    if (!role) {
      await reply(current.length ? `${t("Left out of the gap lists", "Exclus des listes")}: ${current.map((id) => `<@&${id}>`).join(", ")}` : t("No role is ignored. Bots are always left out.", "Aucun rôle ignoré. Les bots sont toujours exclus."));
      return;
    }
    const ignore = interaction.options.getBoolean("ignore") !== false;
    const next = ignore ? [...new Set([...current, role.id])].slice(0, 25) : current.filter((id) => id !== role.id);
    await prisma.guildSettings.upsert({ where: { guildId }, create: { guildId, rosterIgnoredRoleIds: next }, update: { rosterIgnoredRoleIds: next } });
    await reply(ignore ? t(`Members with <@&${role.id}> are left out of the gap lists.`, `Les membres avec <@&${role.id}> sont exclus des listes.`) : t(`<@&${role.id}> counts again.`, `<@&${role.id}> compte de nouveau.`));
    return;
  }

  if (sub === "nicknames") {
    const on = interaction.options.getBoolean("on");
    const format = interaction.options.getString("format");
    const apply = interaction.options.getBoolean("apply") === true;
    if (format !== null && !validNicknameFormat(format)) { await reply(t(`The format needs {main} or {full}. ${NICKNAME_FORMAT_HELP}.`, `Le format doit contenir {main} ou {full}. {name} = nom Discord, {main} = prénom du principal, {full} = nom complet du principal.`)); return; }
    if (on !== null || format !== null) {
      const data = { ...(on !== null ? { nicknameSyncEnabled: on } : {}), ...(format !== null ? { nicknameFormat: format } : {}) };
      await prisma.guildSettings.upsert({ where: { guildId }, create: { guildId, ...data }, update: data });
    }
    const enabled = on ?? settings?.nicknameSyncEnabled ?? true;
    if (on === false) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const restored = await restoreAllNicknames(prisma, interaction.guild, guildId);
      await interaction.editReply(t(`Nickname sync is off. ${restored} nickname(s) restored.`, `Synchro des pseudos désactivée. ${restored} pseudo(s) restauré(s).`));
      return;
    }
    if (!enabled) { await reply(t("Nickname sync is **off**. Turn it on with `on:true`. It is on by default; members can opt out with /character nickname.", "La synchro des pseudos est **désactivée**. Active-la avec `on:true`; les membres peuvent s'exclure avec /character nickname.")); return; }
    if (!botCanRename(interaction.guild)) { await reply(t("Saved, but I need the **Manage Nicknames** permission (and my role above the members) to rename anyone.", "Enregistré, mais il me faut la permission **Gérer les pseudos** (et mon rôle au-dessus des membres).")); return; }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await syncNicknames(prisma, interaction.guild, { dryRun: !apply });
    const shown = format ?? settings?.nicknameFormat ?? DEFAULT_NICKNAME_FORMAT;
    const sample = result.changes.slice(0, 8).map((c) => `• <@${c.discordUserId}> → ${c.nickname}`).join("\n");
    await interaction.editReply({
      content: result.skipped ?? `${t("Format", "Format")}: \`${shown}\`\n${apply ? t(`Renamed ${result.applied} member(s), ${result.failed} failed.`, `${result.applied} membre(s) renommé(s), ${result.failed} échec(s).`) : t(`${result.changes.length} change(s) would be made. Add \`apply:true\` to run them now (it also runs every hour).`, `${result.changes.length} changement(s) prévu(s). Ajoute \`apply:true\` pour les faire maintenant (aussi chaque heure).`)}\n${sample}`,
      allowedMentions: { parse: [] }
    });
    return;
  }

  // whoswho
  const on = interaction.options.getBoolean("on");
  const channel = interaction.options.getChannel("channel");
  if (on !== null || channel) {
    const data = { ...(on !== null ? { whosWhoEnabled: on } : {}), ...(channel ? { whosWhoChannelId: channel.id, whosWhoMessageId: null } : {}) };
    await prisma.guildSettings.upsert({ where: { guildId }, create: { guildId, ...data }, update: data });
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const posted = on === false ? false : await updateWhosWhoBoard(interaction.guild);
    await interaction.editReply(on === false ? t("Who's who board is off (the message stays where it is).", "Le tableau Qui est qui est désactivé (le message reste en place).")
      : posted ? t("Who's who board is on and posted.", "Le tableau Qui est qui est actif et publié.") : t("Saved, but I could not post in that channel. Check my permissions there.", "Enregistré, mais je n'ai pas pu publier dans ce salon. Vérifie mes permissions."));
    return;
  }
  const where = settings?.whosWhoChannelId ?? settings?.guideChannelId;
  await reply(settings?.whosWhoEnabled === false ? t("Who's who board is off. Use `on:true`.", "Le tableau Qui est qui est désactivé. Utilise `on:true`.") : where ? t(`Who's who board is on in <#${where}>. Pick another channel with \`channel:\`.`, `Le tableau Qui est qui est actif dans <#${where}>. Choisis un autre salon avec \`channel:\`.`) : t("Who's who board is on but has no channel yet. Use `channel:#…`.", "Le tableau Qui est qui est actif mais sans salon. Utilise `channel:#…`."));
}

/** The buttons under /officer roster gaps. Each click re-checks the clicker's current officer role. */
export async function handleRosterButton(interaction: ButtonInteraction): Promise<void> {
  const action = interaction.customId.slice(ROSTER_BUTTON_PREFIX.length);
  if (!interaction.guild || !isOfficer(interaction.member)) { await interaction.reply({ content: "Only officers can use the roster tools.", flags: MessageFlags.Ephemeral }); return; }
  const guild = await guildService.ensureGuild(interaction.guild.id, interaction.guild.name);
  const settings = await guildService.getSettings(guild.id);
  const lang = asLang(settings?.language);
  const t = (en: string, fr: string) => lang === "fr" ? fr : en;
  const gaps = () => loadRosterGaps(prisma, interaction.guild!, guild.id, guild.gameEdition ?? "forever");

  if (action === "invites") {
    const lines = inviteLines((await gaps()).notInGuild);
    await interaction.reply({ content: lines.length ? `\`\`\`\n${lines.join("\n").slice(0, 1900)}\n\`\`\`` : t("Nobody to invite.", "Personne à inviter."), flags: MessageFlags.Ephemeral });
    return;
  }
  if (action === "asklink") {
    const count = Math.min(LINK_BATCH, (await gaps()).noLink.length);
    await interaction.reply({
      content: t(`This sends the usual link instructions by direct message to ${count} member(s) with no linked character (at most ${LINK_BATCH} per click). Send them?`, `Ceci envoie les instructions habituelles par message privé à ${count} membre(s) sans personnage lié (${LINK_BATCH} au plus par clic). Les envoyer?`),
      components: count ? [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${ROSTER_BUTTON_PREFIX}asklink-go`).setStyle(ButtonStyle.Danger).setLabel(t("Send", "Envoyer")))] : [],
      flags: MessageFlags.Ephemeral
    });
    return;
  }
  if (action === "asklink-go") {
    await interaction.deferUpdate();
    const targets = (await gaps()).noLink.slice(0, LINK_BATCH);
    let sent = 0;
    for (const target of targets) {
      try {
        const member = await guildService.ensureMember(guild.id, target.discordUserId, target.displayName);
        const user = await interaction.client.users.fetch(target.discordUserId);
        await user.send(await characterLinkPrompt(prisma, guild.id, member.id, interaction.guild.id, lang));
        sent++;
      } catch { /* closed DMs: skipped */ }
    }
    await interaction.editReply({ content: t(`Sent to ${sent} of ${targets.length} member(s). Closed direct messages are skipped.`, `Envoyé à ${sent} membre(s) sur ${targets.length}. Les messages privés fermés sont ignorés.`), components: [] });
  }
}
