import {
  ActionRowBuilder, ChannelType, ModalBuilder, SlashCommandBuilder, TextInputBuilder, TextInputStyle,
  type ChatInputCommandInteraction, type GuildMember, type Message, type ModalSubmitInteraction
} from "discord.js";
import { prisma } from "../database.js";
import { config } from "../config.js";
import { hasPermission } from "../permissions.js";
import {
  activePollAnswer, aiMessages, applicationStatusAnswer, askAi, commandHelpAnswer, createAnswerLimiter, guildFacts,
  looksLikeActivePollQuestion, looksLikeApplicationStatusQuestion, looksLikeBankRequestQuestion,
  looksLikeBotHealthQuestion, looksLikeCommandHelpQuestion, looksLikeCraftRequestQuestion, looksLikeLootRulesQuestion,
  looksLikeMyCharactersQuestion, looksLikeOpenGroupsQuestion, looksLikePersonalStandingQuestion, looksLikeQuestion,
  looksLikeScheduleQuestion, lootRulesAnswer, matchFaq, MAX_ANSWER_LENGTH, myBankRequestAnswer, myCharactersAnswer,
  myCraftRequestAnswer, openGroupsAnswer, parseTriggers, personalStandingAnswer, scheduleAnswer,
  installationAnswer, looksLikeInstallationQuestion, sharedSupportFacts
} from "../services/answers.js";
import { botHealthAnswer } from "../services/bot-messages.js";
import { guideText as craftGuideText } from "./craft-board.js";
import { BRAND } from "../brand.js";
import { guildService, requireGuildContext } from "./context.js";
import { looksLikePoe2Question, poe2Answer, looksLikePairingQuestion, pairingAnswer, looksLikeSyncQuestion, syncAnswer, newDefaultEntries, importedText, listUnanswered, unansweredHeader, recordUnanswered, suggestFaq, suggestionText } from "../services/faq-extras.js";
import { asLang, tx, type Lang } from "../i18n.js";
import { categoryNames } from "../setup-names.js";

// /mod faq (officers): the answer channel and its answers. See services/answers.ts.
export const FAQ_MODAL_PREFIX = "faq:";

export const faqCommand = new SlashCommandBuilder()
  .setName("faq")
  .setDescription("The answer channel: the bot replies there with officer answers (officers).")
  .addSubcommand((sub) => sub.setName("add").setDescription("Write a new answer and the words that trigger it"))
  .addSubcommand((sub) => sub.setName("edit").setDescription("Change an answer")
    .addStringOption((o) => o.setName("entry").setDescription("The answer (start typing a trigger)").setAutocomplete(true).setRequired(true)))
  .addSubcommand((sub) => sub.setName("remove").setDescription("Delete an answer")
    .addStringOption((o) => o.setName("entry").setDescription("The answer (start typing a trigger)").setAutocomplete(true).setRequired(true)))
  .addSubcommand((sub) => sub.setName("list").setDescription("Every answer and how often it was used")
    .addBooleanOption((o) => o.setName("defaults").setDescription("Add the ready-made answers")))
  .addSubcommand((sub) => sub.setName("channel").setDescription("Set the channel the bot answers in (empty: turn off)")
    .addChannelOption((o) => o.setName("channel").setDescription("Text channel").addChannelTypes(ChannelType.GuildText)))
  .addSubcommand((sub) => sub.setName("ai").setDescription("AI answers when no officer answer matches (needs a free AI key on the server)")
    .addBooleanOption((o) => o.setName("on").setDescription("On or off").setRequired(true)))
  .addSubcommand((sub) => sub.setName("test").setDescription("Which answer a question would get")
    .addStringOption((o) => o.setName("question").setDescription("A question as a member would write it").setMaxLength(300).setRequired(true)));

