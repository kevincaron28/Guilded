import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, SlashCommandBuilder, PermissionFlagsBits, escapeMarkdown,
  type ButtonInteraction, type ChatInputCommandInteraction, type Guild as DiscordGuild, type GuildMember,
  MessageFlags,
} from "discord.js";
import { prisma } from "../database.js";
import { hasPermission } from "../permissions.js";
import { cleanOptions, createPollService, resultBar } from "../services/poll.js";
import { parseRaidTime } from "../services/raid-time.js";
import { guildService, requireGuildContext } from "./context.js";
import { asLang, tx, type Lang } from "../i18n.js";
import { weeklyQuestionDraft } from "../services/weekly-question.js";
import { actOnWeeklyQuestion, pauseWeeklyQuestion, reviewWeeklyQuestion, saveWeeklyQuestion } from "../services/weekly-question-store.js";
import { withGuildScope } from "../services/guild-scope.js";

const service = createPollService(prisma);
export const POLL_PREFIX = "poll:";
export const WEEKLY_QUESTION_PREFIX = "weeklyq:";

export const pollCommand = new SlashCommandBuilder()
  .setName("poll")
  .setDescription("Polls answered with buttons.")
  .addSubcommand(sub => sub.setName("weekly").setDescription("Review, pause or resume the saved weekly question")
    .setDescriptionLocalizations({ fr: "Revoir, suspendre ou reprendre la question enregistrée" })
    .addStringOption(o => o.setName("action").setDescription("Manual review only; no automatic posts").addChoices({ name: "Preview", value: "preview" }, { name: "Pause", value: "pause" }, { name: "Resume manual review", value: "resume" })))
  .addSubcommand(sub => {
    sub.setName("weekly-preview").setDescription("Officers: save and review a weekly question; no automatic posts")
      .setDescriptionLocalizations({ fr: "Officiers : aperçu privé de question/sondage hebdo; sans envoi" })
      .addStringOption(o => o.setName("question").setDescription("Question for the community").setMinLength(3).setMaxLength(250).setRequired(true))
      .addIntegerOption(o => o.setName("day").setDescription("Day of week").setRequired(true).addChoices(
        { name: "Sunday", value: 0 }, { name: "Monday", value: 1 }, { name: "Tuesday", value: 2 }, { name: "Wednesday", value: 3 },
        { name: "Thursday", value: 4 }, { name: "Friday", value: 5 }, { name: "Saturday", value: 6 }))
      .addStringOption(o => o.setName("time").setDescription("24-hour local time, HH:mm").setRequired(true))
      .addStringOption(o => o.setName("timezone").setDescription("IANA timezone; defaults to the guild timezone"));
    for (const n of [1, 2, 3, 4, 5]) sub.addStringOption(o => o.setName(`option${n}`).setDescription(`Poll option ${n}; omit all for a discussion question`).setMaxLength(80));
    return sub;
  })
  .addSubcommand((sub) => {
    sub.setName("create").setDescription("Officers: post a poll (2 to 5 options).")
      .addStringOption((o) => o.setName("question").setDescription("The question").setMinLength(3).setMaxLength(250).setRequired(true))
      .addStringOption((o) => o.setName("option1").setDescription("First option").setMaxLength(80).setRequired(true))
      .addStringOption((o) => o.setName("option2").setDescription("Second option").setMaxLength(80).setRequired(true));
    for (const n of [3, 4, 5]) sub.addStringOption((o) => o.setName(`option${n}`).setDescription(`Option ${n}`).setMaxLength(80));
    sub.addStringOption((o) => o.setName("closes").setDescription("When it closes by itself, e.g. friday 8pm (default: stays open)"));
    return sub;
  })
  .addSubcommand((sub) => sub.setName("close").setDescription("Officers: close a poll and post the result.")
    .addStringOption((o) => o.setName("poll").setDescription("Poll id (from the post's footer)").setRequired(true)));

