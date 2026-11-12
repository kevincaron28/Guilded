import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, SlashCommandBuilder,
  type ButtonInteraction, type ChatInputCommandInteraction, type Guild as DiscordGuild, type GuildMember
} from "discord.js";
import { prisma } from "../database.js";
import { hostedPilot } from "../hosted-pilot.js";
import { hasPermission } from "../permissions.js";
import { asLang, t, type Lang } from "../i18n.js";
import { LIFETIME_MAX_REMINDERS, PAGE_SIZE, listNoGame, queueManualReminders, remindAllBlockedUntil, type NoGameRow, type QueueResult } from "../services/game-reminder.js";
import { officerAccess } from "./officer-tools.js";
import { guildService } from "./context.js";

// /report games: members who joined the server but have not picked a game, and the private reminder to them.
// Officers and Guild Masters only. Nothing is sent unless an officer asks (one member, one page, everyone
// listed) or the server switched the automatic reminder on (`auto`, off by default).

export const GAME_REMINDER_PREFIX = "gamerem:";

export const gameRemindersCommand = new SlashCommandBuilder()
  .setName("games")
  .setDescription("Members who have not picked a game: see them, send a reminder.")
  .addSubcommand((sub) => sub.setName("list").setDescription("Members with no game role yet (paged).")
    .addIntegerOption((o) => o.setName("page").setDescription("Page number").setMinValue(1)))
  .addSubcommand((sub) => sub.setName("remind").setDescription("Send one member a private reminder to pick a game.")
    .addUserOption((o) => o.setName("member").setDescription("The member").setRequired(true)))
  .addSubcommand((sub) => sub.setName("auto").setDescription("Automatic reminder: a day after joining, once more a week later.")
    .addBooleanOption((o) => o.setName("enabled").setDescription("On or off (empty: show)")));

const button = (id: string, label: string, style = ButtonStyle.Secondary, disabled = false) =>
  new ButtonBuilder().setCustomId(id).setLabel(label.slice(0, 80)).setStyle(style).setDisabled(disabled);
const row = (...buttons: ButtonBuilder[]) => new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
const ts = (date: Date) => `<t:${Math.floor(date.getTime() / 1000)}:R>`;

function reminderState(lang: Lang, r: NoGameRow): string {
  if (r.stopped) return t(lang, "gamerem.state.stopped");
  if (r.dmClosed) return t(lang, "gamerem.state.closed");
  if (r.lastSentAt) return t(lang, "gamerem.state.sent", { n: r.reminders, when: ts(r.lastSentAt) });
  return r.reminders > 0 ? t(lang, "gamerem.state.queued") : t(lang, "gamerem.state.none");
}

export function renderList(lang: Lang, rows: NoGameRow[], page: number): { content: string; pages: number; page: number; slice: NoGameRow[] } {
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(Math.max(page, 1), pages);
  const slice = rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const lines = slice.map((r) => {
    const rules = r.rulesAccepted === null ? "" : ` · ${t(lang, "gamerem.rules")} ${r.rulesAccepted ? "✅" : "⬜"}`;
    return `• <@${r.id}> · ${r.joinedAt ? t(lang, "gamerem.joined", { when: ts(r.joinedAt) }) : t(lang, "gamerem.joinedUnknown")}${rules} · ${reminderState(lang, r)}`;
  });
  const head = t(lang, "gamerem.title", { count: rows.length, page: current, pages });
  return { content: `${head}\n${lines.join("\n")}`.slice(0, 1990), pages, page: current, slice };
}

function listButtons(lang: Lang, rows: NoGameRow[], page: number, pages: number) {
  return [row(
    button(`${GAME_REMINDER_PREFIX}page:${page - 1}`, "◀", ButtonStyle.Secondary, page <= 1),
    button(`${GAME_REMINDER_PREFIX}page:${page + 1}`, "▶", ButtonStyle.Secondary, page >= pages),
    button(`${GAME_REMINDER_PREFIX}these:${page}`, t(lang, "gamerem.button.these"), ButtonStyle.Primary, rows.length === 0),
    button(`${GAME_REMINDER_PREFIX}all`, t(lang, "gamerem.button.all", { count: rows.length }), ButtonStyle.Danger, rows.length === 0)
  )];
}

function resultText(lang: Lang, r: QueueResult): string {
  const lines = [t(lang, "gamerem.result.queued", { count: r.queued })];
  if (r.stopped) lines.push(t(lang, "gamerem.result.stopped", { count: r.stopped }));
  if (r.dmClosed) lines.push(t(lang, "gamerem.result.closed", { count: r.dmClosed }));
  if (r.capped) lines.push(t(lang, "gamerem.result.capped", { count: r.capped, max: LIFETIME_MAX_REMINDERS }));
  if (r.recent) lines.push(t(lang, "gamerem.result.recent", { count: r.recent }));
  if (r.gone) lines.push(t(lang, "gamerem.result.gone", { count: r.gone }));
  return lines.join("\n");
}