function faqModal(lang: Lang, entry?: { id: string; triggers: string[]; answer: string }) {
  const T = (english: string) => tx(lang, english);
  return new ModalBuilder()
    .setCustomId(`${FAQ_MODAL_PREFIX}${entry ? `edit:${entry.id}` : "add"}`)
    .setTitle(entry ? T("Change an answer") : T("New answer"))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder()
        .setCustomId("triggers").setLabel(T("Trigger words (one per line)"))
        .setPlaceholder(T("raid time\nwhen raid\nquand raid"))
        .setStyle(TextInputStyle.Paragraph).setMaxLength(400).setRequired(true)
        .setValue(entry ? entry.triggers.join("\n") : "")),
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder()
        .setCustomId("answer").setLabel(T("The answer"))
        .setPlaceholder(T("We raid Tuesday and Thursday at 8 pm (server time)."))
        .setStyle(TextInputStyle.Paragraph).setMaxLength(MAX_ANSWER_LENGTH).setRequired(true)
        .setValue(entry?.answer ?? ""))
    );
}

function requireOfficer(interaction: ChatInputCommandInteraction | ModalSubmitInteraction): void {
  if (!interaction.member || !hasPermission(interaction.member as GuildMember, "officer")) throw new Error("Only officers can change the answers.");
}

async function findEntry(guildId: string, value: string) {
  const entry = await prisma.faqEntry.findFirst({ where: { guildId, id: value } });
  if (!entry) throw new Error("Pick the answer from the list.");
  return entry;
}

export async function executeFaq(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuildContext(interaction);
  if (!context || !interaction.guild) return;
  const { guildId } = context;
  const settings = await guildService.getSettings(guildId);
  const lang = asLang(settings?.language);
  const T = (english: string, vars: Record<string, string | number> = {}) => tx(lang, english, vars);
  const sub = interaction.options.getSubcommand();
  requireOfficer(interaction);

  if (sub === "add") { await interaction.showModal(faqModal(lang)); return; }
  if (sub === "edit") { await interaction.showModal(faqModal(lang, await findEntry(guildId, interaction.options.getString("entry", true)))); return; }
  if (sub === "remove") {
    const entry = await findEntry(guildId, interaction.options.getString("entry", true));
    await prisma.faqEntry.delete({ where: { id: entry.id } });
    await interaction.reply({ content: T("Deleted the answer for: {triggers}", { triggers: entry.triggers.join(", ") }), ephemeral: true });
    return;
  }
  if (sub === "list") {
    let importedNote = "";
    if (interaction.options.getBoolean("defaults")) {
      const existing = await prisma.faqEntry.findMany({ where: { guildId }, select: { triggers: true } });
      const fresh = newDefaultEntries(existing, lang);
      if (fresh.length) await prisma.faqEntry.createMany({ data: fresh.map((e) => ({ guildId, triggers: e.triggers, answer: e.answer, createdBy: interaction.user.id })) });
      importedNote = importedText(fresh.length, lang);
    }
    const entries = await prisma.faqEntry.findMany({ where: { guildId }, orderBy: { uses: "desc" } });
    const where = settings?.answerChannelId ? T("Answer channel: <#{id}>.", { id: settings.answerChannelId }) : T("No answer channel yet: /mod faq channel.");
    const lines = entries.map((entry) => `• **${entry.triggers.join(" / ")}** (${entry.uses}×): ${entry.answer.replace(/\s+/g, " ").slice(0, 90)}`);
    const open = listUnanswered(guildId);
    const tail = open.length ? ["", unansweredHeader(lang), ...open.map((q) => `• ${q}`)] : [];
    await interaction.reply({ content: [...(importedNote ? [importedNote] : []), where, ...(lines.length ? lines : [T("No answers yet: /mod faq add.")]), ...tail].join("\n").slice(0, 1900), ephemeral: true });
    return;
  }
  if (sub === "channel") {
    const channel = interaction.options.getChannel("channel");
    await guildService.updateSettings(guildId, { answerChannelId: channel?.id ?? null });
    forgetAnswerSettings(interaction.guild.id);
    const warning = config.MESSAGE_CONTENT_INTENT ? "" : " " + T("Note: the bot cannot read messages yet. The server admin must turn on \"Message Content Intent\" in the Discord Developer Portal and set MESSAGE_CONTENT_INTENT=true.");
    await interaction.reply({ content: (channel ? T("I answer questions in <#{id}> now.", { id: channel.id }) : T("The answer channel is off.")) + warning, ephemeral: true });
    return;
  }
  if (sub === "ai") {
    const on = interaction.options.getBoolean("on", true);
    await guildService.updateSettings(guildId, { aiAnswers: on });
    forgetAnswerSettings(interaction.guild.id);
    const ready = !!(config.AI_BASE_URL && config.AI_MODEL);
    await interaction.reply({
      content: on
        ? (ready ? T("AI answers are on (up to {limit} a day) when no officer answer matches.", { limit: config.AI_DAILY_LIMIT }) : T("AI answers are on, but no AI service is set on the server yet (AI_BASE_URL and AI_MODEL). Until then only officer answers are used."))
        : T("AI answers are off: only officer answers are used."),
      ephemeral: true
    });
    return;
  }
  if (sub === "test") {
    const entries = await prisma.faqEntry.findMany({ where: { guildId } });
    const match = matchFaq(entries, interaction.options.getString("question", true));
    await interaction.reply({
      content: match
        ? T("Matched **{triggers}**:\n{answer}", { triggers: match.triggers.join(" / "), answer: match.answer })
        : settings?.aiAnswers && config.AI_BASE_URL ? T("No officer answer matches: the AI would answer.") : T("No answer matches: the bot stays quiet."),
      ephemeral: true
    });
  }
}