async function pollEmbed(pollId: string): Promise<EmbedBuilder> {
  const { poll, counts, total } = await service.results(pollId);
  const lang = asLang((await guildService.getSettings(poll.guildId))?.language);
  const T = (english: string, vars: Record<string, string | number> = {}) => tx(lang, english, vars);
  const expired = !!poll.closesAt && poll.closesAt.getTime() <= Date.now();
  const closed = poll.closed || expired;
  return new EmbedBuilder()
    .setColor(closed ? 0x808080 : 0x5865f2)
    .setTitle(`📊 ${poll.question}`)
    .setDescription(poll.options.map((option, index) => `**${option}**\n${resultBar(counts[index] ?? 0, total)}`).join("\n\n"))
    .addFields(
      { name: T("Votes"), value: String(total), inline: true },
      { name: T("Status"), value: closed ? T("Closed") : poll.closesAt ? T("Open until <t:{time}:f>", { time: Math.floor(poll.closesAt.getTime() / 1000) }) : T("Open"), inline: true }
    )
    .setFooter({ text: T("Poll {id} · one vote each, you can change it", { id: poll.id }) });
}

function pollButtons(pollId: string, options: string[], closed: boolean) {
  if (closed) return [];
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...options.map((option, index) => new ButtonBuilder().setCustomId(`${POLL_PREFIX}${pollId}:${index}`).setLabel(option.slice(0, 80)).setStyle(ButtonStyle.Primary))
  )];
}

async function syncPoll(guild: DiscordGuild, pollId: string): Promise<void> {
  try {
    const poll = await prisma.poll.findUnique({ where: { id: pollId } });
    if (!poll?.channelId || !poll.messageId) return;
    const channel = await guild.channels.fetch(poll.channelId).catch(() => null);
    if (!channel?.isTextBased()) return;
    const message = await channel.messages.fetch(poll.messageId).catch(() => null);
    await message?.edit({ embeds: [await pollEmbed(pollId)], components: pollButtons(pollId, poll.options, poll.closed) });
  } catch (error) {
    console.error("Failed to refresh poll", error);
  }
}

