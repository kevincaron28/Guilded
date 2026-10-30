import { ChannelType, MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { prisma } from "../database.js";
import { hasPermission } from "../permissions.js";
import { guildService, requireGuildContext } from "./context.js";
import { configureQuestionAutomation, configureRecap, recurringScheduleSchema } from "../services/recurring-delivery.js";
import { automationChannelAccess } from "../services/recurring-discord.js";
import { watchWindow } from "../services/group-watch.js";
import { weeklyQuestionDraftSchema } from "../services/weekly-question.js";

export const automationCommand = new SlashCommandBuilder().setName("automation").setDescription("Optional reminders and recurring delivery")
  .setDescriptionLocalizations({ fr: "Rappels facultatifs et envois récurrents" })
  .addSubcommand(s => s.setName("recap").setDescription("My weekly recap by private DM; off by default")
    .addStringOption(o => o.setName("action").setDescription("On consents to one private DM per week").setRequired(true).addChoices(...["status", "on", "off"].map(value => ({ name: value, value }))))
    .addIntegerOption(o => o.setName("day").setDescription("0 Sunday through 6 Saturday; default Monday").setMinValue(0).setMaxValue(6))
    .addStringOption(o => o.setName("time").setDescription("HH:mm local time; default 09:00"))
    .addStringOption(o => o.setName("timezone").setDescription("IANA timezone; guild default"))
    .addStringOption(o => o.setName("quiet").setDescription("Quiet hours HH:mm-HH:mm; default 22:00-08:00")))
  .addSubcommand(s => s.setName("question").setDescription("Officers: automate the saved weekly question in its reviewed channel")
    .addStringOption(o => o.setName("action").setDescription("On enables the saved question/channel/schedule").setRequired(true).addChoices(...["status", "on", "off"].map(value => ({ name: value, value }))))
    .addStringOption(o => o.setName("quiet").setDescription("Quiet hours HH:mm-HH:mm; default 22:00-08:00")))
  .addSubcommand(s => s.setName("vacancies").setDescription("Officers: deliver matches only for members with active /dungeon watch opt-in")
    .addStringOption(o => o.setName("action").setDescription("Enable, pause or inspect").setRequired(true).addChoices(...["status", "on", "off"].map(value => ({ name: value, value }))))
    .addChannelOption(o => o.setName("channel").setDescription("Only opportunities posted in this existing channel").addChannelTypes(ChannelType.GuildText)));

export async function executeAutomation(i: ChatInputCommandInteraction) {
  if (!i.guild) { await i.reply({ content: "Server only / Serveur seulement.", flags: MessageFlags.Ephemeral }); return; }
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const ctx = await requireGuildContext(i);
  if (!ctx) return;
  const settings = await guildService.getSettings(ctx.guildId);
  const fr = settings?.language === "fr", t = (en: string, french: string) => fr ? french : en;
  const sub = i.options.getSubcommand(), action = i.options.getString("action", true);
  const actor = await i.guild.members.fetch({ user: i.user.id, force: true });
  if (sub !== "recap" && !hasPermission(actor, "officer")) throw new Error("Officer required / Officier requis.");
  let content: string;
  if (sub === "recap") {
    let plan = await prisma.recurringRecap.findUnique({ where: { memberId: ctx.memberId } });
    if (action !== "status") {
      const old = recurringScheduleSchema.safeParse(plan?.settings);
      const clock = i.options.getString("time");
      if (clock && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(clock)) throw new Error("Use HH:mm / Utilisez HH:mm.");
      const quiet = watchWindow(i.options.getString("quiet") ?? (old.success ? `${formatMinute(old.data.quietStart)}-${formatMinute(old.data.quietEnd)}` : "22:00-08:00"));
      plan = await configureRecap(prisma, ctx.guildId, ctx.memberId, {
        timezone: i.options.getString("timezone") ?? (old.success ? old.data.timezone : settings?.timezone ?? "America/Toronto"),
        weekday: i.options.getInteger("day") ?? (old.success ? old.data.weekday : 1),
        minute: clock ? Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3)) : old.success ? old.data.minute : 540,
        quietStart: quiet.start, quietEnd: quiet.end,
      }, action === "on");
    }
    content = t("My private weekly recap", "Mon bilan hebdomadaire privé") + ` · ${plan?.enabled ? "ON" : "OFF"}`;
    if (plan) {
      const schedule = recurringScheduleSchema.parse(plan.settings);
      content += `\n${scheduleText(schedule, fr)}\n${t("Last delivery", "Dernier envoi")}: ${plan.status}${plan.lastAttemptAt ? ` · <t:${Math.floor(plan.lastAttemptAt.getTime() / 1000)}:f>` : ""}`;
    }
    content += "\n" + t("One private DM per week, only to you. Pause: /automation recap action:off. Uncertain deliveries are held, never blindly resent.", "Un MP par semaine, seulement pour vous. Pause : /automation recap action:off. Un envoi incertain n'est jamais renvoyé automatiquement.");
  } else if (sub === "question") {
    let plan = await prisma.weeklyQuestionPlan.findUnique({ where: { guildId: ctx.guildId } });
    if (!plan) throw new Error("Save /poll weekly-preview first / Enregistrez d'abord /poll weekly-preview.");
    if (action === "off") {
      await configureQuestionAutomation(prisma, ctx.guildId, i.user.id, false, { start: 1320, end: 480 });
      await i.editReply({ content: t("Weekly question automation paused.", "Publication automatique de la question suspendue.") });
      return;
    }
    const question = weeklyQuestionDraftSchema.parse(plan.settings);
    if (!await automationChannelAccess(i.guild, i.user.id, question.channelId)) throw new Error("Channel permission unavailable / Accès au salon indisponible.");
    if (action !== "status") plan = await configureQuestionAutomation(prisma, ctx.guildId, i.user.id, action === "on", watchWindow(i.options.getString("quiet") ?? "22:00-08:00"));
    const delivery = await prisma.weeklyQuestionOccurrence.findFirst({ where: { guildId: ctx.guildId }, orderBy: { createdAt: "desc" } });
    const schedule = recurringScheduleSchema.safeParse(plan.automation);
    content = t("Weekly question", "Question hebdomadaire") + ` · ${schedule.success && !plan.paused ? "ON" : "OFF"}\n<#${question.channelId}> · ${question.question}\n`
      + (schedule.success ? scheduleText(schedule.data, fr) + "\n" : "")
      + `${t("Last delivery", "Dernier envoi")}: ${delivery?.status ?? "—"}\n`
      + t("One per week. No mentions or points. Editing the saved question disables automation until you enable it again. Pause: /automation question action:off.", "Une par semaine. Sans mentions ni points. Modifier la question désactive l'automatisation. Pause : /automation question action:off.");
  } else {
    if (action === "on") {
      const channelId = i.options.getChannel("channel")?.id;
      if (!channelId) throw new Error("Choose the destination channel / Choisissez le salon.");
      if (!await automationChannelAccess(i.guild, i.user.id, channelId)) throw new Error("Channel permission unavailable / Accès au salon indisponible.");
      await prisma.guildSettings.update({ where: { guildId: ctx.guildId }, data: { targetedAlertsEnabled: true, targetedAlertsChannelId: channelId, targetedAlertsAutomationApprovedBy: i.user.id } });
    } else if (action === "off") {
      await prisma.guildSettings.update({ where: { guildId: ctx.guildId }, data: { targetedAlertsEnabled: false, targetedAlertsAutomationApprovedBy: null } });
    }
    const current = await prisma.guildSettings.findUniqueOrThrow({ where: { guildId: ctx.guildId } });
    const latest = await prisma.targetedAlertAttempt.findFirst({ where: { guildId: ctx.guildId }, orderBy: { attemptedAt: "desc" } });
    content = t("Group and vacancy matches", "Groupes et places disponibles") + ` · ${current.targetedAlertsEnabled && current.targetedAlertsAutomationApprovedBy ? "ON" : "OFF"}`
      + (current.targetedAlertsChannelId ? `\n<#${current.targetedAlertsChannelId}>` : "") + `\n${t("Last delivery", "Dernier envoi")}: ${latest?.status ?? "—"}\n`
      + t("Checked every 5 minutes. Only active /dungeon watch subscribers; their quiet hours and expiry apply. Maximum 2 notices/day, 6h apart. No DM fallback. Pause: /automation vacancies action:off.", "Vérification toutes les 5 minutes. Seulement les abonnés /dungeon watch actifs; silence et expiration respectés. Maximum 2 avis/jour, espacés de 6 h. Aucun MP. Pause : /automation vacancies action:off.");
  }
  await i.editReply({ content: content.slice(0, 1950), allowedMentions: { parse: [] } });
}

const formatMinute = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
function scheduleText(s: { weekday: number; minute: number; timezone: string; quietStart: number; quietEnd: number }, fr: boolean) {
  const days = fr ? ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"] : ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return `${days[s.weekday]} ${formatMinute(s.minute)} · ${s.timezone} · ${fr ? "Silence" : "Quiet"} ${formatMinute(s.quietStart)}–${formatMinute(s.quietEnd)}`;
}