// The add / edit form.
export async function handleFaqModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.guild) return;
  requireOfficer(interaction);
  const record = await guildService.ensureGuild(interaction.guild.id, interaction.guild.name);
  const lang = asLang((await guildService.getSettings(record.id))?.language);
  const T = (english: string, vars: Record<string, string | number> = {}) => tx(lang, english, vars);
  const triggers = parseTriggers(interaction.fields.getTextInputValue("triggers"));
  const answer = interaction.fields.getTextInputValue("answer").trim().slice(0, MAX_ANSWER_LENGTH);
  if (triggers.length === 0 || !answer) throw new Error(T("Write at least one trigger (2 letters or more) and an answer."));
  const id = interaction.customId.slice(FAQ_MODAL_PREFIX.length);
  if (id.startsWith("edit:")) {
    const entry = await findEntry(record.id, id.slice("edit:".length));
    await prisma.faqEntry.update({ where: { id: entry.id }, data: { triggers, answer } });
  } else {
    await prisma.faqEntry.create({ data: { guildId: record.id, triggers, answer, createdBy: interaction.user.id } });
  }
  await interaction.reply({ content: T("Saved. It answers messages containing: {triggers}", { triggers: triggers.join(", ") }), ephemeral: true });
}

// Autocomplete for the entry option: triggers containing what was typed.
export async function faqChoices(guildId: string, query: string): Promise<{ name: string; value: string }[]> {
  const entries = await prisma.faqEntry.findMany({ where: { guildId }, orderBy: { uses: "desc" }, take: 100 });
  const q = query.toLowerCase();
  return entries.filter((entry) => !q || entry.triggers.some((trigger) => trigger.includes(q)) || entry.answer.toLowerCase().includes(q))
    .slice(0, 25).map((entry) => ({ name: `${entry.triggers.join(" / ")}: ${entry.answer}`.replace(/\s+/g, " ").slice(0, 100), value: entry.id }));
}

// ---------------------------------------------------------------------------------------------
// The listener: a message in a guild's answer channel gets the matching officer answer, or (when
// switched on and set up) an AI answer to a question. Everything else is ignored quietly.