export async function executePoll(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuildContext(interaction);
  if (!context || !interaction.guild) return;
  if (!interaction.member || !hasPermission(interaction.member as GuildMember, "officer")) {
    await interaction.reply({ content: "Only Officers and Guild Masters can create or close polls.", flags: MessageFlags.Ephemeral });
    return;
  }
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "weekly") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const action = interaction.options.getString("action") ?? "preview";
    if (action === "pause" || action === "resume") await pauseWeeklyQuestion(prisma, context.guildId, action === "pause");
    await showWeeklyQuestionReview(interaction, context.guildId);
    return;
  }
  if (subcommand === "weekly-preview") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const settings = await guildService.getSettings(context.guildId);
    const fr = asLang(settings?.language) === "fr";
    const localTime = interaction.options.getString("time", true);
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(localTime)) throw new Error(fr ? "Utilisez le format HH:mm (24 heures)." : "Use HH:mm in 24-hour time.");
    const options = [1, 2, 3, 4, 5].flatMap(n => { const value = interaction.options.getString(`option${n}`); return value === null ? [] : [value]; });
    const channel = interaction.channel;
    const bot = interaction.guild.members.me;
    const memberPermissions = channel && "permissionsFor" in channel ? channel.permissionsFor(interaction.member as GuildMember) : null;
    const botPermissions = channel && "permissionsFor" in channel && bot ? channel.permissionsFor(bot) : null;
    const draft = weeklyQuestionDraft({ question: interaction.options.getString("question", true), options, mode: options.length ? "button-poll" : "question",
      timezone: interaction.options.getString("timezone") ?? settings?.timezone ?? "America/Toronto",
      weekday: interaction.options.getInteger("day", true), minute: Number(localTime.slice(0, 2)) * 60 + Number(localTime.slice(3)), channelId: interaction.channelId },
    { canManagePolls: true, canViewChannel: !!memberPermissions?.has(PermissionFlagsBits.ViewChannel) && !!botPermissions?.has(PermissionFlagsBits.ViewChannel),
      canSendToChannel: !!botPermissions?.has(PermissionFlagsBits.SendMessages) });
    await saveWeeklyQuestion(prisma, context.guildId, interaction.user.id, { question: draft.question, options: draft.options, mode: draft.mode,
      timezone: draft.timezone, weekday: draft.weekday, minute: draft.minute, channelId: draft.channelId });
    await showWeeklyQuestionReview(interaction, context.guildId);
    return;
  }
  if (subcommand === "close") {
    const poll = await service.close(interaction.options.getString("poll", true), context.guildId);
    await syncPoll(interaction.guild, poll.id);
    const { counts, total } = await service.results(poll.id);
    await interaction.reply({
      content: `Closed **${poll.question}** — ${total} vote${total === 1 ? "" : "s"}: ${poll.options.map((option, index) => `${option} ${counts[index] ?? 0}`).join(" · ")}`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }
  const options = cleanOptions([1, 2, 3, 4, 5].map((n) => interaction.options.getString(`option${n}`)));
  const closesText = interaction.options.getString("closes");
  const settings = await guildService.getSettings(context.guildId);
  const closesAt = closesText ? parseRaidTime(closesText, settings?.timezone ?? "America/Toronto") : null;
  const poll = await service.create({ guildId: context.guildId, question: interaction.options.getString("question", true), options, createdBy: interaction.user.id, closesAt });
  const channel = interaction.channel;
  if (!channel?.isTextBased() || !("send" in channel)) throw new Error("I can't post in this channel.");
  const message = await channel.send({ embeds: [await pollEmbed(poll.id)], components: pollButtons(poll.id, poll.options, false) });
  await service.setMessage(poll.id, channel.id, message.id);
  await interaction.reply({ content: `Poll posted. Close it with \`/poll close poll:${poll.id}\`.`, flags: MessageFlags.Ephemeral });
}

async function showWeeklyQuestionReview(interaction: ChatInputCommandInteraction, guildId: string) {
  const { settings, review, plan, occurrence } = await reviewWeeklyQuestion(prisma, guildId, interaction.user.id);
  const fr = asLang((await guildService.getSettings(guildId))?.language) === "fr";
  const days = fr ? ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"] : ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const clock = `${String(Math.floor(settings.minute / 60)).padStart(2, "0")}:${String(settings.minute % 60).padStart(2, "0")}`;
  await interaction.editReply({ allowedMentions: { parse: [] },
    embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(fr ? "Question hebdomadaire · aperçu avant envoi" : "Weekly question · review before posting")
      .setDescription([escapeMarkdown(settings.question), ...settings.options.map((option, index) => `${index + 1}. ${escapeMarkdown(option)}`)].join("\n"))
      .addFields({ name: fr ? "Destination et horaire indicatif" : "Destination and proposed schedule", value: `<#${settings.channelId}> · ${days[settings.weekday]} ${clock} · ${settings.timezone}` },
        { name: fr ? "État" : "Status", value: `${review.weekKey} · ${plan.paused ? fr ? "En pause" : "Paused" : occurrence?.status ?? (fr ? "À valider" : "Ready for review")}` })
      .setFooter({ text: fr ? "Enregistré · Publication manuelle seulement · Aperçu valable 5 min · Aucun point ajouté" : "Saved · Manual posting only · Preview expires in 5 min · No added points" })],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`${WEEKLY_QUESTION_PREFIX}${review.id}:post`).setStyle(ButtonStyle.Primary).setLabel(fr ? "Publier cette semaine maintenant" : "Post this week now").setDisabled(plan.paused || !!occurrence),
      new ButtonBuilder().setCustomId(`${WEEKLY_QUESTION_PREFIX}${review.id}:skip`).setStyle(ButtonStyle.Secondary).setLabel(fr ? "Passer cette semaine" : "Skip this week").setDisabled(plan.paused || !!occurrence),
      new ButtonBuilder().setCustomId(`${WEEKLY_QUESTION_PREFIX}${review.id}:pause`).setStyle(ButtonStyle.Secondary).setLabel(fr ? "Mettre en pause" : "Pause").setDisabled(plan.paused)
    )] });
}

