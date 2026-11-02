import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, MessageFlags, ModalBuilder, PermissionFlagsBits, SlashCommandBuilder, TextInputBuilder, TextInputStyle,
  type ButtonInteraction, type ChatInputCommandInteraction, type GuildMember, type ModalSubmitInteraction
} from "discord.js";
import { prisma } from "../database.js";
import { hostedPilot } from "../hosted-pilot.js";
import { hasPermission } from "../permissions.js";
import { guildWhere, withGuildScope } from "../services/guild-scope.js";
import { PUG_PREFIX, pugRoleLabel } from "../services/pug-discord.js";
import {
  blockPugGuild, closePugRequest, createPugRequest, decidePugSignup, joinPugBoard, leavePugBoard, mayShowPug, openCounts, PUG_LIMITS, PugError,
  signUpForPug, unblockPugGuild
} from "../services/pug-requests.js";

// /raid pugs: the cross-guild PUG board. Every action is officer-only and checked on the server
// (Discord's own command visibility is not a permission check); sign-up buttons are for anyone.

type Lang = "en" | "fr";
const pt = (lang: Lang, en: string, fr: string) => lang === "fr" ? fr : en;
const allows = (id: string) => hostedPilot.allows(id);

export const pugsCommand = new SlashCommandBuilder().setName("pugs").setDescription("Ask other guilds for PUGs (opt-in board).")
  .addSubcommand(sub => sub.setName("join").setDescription("Officers: join the board (opt-in).")
    .addChannelOption(o => o.setName("channel").setDescription("Board channel (created if empty)").addChannelTypes(ChannelType.GuildText)))
  .addSubcommand(sub => sub.setName("leave").setDescription("Officers: leave the board and clear its posts."))
  .addSubcommand(sub => sub.setName("ask").setDescription("Officers: ask other guilds for PUGs for a raid.")
    .addStringOption(o => o.setName("raid").setDescription("Raid").setAutocomplete(true).setRequired(true))
    .addIntegerOption(o => o.setName("tanks").setDescription("Tanks needed").setMinValue(0).setMaxValue(PUG_LIMITS.maxPerRole))
    .addIntegerOption(o => o.setName("healers").setDescription("Healers needed").setMinValue(0).setMaxValue(PUG_LIMITS.maxPerRole))
    .addIntegerOption(o => o.setName("dps").setDescription("DPS needed").setMinValue(0).setMaxValue(PUG_LIMITS.maxPerRole))
    .addIntegerOption(o => o.setName("hours").setDescription("Keep it up for").addChoices({ name: "6 hours", value: 6 }, { name: "12 hours", value: 12 }, { name: "24 hours", value: 24 }, { name: "48 hours (max)", value: 48 }))
    .addStringOption(o => o.setName("note").setDescription("Short note").setMaxLength(200)))
  .addSubcommand(sub => sub.setName("close").setDescription("Officers: close a raid's PUG request.")
    .addStringOption(o => o.setName("raid").setDescription("Raid").setAutocomplete(true).setRequired(true)))
  .addSubcommand(sub => sub.setName("unblock").setDescription("Officers: unblock a guild by name.")
    .addStringOption(o => o.setName("guild").setDescription("Guild name").setRequired(true).setMaxLength(100)))
  .addSubcommand(sub => sub.setName("status").setDescription("Officers: board status and open requests."));

async function requireOfficer(member: GuildMember, guildId: string): Promise<void> {
  const ok = await withGuildScope(prisma, guildId, async () => hasPermission(member, "officer"));
  if (!ok) throw new PugError("Only officers and server administrators can use the PUG board.");
}

const BOARD_CHANNEL = {
  en: { name: "pug-board", topic: "Other guilds' raids that want PUGs. Opt-in; posts disappear when the raid starts or fills. /raid pugs" },
  fr: { name: "tableau-pug", topic: "Raids d'autres guildes qui cherchent des joueurs externes. Sur inscription; les messages disparaissent au début du raid. /raid pugs" }
};

