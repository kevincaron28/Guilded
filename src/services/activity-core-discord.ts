import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, escapeMarkdown, PermissionFlagsBits, type Guild, type GuildMember, type Message, type MessageCreateOptions } from "discord.js";
import type { Prisma, PrismaClient } from "@prisma/client";
import { sessionInclude, teamInclude } from "./activity-core.js";

export const TEAM_BUTTON_PREFIX = "team:";
type Session = Prisma.ActivitySessionGetPayload<{ include: typeof sessionInclude }>;
type Team = Prisma.ActivityCoreGetPayload<{ include: typeof teamInclude }>;
export const teamText = (fr: boolean, en: string, french: string) => fr ? french : en;
const clean = (s: string) => escapeMarkdown(s);
const stamp = (d: Date) => `<t:${Math.floor(d.getTime() / 1000)}:F>`;

export async function teamLanguage(db: Pick<PrismaClient, "guildSettings">, guildId: string) {
  const settings = await db.guildSettings.findUnique({ where: { guildId }, select: { language: true } });
  return settings?.language === "fr";
}

// A command or forged component must never reveal a private team's roster to another audience.
export async function requireTeamChannel(guild: Guild, channelId: string, member?: GuildMember) {
  const channel = await guild.channels.fetch(channelId);
  if (!channel?.isTextBased() || !('send' in channel) || channel.isThread()) throw new Error("Team channel unavailable / Salon du core indisponible.");
  if (member && !channel.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel)) throw new Error("You cannot view this team's channel / Accès au salon refusé.");
  return channel;
}

export function teamRosterEmbed(core: Team, fr: boolean) {
  const t = (en: string, french: string) => teamText(fr, en, french);
  const embed = new EmbedBuilder().setColor(core.kind === "PVP" ? 0xb14565 : 0x4186b8)
    .setTitle(`${core.kind === "PVP" ? "⚔️" : "🗝️"} ${clean(core.name)}`)
    .setDescription([core.goal ? clean(core.goal) : t("A weekly team. Confirm separately for each session.", "Un core hebdomadaire. Confirmez chaque séance séparément."),
      core.archived ? t("Archived", "Archivé") : `${core.weeklySchedule ?? t("Schedule paused", "Horaire en pause")} (${core.timezone})`,
      `${core.durationMinutes} min · ${core.tanks} 🛡️ / ${core.healers} 💚 / ${core.dps} ⚔️`,
      t("Manage: /team member · /team schedule · /team sessions", "Gérer : /team member · /team schedule · /team sessions")].join("\n"));
  for (const [role, label] of [["TANK", "🛡️ Tank"], ["HEALER", t("💚 Healer", "💚 Soigneur")], ["DPS", "⚔️ DPS"]] as const) {
    const names = core.members.filter(m => m.role === role && !m.bench).map(m => `${clean(m.member.displayName)} · ${clean(m.character?.name ?? "?")}`);
    embed.addFields({ name: label, value: names.join("\n").slice(0, 850) || "—", inline: true });
  }
  embed.addFields({ name: t("Substitutes", "Remplaçants"), value: core.members.filter(m => m.bench)
    .map(m => `${clean(m.member.displayName)} · ${clean(m.character?.name ?? "?")} (${m.role})`).join("\n").slice(0, 850) || "—" });
  return embed.setFooter({ text: `Guilded team ${core.id}` });
}

export function teamSessionEmbed(session: Session, fr: boolean) {
  const t = (en: string, french: string) => teamText(fr, en, french);
  const core = session.core;
  const states: Record<string, string> = { PLANNED: t("Planned", "Prévu"), ACTIVE: t("In progress", "En cours"), COMPLETED: t("Completed", "Terminé"), CANCELLED: t("Cancelled", "Annulé") };
  const labels: Record<string, string> = { CONFIRMED: t("Confirmed", "Confirmés"), WAITLISTED: t("Waiting / substitutes", "En attente / remplaçants"), ABSENT: t("Unavailable", "Indisponibles"), TENTATIVE: t("Tentative", "Incertains") };
  const embed = new EmbedBuilder().setColor(core.kind === "PVP" ? 0xb14565 : 0x4186b8)
    .setTitle(`${clean(core.name)} · ${states[session.status]}`)
    .setDescription(`${stamp(session.scheduledAt)} → <t:${Math.floor(session.endsAt.getTime() / 1000)}:t>\n`
      + `${session.openRecruitment ? t("Recruitment open to members who can see this channel.", "Recrutement ouvert aux membres ayant accès au salon.") : t("Team members and substitutes first.", "Membres du core et remplaçants en priorité.")}\n`
      + t("Roster membership is not a confirmation. Regulars have priority; extra players wait.", "Être dans le core ne confirme pas votre présence. Les titulaires sont prioritaires; les autres attendent.")
      + `\n${["TANK", "HEALER", "DPS"].map((role, i) => `${["🛡️", "💚", "⚔️"][i]} ${session.responses.filter(r => r.role === role && r.status === "CONFIRMED").length}/${[core.tanks, core.healers, core.dps][i]}`).join(" · ")}`);
  for (const state of ["CONFIRMED", "WAITLISTED", "TENTATIVE", "ABSENT"]) {
    embed.addFields({ name: labels[state]!, value: session.responses.filter(r => r.status === state)
      .map(r => `${clean(r.member.displayName)} · ${clean(r.character?.name ?? "?")} (${r.role})`).join("\n").slice(0, 800) || "—", inline: true });
  }
  const unanswered = core.members.filter(m => !session.responses.some(r => r.memberId === m.memberId && r.status !== "UNANSWERED")).map(m => clean(m.member.displayName));
  embed.addFields({ name: t("No response", "Sans réponse"), value: unanswered.join(", ").slice(0, 550) || "—" });
  const attendance = session.responses.filter(r => r.attendance).map(r => `${clean(r.member.displayName)}: ${r.attendance}`);
  if (attendance.length) embed.addFields({ name: t("Recorded attendance", "Présences enregistrées"), value: attendance.join("\n").slice(0, 550) });
  if (session.result) embed.addFields({ name: t("Leader's result", "Bilan du responsable"), value: clean(session.result).slice(0, 550) });
  return embed.setFooter({ text: `Guilded session ${session.id}` });
}