async function context(guild: DiscordGuild) {
  const record = await guildService.ensureGuild(guild.id, guild.name);
  const settings = await guildService.getSettings(record.id);
  return { guildId: record.id, settings, lang: asLang(settings?.language) };
}

const DENIED = "Only Officers and Guild Masters can use this. / Réservé aux officiers et au maître de guilde.";

export async function executeGameReminders(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild || !interaction.member || !hasPermission(interaction.member as GuildMember, "officer")) {
    await interaction.reply({ content: DENIED, flags: MessageFlags.Ephemeral });
    return;
  }
  if (!hostedPilot.allows(guild.id)) { await interaction.reply({ content: DENIED, flags: MessageFlags.Ephemeral }); return; }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const { guildId, settings, lang } = await context(guild);
  if (!settings) { await interaction.editReply({ content: t(lang, "gamerem.notConfigured") }); return; }
  const sub = interaction.options.getSubcommand();

  if (sub === "auto") {
    const enabled = interaction.options.getBoolean("enabled");
    if (enabled !== null) await guildService.updateSettings(guildId, { gameReminderAuto: enabled });
    const on = enabled ?? settings.gameReminderAuto;
    await interaction.editReply({ content: t(lang, on ? "gamerem.auto.on" : "gamerem.auto.off") });
    return;
  }

  if (sub === "remind") {
    const user = interaction.options.getUser("member", true);
    const result = await queueManualReminders(prisma, guildId, guild, settings, [user.id]);
    await interaction.editReply({ content: resultText(lang, result), allowedMentions: { parse: [] } });
    return;
  }

  const listed = await listNoGame(prisma, guildId, guild, settings);
  if (!listed) { await interaction.editReply({ content: t(lang, "gamerem.unreadable") }); return; }
  if (!listed.configured) { await interaction.editReply({ content: t(lang, "gamerem.notConfigured") }); return; }
  const view = renderList(lang, listed.rows, interaction.options.getInteger("page") ?? 1);
  await interaction.editReply({
    content: listed.rows.length ? view.content : t(lang, "gamerem.empty"),
    components: listButtons(lang, listed.rows, view.page, view.pages), allowedMentions: { parse: [] }
  });
}

// Buttons under the list (paging, "these", "all" with a confirmation). Every click re-checks the clicker's
// current roles and re-reads the live list, so a stale message never messages someone who has since picked.
export async function handleGameReminderButton(interaction: ButtonInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild || !officerAccess(interaction) || !hostedPilot.allows(guild.id)) {
    await interaction.reply({ content: DENIED, flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferUpdate();
  const [action, arg] = interaction.customId.slice(GAME_REMINDER_PREFIX.length).split(":");
  const { guildId, settings, lang } = await context(guild);
  if (!settings) return;
  const listed = await listNoGame(prisma, guildId, guild, settings);
  if (!listed) { await interaction.editReply({ content: t(lang, "gamerem.unreadable"), components: [] }); return; }

  if (action === "page") {
    const view = renderList(lang, listed.rows, Number(arg) || 1);
    await interaction.editReply({ content: listed.rows.length ? view.content : t(lang, "gamerem.empty"), components: listButtons(lang, listed.rows, view.page, view.pages), allowedMentions: { parse: [] } });
    return;
  }
  if (action === "all") {
    await interaction.editReply({
      content: t(lang, "gamerem.confirm", { count: listed.rows.length }),
      components: [row(button(`${GAME_REMINDER_PREFIX}allgo`, t(lang, "gamerem.button.confirm", { count: listed.rows.length }), ButtonStyle.Danger),
        button(`${GAME_REMINDER_PREFIX}page:1`, t(lang, "gamerem.button.cancel")))],
      allowedMentions: { parse: [] }
    });
    return;
  }
  if (action === "allgo") {
    // "Remind all" is limited to once a week per server; paging and "this page" stay available.
    const until = remindAllBlockedUntil(settings.gameRemindAllAt, new Date());
    if (until) {
      await interaction.editReply({ content: t(lang, "gamerem.cooldown", { when: ts(until) }), components: [], allowedMentions: { parse: [] } });
      return;
    }
    await guildService.updateSettings(guildId, { gameRemindAllAt: new Date() });
  }
  if (action === "these" || action === "allgo") {
    const ids = action === "these" ? renderList(lang, listed.rows, Number(arg) || 1).slice.map((r) => r.id) : listed.rows.map((r) => r.id);
    const result = await queueManualReminders(prisma, guildId, guild, settings, ids);
    await interaction.editReply({ content: resultText(lang, result), components: [], allowedMentions: { parse: [] } });
  }
}