export async function executePugs(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild || !hostedPilot.allows(interaction.guild.id)) throw new Error("An approved Guilded server is required.");
  const guild = await prisma.guild.findUnique({ where: guildWhere(interaction.guild.id), include: { settings: true } });
  if (!guild?.settings) throw new Error("Run /setup start first.");
  const lang: Lang = guild.settings.language === "fr" ? "fr" : "en";
  await requireOfficer(interaction.member as GuildMember, guild.id);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const sub = interaction.options.getSubcommand();
  if (sub === "join") {
    let channel = interaction.options.getChannel("channel");
    if (!channel) {
      const existing = await prisma.pugBoardGuild.findUnique({ where: { guildId: guild.id } });
      const spec = BOARD_CHANNEL[lang];
      const created = existing ? null : await interaction.guild.channels.create({
        name: spec.name, topic: spec.topic, type: ChannelType.GuildText,
        permissionOverwrites: [
          { id: interaction.guild.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] },
          { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.EmbedLinks] }
        ]
      });
      channel = created ?? await interaction.guild.channels.fetch(existing!.channelId);
    }
    if (!channel) throw new PugError("That channel is unavailable.");
    await joinPugBoard(prisma, guild.id, channel.id, interaction.user.id, allows);
    await interaction.editReply(pt(lang,
      `This guild joined the PUG board: other guilds' requests for your WoW edition appear in <#${channel.id}>, each tagged as another guild's raid. Nothing is shared about your members. Officers can block any guild from its post, and /raid pugs leave undoes this.`,
      `Cette guilde a rejoint le tableau PUG : les demandes d'autres guildes pour votre édition de WoW apparaissent dans <#${channel.id}>, chacune marquée comme raid d'une autre guilde. Rien n'est partagé sur vos membres. Les officiers peuvent bloquer une guilde depuis son message, et /raid pugs leave annule tout.`));
    return;
  }
  if (sub === "leave") {
    const { channelId } = await leavePugBoard(prisma, guild.id, allows);
    await interaction.editReply(channelId ? pt(lang, "Left the PUG board. Your requests are closed and posts are being removed; the channel was kept.", "Tableau PUG quitté. Vos demandes sont fermées et les messages sont retirés; le canal est conservé.") : pt(lang, "This guild had not joined the board.", "Cette guilde n'avait pas rejoint le tableau."));
    return;
  }
  if (sub === "ask") {
    const { posts } = await createPugRequest(prisma, {
      guildId: guild.id, raidId: interaction.options.getString("raid", true), createdBy: interaction.user.id,
      want: { TANK: interaction.options.getInteger("tanks") ?? 0, HEALER: interaction.options.getInteger("healers") ?? 0, DPS: interaction.options.getInteger("dps") ?? 0 },
      hours: interaction.options.getInteger("hours") ?? PUG_LIMITS.maxHours, note: interaction.options.getString("note")
    }, allows);
    await interaction.editReply(pt(lang, `PUG request created. It is being posted to ${posts} guild${posts === 1 ? "" : "s"} playing your edition. You will get one message in the raid channel as sign-ups arrive, and you accept or decline each guest.`,
      `Demande créée. Elle est en cours de publication dans ${posts} guilde${posts === 1 ? "" : "s"} de votre édition. Vous recevrez un message dans le canal du raid à mesure des inscriptions, et vous acceptez ou refusez chaque invité.`));
    return;
  }
  if (sub === "close") {
    const request = await prisma.pugRequest.findFirst({ where: { raidId: interaction.options.getString("raid", true), guildId: guild.id, status: "OPEN" } });
    if (!request) throw new PugError("That raid has no active PUG request.");
    await closePugRequest(prisma, request.id, "officer", allows);
    await interaction.editReply(pt(lang, "PUG request closed; its posts are being removed.", "Demande fermée; les messages sont retirés."));
    return;
  }
  if (sub === "unblock") {
    const name = interaction.options.getString("guild", true).trim().toLowerCase();
    const blocks = await prisma.pugBlock.findMany({ where: { guildId: guild.id } });
    const names = await prisma.guild.findMany({ where: { id: { in: blocks.map(b => b.blockedGuildId) } }, select: { id: true, name: true } });
    const target = names.find(row => row.name.toLowerCase() === name);
    if (!target || !await unblockPugGuild(prisma, guild.id, target.id, allows)) throw new PugError("No blocked guild has that name.");
    await interaction.editReply(pt(lang, "Guild unblocked.", "Guilde débloquée."));
    return;
  }
  const [board, requests] = await Promise.all([
    prisma.pugBoardGuild.findUnique({ where: { guildId: guild.id } }),
    prisma.pugRequest.findMany({ where: { guildId: guild.id, status: "OPEN" }, include: { signups: { select: { role: true, status: true } }, _count: { select: { posts: true } } } })
  ]);
  const blocked = await prisma.pugBlock.count({ where: { guildId: guild.id } });
  await interaction.editReply({ content: [
    board ? pt(lang, `Board: <#${board.channelId}> · blocked guilds: ${blocked}`, `Tableau : <#${board.channelId}> · guildes bloquées : ${blocked}`) : pt(lang, "This guild has not joined the board (/raid pugs join).", "Cette guilde n'a pas rejoint le tableau (/raid pugs join)."),
    ...requests.map(r => { const open = openCounts(r, r.signups); return `• ${r.raidTitle}: 🛡️${open.TANK} 💚${open.HEALER} ⚔️${open.DPS} · ${r.signups.filter(s => s.status === "PENDING").length} ${pt(lang, "waiting", "en attente")} · ${r._count.posts} ${pt(lang, "guilds", "guildes")} · <t:${Math.floor(r.expiresAt.getTime() / 1000)}:R>`; })
  ].join("\n"), allowedMentions: { parse: [] } });
}