export function teamSessionButtons(session: Pick<Session, "id" | "status" | "endsAt">, fr: boolean, now = new Date()) {
  if (session.status !== "PLANNED" || session.endsAt <= now) return [];
  const t = (en: string, french: string) => teamText(fr, en, french);
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${TEAM_BUTTON_PREFIX}${session.id}:TANK`).setLabel(t("Tank", "Tank")).setEmoji("🛡️").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${TEAM_BUTTON_PREFIX}${session.id}:HEALER`).setLabel(t("Healer", "Soigneur")).setEmoji("💚").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${TEAM_BUTTON_PREFIX}${session.id}:DPS`).setLabel("DPS").setEmoji("⚔️").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${TEAM_BUTTON_PREFIX}${session.id}:TENTATIVE`).setLabel(t("Tentative", "Incertain")).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${TEAM_BUTTON_PREFIX}${session.id}:ABSENT`).setLabel(t("Absent", "Absent")).setStyle(ButtonStyle.Danger)
  )];
}

function missingMessage(error: unknown) { return typeof error === "object" && error !== null && "code" in error && error.code === 10008; }
async function recoverMessage(channel: Awaited<ReturnType<typeof requireTeamChannel>>, id: string | null, marker: string): Promise<Message | undefined> {
  if (id) {
    const saved = await channel.messages.fetch(id).catch(error => { if (!missingMessage(error)) throw error; return undefined; });
    if (saved?.author.id === channel.client.user?.id) return saved;
  }
  // Covers an API success followed by a process crash before storing the message id.
  const recent = await channel.messages.fetch({ limit: 100 });
  return recent.find(m => m.author.id === channel.client.user?.id && m.embeds.some(e => e.footer?.text === marker));
}

export async function deliverTeamPost(guild: Guild, db: PrismaClient, guildId: string, kind: string, id: string, now = new Date()) {
  const fr = await teamLanguage(db, guildId);
  if (kind === "TEAM_ROSTER") {
    const core = await db.activityCore.findFirst({ where: { id, guildId }, include: teamInclude });
    if (!core || (core.archived && !core.rosterMessageId)) return;
    const channel = await requireTeamChannel(guild, core.channelId);
    const existing = await recoverMessage(channel, core.rosterMessageId, `Guilded team ${id}`);
    const payload = { embeds: [teamRosterEmbed(core, fr)], allowedMentions: { parse: [] as never[] } };
    const message = existing ? await existing.edit(payload) : await channel.send({ ...payload, nonce: id.slice(-25), enforceNonce: true });
    if (message.id !== core.rosterMessageId) await db.activityCore.update({ where: { id }, data: { rosterMessageId: message.id } });
    return;
  }
  const session = await db.activitySession.findFirst({ where: { id, core: { guildId } }, include: sessionInclude });
  if (!session) return;
  if (kind === "TEAM_REMINDER") {
    if (session.status !== "PLANNED" || session.core.archived || session.scheduledAt <= now) return;
    const channel = await requireTeamChannel(guild, session.core.channelId);
    const marker = `Guilded reminder ${id}`;
    if (await recoverMessage(channel, null, marker)) return;
    const users = [...new Set([...session.core.members.map(m => m.member.discordUserId),
      ...session.responses.filter(r => r.status === "CONFIRMED").map(r => r.member.discordUserId)])]
      .filter(userId => !session.responses.some(r => r.member.discordUserId === userId && r.status === "ABSENT")).slice(0, 40);
    await channel.send({ content: users.map(u => `<@${u}>`).join(" "), embeds: [new EmbedBuilder()
      .setDescription(`${clean(session.core.name)} · ${stamp(session.scheduledAt)}\n${teamText(fr, "Check your session confirmation and lineup.", "Vérifiez votre confirmation et la composition du groupe.")}`)
      .setFooter({ text: marker })], allowedMentions: { parse: [], users }, nonce: `r${id.slice(-24)}`, enforceNonce: true });
    return;
  }
  if (kind !== "TEAM_SESSION") throw new Error("Unknown team delivery.");
  // Never recreate historical/cancelled posts on a delayed retry.
  const live = session.status === "PLANNED" && session.endsAt > now && !session.core.archived;
  if (!session.messageId && !live) return;
  const channel = await requireTeamChannel(guild, session.core.channelId);
  const existing = await recoverMessage(channel, session.messageId, `Guilded session ${id}`);
  if (!existing && !live) return;
  const payload = { embeds: [teamSessionEmbed(session, fr)], components: teamSessionButtons(session, fr, now), allowedMentions: { parse: [] } } satisfies MessageCreateOptions;
  const message = existing ? await existing.edit(payload)
    : await channel.send({ ...payload, nonce: id.slice(-25), enforceNonce: true });
  if (message.id !== session.messageId) await db.activitySession.update({ where: { id }, data: { messageId: message.id } });
}