const limiter = createAnswerLimiter();
// Discord guild id -> its answer channel, re-read at most once a minute, so ordinary chat in
// other channels never touches the database.
const channelCache = new Map<string, { guildId: string; channelId: string | null; ai: boolean; timeZone: string; at: number }>();
const CACHE_MS = 60_000;

async function answerSettings(discordGuildId: string, name: string) {
  const cached = channelCache.get(discordGuildId);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached;
  const record = await guildService.ensureGuild(discordGuildId, name);
  const settings = await guildService.getSettings(record.id);
  const fresh = { guildId: record.id, channelId: settings?.answerChannelId ?? null, ai: settings?.aiAnswers ?? false, timeZone: settings?.timezone ?? "America/Toronto", at: Date.now() };
  channelCache.set(discordGuildId, fresh);
  return fresh;
}

// A question worth an AI answer: it asks something (a "?") or names the bot.
export async function answerMessage(message: Message, productReference: string): Promise<void> {
  if (message.author.bot || message.system || !message.inGuild()) return;
  const text = message.content.trim();
  if (text.length < 3) return;
  const where = await answerSettings(message.guild.id, message.guild.name);
  if (!where.channelId || message.channelId !== where.channelId) return;
  const userKey = `${where.guildId}:${message.author.id}`;
  const entries = await prisma.faqEntry.findMany({ where: { guildId: where.guildId } });
  const match = matchFaq(entries, text);
  const reply = (content: string) => message.reply({ content, allowedMentions: { parse: [], repliedUser: true }, failIfNotExists: false });
  if (match) {
    if (!limiter.allowUser(userKey)) return;
    await reply(match.answer);
    await prisma.faqEntry.update({ where: { id: match.id }, data: { uses: { increment: 1 } } });
    return;
  }
  // Everything below is free and deterministic (no AI needed): one settings row and, only if a
  // personal question actually comes up, one member lookup, shared across every check.
  const settings = await guildService.getSettings(where.guildId);
  const lang = asLang(settings?.language);
  // Guilded is shared product support, not a way around another section's
  // channel permissions. Resolve a missing parent before selecting facts.
  const parent = message.channel.type === ChannelType.GuildText
    ? message.channel.parent ?? (message.channel.parentId ? await message.guild.channels.fetch(message.channel.parentId).catch(() => null) : null)
    : null;
  const sharedSupport = parent === null || categoryNames("guild").includes(parent.name);
  let member: { id: string } | null | undefined;
  const getMember = async () => {
    if (member === undefined) member = await prisma.member.findFirst({ where: { guildId: where.guildId, discordUserId: message.author.id }, select: { id: true } });
    return member;
  };
  let officerAsker: boolean | undefined;
  const isOfficerAsker = async () => {
    if (officerAsker === undefined) {
      const discordMember = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
      officerAsker = discordMember ? hasPermission(discordMember, "officer") : false;
    }
    return officerAsker;
  };
  const tryAnswer = async (answer: string | null) => {
    if (answer === null || !limiter.allowUser(userKey)) return false;
    await reply(answer);
    return true;
  };
  if (looksLikeInstallationQuestion(text) && await tryAnswer(installationAnswer(lang))) return;
  if (looksLikeCommandHelpQuestion(text) && await tryAnswer(commandHelpAnswer(await isOfficerAsker(), lang))) return;
  if (looksLikePoe2Question(text) && await tryAnswer(poe2Answer(lang))) return;
  if (looksLikePairingQuestion(text) && await tryAnswer(pairingAnswer(lang))) return;
  if (looksLikeSyncQuestion(text) && await tryAnswer(syncAnswer(lang))) return;
  if (!sharedSupport) {
    // Raid-timing questions ("raid night?") get a free, deterministic answer straight from the
    // database (core schedules and next planned raids).
    if (looksLikeScheduleQuestion(text) && await tryAnswer(await scheduleAnswer(prisma, where.guildId, where.timeZone, lang))) return;
    if (looksLikeLootRulesQuestion(text) && await tryAnswer(lootRulesAnswer(settings, lang))) return;
    if (looksLikeOpenGroupsQuestion(text) && await tryAnswer(await openGroupsAnswer(prisma, where.guildId, lang))) return;
    if (looksLikeActivePollQuestion(text) && await tryAnswer(await activePollAnswer(prisma, where.guildId, lang))) return;
    if (looksLikePersonalStandingQuestion(text)) {
      const asker = await getMember();
      if (asker && await tryAnswer(await personalStandingAnswer(prisma, asker.id, settings?.baseGp ?? 0, lang))) return;
    }
    if (looksLikeMyCharactersQuestion(text)) {
      const asker = await getMember();
      if (asker && await tryAnswer(await myCharactersAnswer(prisma, asker.id, lang))) return;
    }
    if (looksLikeApplicationStatusQuestion(text)) {
      const asker = await getMember();
      if (asker && await tryAnswer(await applicationStatusAnswer(prisma, asker.id, lang))) return;
    }
    if (looksLikeBankRequestQuestion(text)) {
      const asker = await getMember();
      if (asker && await tryAnswer(await myBankRequestAnswer(prisma, asker.id, lang))) return;
    }
    if (looksLikeCraftRequestQuestion(text)) {
      const asker = await getMember();
      if (asker && await tryAnswer(await myCraftRequestAnswer(prisma, asker.id, lang))) return;
    }
    // "Is the bot outdated?" is diagnostic content, so it's officer-only; a non-officer asking falls
    // through silently to AI, same as every other check above when it doesn't apply.
    if (looksLikeBotHealthQuestion(text) && settings && await isOfficerAsker()) {
      if (await tryAnswer(await botHealthAnswer(message.guild, prisma, settings, lang, craftGuideText(lang)))) return;
    }
  }
  if (!where.ai || !config.AI_BASE_URL || !config.AI_MODEL) {
    if (looksLikeQuestion(text, message.mentions.users.has(message.client.user.id))) {
      const near = suggestFaq(entries, text);
      if (near && limiter.allowUser(userKey)) await reply(suggestionText(near.triggers, lang));
      else if (!near) recordUnanswered(where.guildId, text.slice(0, 120));
    }
    return;
  }
  const botId = message.client.user.id;
  if (!looksLikeQuestion(text, message.mentions.users.has(botId))) return;
  if (!limiter.canAnswerUser(userKey) || !limiter.canUseAi(where.guildId, config.AI_DAILY_LIMIT)) return;
  try {
    await message.channel.sendTyping();
  } catch (error) {
    console.warn("Could not send typing indicator for answer channel", error);
  }
  const asker = sharedSupport ? null : await getMember();
  const facts = sharedSupport ? sharedSupportFacts(message.guild.name, entries)
    : await guildFacts(prisma, where.guildId, asker?.id ?? null, where.timeZone);
  const question = text.replace(new RegExp(`<@!?${botId}>`, "g"), "").trim();
  const result = await askAi(
    { baseUrl: config.AI_BASE_URL, model: config.AI_MODEL, apiKey: config.AI_API_KEY },
    aiMessages(facts, question, BRAND.name, productReference)
  );
  if (result.answer !== null) {
    await reply(result.answer);
    limiter.recordUserAnswer(userKey);
    limiter.recordAiAnswer(where.guildId);
    return;
  }
  console.error("Answer channel AI request failed", { guildId: where.guildId, failure: result.failure });
  await reply(tx(lang, "Sorry, I couldn't get an AI answer right now. Please try again later or ask an officer."));
}

// /mod faq channel and ai change what the listener reads: forget the cached copy.
export function forgetAnswerSettings(discordGuildId: string): void {
  channelCache.delete(discordGuildId);
}