/** The officer button for a raid's signup post (mounted by the raid officer row). */
export const pugAskButton = (raidId: string, lang: Lang) =>
  new ButtonBuilder().setCustomId(`${PUG_PREFIX}ask:${raidId}`).setStyle(ButtonStyle.Secondary).setLabel(pt(lang, "Ask for PUGs", "Chercher des PUGs"));

const input = (id: string, label: string, style: TextInputStyle, required: boolean, max: number, value?: string) => {
  const field = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required).setMaxLength(max);
  if (value) field.setValue(value);
  return new ActionRowBuilder<TextInputBuilder>().addComponents(field);
};
const text = (interaction: ModalSubmitInteraction, id: string) => interaction.fields.getTextInputValue(id).trim();
const reply = (interaction: ButtonInteraction | ModalSubmitInteraction, content: string | { content?: string; components?: ActionRowBuilder<ButtonBuilder>[] }) => {
  const body = typeof content === "string" ? { content } : content;
  return interaction.deferred || interaction.replied ? interaction.editReply(body) : interaction.reply({ ...body, flags: MessageFlags.Ephemeral });
};
const languageOf = async (guildId: string): Promise<Lang> => (await prisma.guildSettings.findUnique({ where: { guildId }, select: { language: true } }))?.language === "fr" ? "fr" : "en";

/** Buttons and modals with the `pugb:` prefix. Errors that are PugErrors are shown as-is. */
export async function handlePugComponent(interaction: ButtonInteraction | ModalSubmitInteraction): Promise<void> {
  try {
    await handle(interaction);
  } catch (error) {
    if (!(error instanceof PugError)) throw error;
    await reply(interaction, error.message);
  }
}