export async function handleWeeklyQuestionButton(interaction: ButtonInteraction) {
  const [reviewId, action] = interaction.customId.slice(WEEKLY_QUESTION_PREFIX.length).split(":");
  if (!interaction.guild || !reviewId || !["post", "skip", "pause"].includes(action ?? "")) return;
  const review = await prisma.weeklyQuestionReview.findFirst({ where: { id: reviewId, actorId: interaction.user.id, guild: { discordId: interaction.guild.id } } });
  if (!review) {
    await interaction.reply({ content: "This review is unavailable / Cet aperçu est indisponible.", flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferUpdate();
  await withGuildScope(prisma, review.guildId, async () => {
    const guild = interaction.guild!;
    const fr = asLang((await guildService.getSettings(review.guildId))?.language) === "fr";
    const result = await actOnWeeklyQuestion(prisma, { reviewId, guildId: review.guildId, actorId: interaction.user.id, action: action as "post" | "skip" | "pause",
      authorize: async channelId => {
        const [member, channel, bot] = await Promise.all([guild.members.fetch(interaction.user.id).catch(() => null), guild.channels.fetch(channelId).catch(() => null), guild.members.fetchMe().catch(() => null)]);
        return !!member && !!bot && hasPermission(member, "officer") && !!channel && !channel.isThread() && "permissionsFor" in channel && "send" in channel
          && !!channel.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel)
          && !!channel.permissionsFor(bot)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]);
      },
      send: async (settings, pollId) => {
        const channel = await guild.channels.fetch(settings.channelId);
        if (!channel?.isTextBased() || !("send" in channel) || channel.isThread()) throw new Error("Channel unavailable");
        const message = await channel.send({ embeds: [pollId ? await pollEmbed(pollId) : new EmbedBuilder().setColor(0x5865f2).setTitle(fr ? "Question de la semaine" : "Question of the week").setDescription(escapeMarkdown(settings.question))],
          components: pollId ? pollButtons(pollId, settings.options, false) : [], allowedMentions: { parse: [] } });
        return message.id;
      }
    });
    const messages: Record<string, [string, string]> = {
      sent: ["Posted. Automatic posting remains off.", "Publié. La publication automatique reste désactivée."],
      skipped: ["Skipped this week.", "Cette semaine est passée."], paused: ["Paused. Use /poll weekly to resume manual review.", "En pause. /poll weekly permet de reprendre la validation manuelle."],
      uncertain: ["Delivery outcome uncertain. Do not retry; check the target channel.", "Résultat incertain. Ne réessayez pas; vérifiez le canal."],
      cancelled: ["Cancelled because access or configuration changed.", "Annulé : accès ou configuration modifiés."],
      "not-authorized": ["Officer permission or channel access is no longer available.", "Autorisation d’officier ou accès au canal indisponible."]
    };
    const text = messages[result] ?? ["This preview expired or the week was already handled. Open /poll weekly again.", "Aperçu expiré ou semaine déjà traitée. Rouvrez /poll weekly."];
    await interaction.editReply({ content: text[fr ? 1 : 0], embeds: [], components: [], allowedMentions: { parse: [] } });
  });
}

export async function handlePollButton(interaction: ButtonInteraction): Promise<void> {
  const [pollId, optionText] = interaction.customId.slice(POLL_PREFIX.length).split(":");
  if (!interaction.guild || !pollId || optionText === undefined) return;
  const guild = await guildService.ensureGuild(interaction.guild.id, interaction.guild.name);
  const member = await guildService.ensureMember(guild.id, interaction.user.id, (interaction.member as GuildMember | null)?.displayName ?? interaction.user.username);
  try {
    const poll = await service.vote(pollId, guild.id, member.id, Number(optionText));
    const lang: Lang = asLang((await guildService.getSettings(guild.id))?.language);
    await interaction.reply({ content: tx(lang, "Your vote for **{option}** is recorded. Click another option to change it.", { option: poll.options[Number(optionText)] ?? "" }), flags: MessageFlags.Ephemeral });
    await syncPoll(interaction.guild, pollId);
  } catch (error) {
    await interaction.reply({ content: error instanceof Error ? error.message : "Could not record your vote.", flags: MessageFlags.Ephemeral }).catch(() => undefined);
  }
}