async function handle(interaction: ButtonInteraction | ModalSubmitInteraction): Promise<void> {
  if (!interaction.guild || !interaction.guildId || !hostedPilot.allows(interaction.guildId)) throw new PugError("An approved Guilded server is required.");
  const [, action, id = "", extra = ""] = interaction.customId.split(":");
  const member = interaction.member as GuildMember;
  const lang: Lang = interaction.locale.startsWith("fr") ? "fr" : "en";

  if (interaction.isButton() && action === "s") {
    if (!["TANK", "HEALER", "DPS"].includes(extra)) throw new PugError("Choose tank, healer or DPS.");
    await interaction.showModal(new ModalBuilder().setCustomId(`${PUG_PREFIX}m:${id}:${extra}`)
      .setTitle(pt(lang, `Sign up as ${pugRoleLabel(extra, "en")}`, `S'inscrire : ${pugRoleLabel(extra, "fr")}`).slice(0, 45))
      .addComponents(input("character", pt(lang, "Character name", "Nom du personnage"), TextInputStyle.Short, true, 24),
        input("class", pt(lang, "Class (optional)", "Classe (facultatif)"), TextInputStyle.Short, false, 20),
        input("note", pt(lang, "Note (optional)", "Note (facultatif)"), TextInputStyle.Short, false, 120)));
    return;
  }
  if (interaction.isModalSubmit() && action === "m") {
    // Only where the post was shown, and only while this guild may still see the request.
    const post = await prisma.pugPost.findFirst({ where: { requestId: id, channelId: interaction.channelId ?? "", removedAt: null }, include: { request: true } });
    if (!post || !await mayShowPug(prisma, post.request, post.guildId, allows)) throw new PugError("This PUG request is closed.");
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await signUpForPug(prisma, { requestId: id, discordUserId: interaction.user.id, displayName: member.displayName, role: extra, characterName: text(interaction, "character"),
      characterClass: text(interaction, "class"), note: text(interaction, "note"), sourceGuild: interaction.guild.name }, allows);
    await interaction.editReply(pt(lang, "Sent. The host guild's officers will accept or decline; you are not in their roster until they do. Contact them in game.", "Envoyé. Les officiers de la guilde hôte accepteront ou refuseront; vous n'êtes pas dans leur liste avant cela. Contactez-les en jeu."));
    return;
  }
  if (interaction.isButton() && action === "blk") {
    const post = await prisma.pugPost.findFirst({ where: { requestId: id, messageId: interaction.message.id, channelId: interaction.channelId } , include: { request: { select: { guildId: true } } } });
    if (!post) throw new PugError("This post is no longer active.");
    await requireOfficer(member, post.guildId);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await blockPugGuild(prisma, post.guildId, post.request.guildId, allows);
    await interaction.editReply(pt(await languageOf(post.guildId), "Guild blocked: its requests no longer appear here (/raid pugs unblock to undo).", "Guilde bloquée : ses demandes n'apparaissent plus ici (/raid pugs unblock pour annuler)."));
    return;
  }
  if (interaction.isButton() && action === "ask") {
    const raid = await prisma.raid.findUnique({ where: { id }, select: { guildId: true } });
    if (!raid) throw new PugError("Raid not found.");
    await requireOfficer(member, raid.guildId);
    await interaction.showModal(new ModalBuilder().setCustomId(`${PUG_PREFIX}am:${id}`).setTitle(pt(lang, "Ask for PUGs", "Chercher des PUGs"))
      .addComponents(input("tanks", pt(lang, "Tanks needed", "Tanks recherchés"), TextInputStyle.Short, true, 2, "0"),
        input("healers", pt(lang, "Healers needed", "Soigneurs recherchés"), TextInputStyle.Short, true, 2, "0"),
        input("dps", pt(lang, "DPS needed", "DPS recherchés"), TextInputStyle.Short, true, 2, "0"),
        input("hours", pt(lang, "Keep it up for (hours, max 48)", "Durée (heures, max 48)"), TextInputStyle.Short, true, 2, "48"),
        input("note", pt(lang, "Note (optional)", "Note (facultatif)"), TextInputStyle.Short, false, 200)));
    return;
  }
  if (interaction.isModalSubmit() && action === "am") {
    const raid = await prisma.raid.findUnique({ where: { id }, select: { guildId: true } });
    if (!raid) throw new PugError("Raid not found.");
    await requireOfficer(member, raid.guildId);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { posts } = await createPugRequest(prisma, { guildId: raid.guildId, raidId: id, createdBy: interaction.user.id,
      want: { TANK: Number(text(interaction, "tanks")), HEALER: Number(text(interaction, "healers")), DPS: Number(text(interaction, "dps")) },
      hours: Number(text(interaction, "hours")), note: text(interaction, "note") }, allows);
    await interaction.editReply(pt(await languageOf(raid.guildId), `PUG request created and queued for ${posts} guild${posts === 1 ? "" : "s"}.`, `Demande créée et mise en file pour ${posts} guilde${posts === 1 ? "" : "s"}.`));
    return;
  }

  // Everything below acts on the requesting guild's own request, from its own Discord server.
  const request = await prisma.pugRequest.findUnique({ where: { id: action === "ok" || action === "no" ? (await prisma.pugSignup.findUnique({ where: { id }, select: { requestId: true } }))?.requestId ?? "" : id }, include: { guild: { select: { discordId: true } } } });
  if (!request || request.guild.discordId !== interaction.guildId) throw new PugError("This request is not available here.");
  await requireOfficer(member, request.guildId);
  const hostLang = await languageOf(request.guildId);
  if (interaction.isButton() && action === "cl") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await closePugRequest(prisma, request.id, "officer", allows);
    await interaction.editReply(pt(hostLang, "PUG request closed; its posts are being removed.", "Demande fermée; les messages sont retirés."));
    return;
  }
  if (interaction.isButton() && action === "rv") {
    const pending = await prisma.pugSignup.findMany({ where: { requestId: request.id, status: "PENDING" }, orderBy: { createdAt: "asc" }, take: 5 });
    if (!pending.length) { await reply(interaction, pt(hostLang, "No guests are waiting.", "Aucun invité en attente.")); return; }
    await reply(interaction, { content: pending.map((s, index) => `${index + 1}. ${pugRoleLabel(s.role, hostLang)} — **${s.characterName}**${s.characterClass ? ` (${s.characterClass})` : ""} · ${s.displayName}${s.note ? ` — ${s.note}` : ""}`).join("\n"),
      components: pending.map((s, index) => new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${PUG_PREFIX}ok:${s.id}`).setStyle(ButtonStyle.Success).setLabel(`${index + 1} ${pt(hostLang, "Accept", "Accepter")}`),
        new ButtonBuilder().setCustomId(`${PUG_PREFIX}no:${s.id}`).setStyle(ButtonStyle.Danger).setLabel(`${index + 1} ${pt(hostLang, "Decline", "Refuser")}`))) });
    return;
  }
  if (interaction.isButton() && (action === "ok" || action === "no")) {
    await interaction.deferUpdate();
    const result = await decidePugSignup(prisma, id, request.guildId, action === "ok", allows);
    await interaction.editReply({ content: result === "already-decided" ? pt(hostLang, "Already decided.", "Déjà traité.") : result === "accepted" ? pt(hostLang, "Accepted. Invite them in game; they are not added to your roster or server automatically.", "Accepté. Invitez-les en jeu; ils ne sont pas ajoutés automatiquement.") : pt(hostLang, "Declined.", "Refusé."), components: [] });
    return;
  }
  throw new PugError("Unknown PUG action.");
}

