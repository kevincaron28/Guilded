import type { Client } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { asLang, type Lang } from "../i18n.js";
import { CLEANUP_DELAY_MS, nameKeyOf } from "./invite-queue.js";

// 8.5 light recruiting kit, on top of the invite queue: a stage and an officer note on each recruit record, interview
// questions per server, and a recruiting post template with one shared cooldown. Written from scratch; nothing automatic
// beyond one reminder when the cooldown is over.

export const STAGES = ["PENDING", "INVITED", "JOINED", "PROMOTED", "DECLINED"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABEL: Record<Stage, string> = { PENDING: "asked", INVITED: "invited", JOINED: "joined", PROMOTED: "promoted", DECLINED: "declined" };
export const MAX_QUESTIONS = 5;
export const MAX_ANSWERS_LENGTH = 1000;

/** Questions typed as "one | two | three" (or one per line): trimmed, at most five of 150 characters. */
export function parseQuestions(text: string | null | undefined): string[] {
  return (text ?? "").split(/[|\n]/).map((line) => line.trim().replace(/\s+/g, " ")).filter(Boolean).slice(0, MAX_QUESTIONS).map((q) => q.slice(0, 150));
}

export function storedQuestions(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((q): q is string => typeof q === "string" && q.trim() !== "").slice(0, MAX_QUESTIONS) : [];
}

/** Everything after the name line of a post: the applicant's answers. */
export function parseInviteAnswers(content: string | null | undefined): string | null {
  const lines = (content ?? "").split(/\r?\n/);
  const first = lines.findIndex((line) => line.trim());
  const rest = lines.slice(first + 1).map((line) => line.trim()).filter(Boolean).join("\n");
  return rest ? rest.slice(0, MAX_ANSWERS_LENGTH) : null;
}

export function questionsBlock(lang: Lang, questions: readonly string[]): string {
  if (!questions.length) return "";
  const intro = lang === "fr" ? "Sous ton nom, réponds à ces questions (une réponse par ligne) :" : "Under your name, answer these questions (one answer per line):";
  return `${intro}\n${questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}`;
}

export function guideText(lang: Lang, questions: readonly string[]): string {
  const how = lang === "fr"
    ? "**Comment joindre la guilde** : écris ici le nom complet de ton personnage (prénom et nom) sur la première ligne. Un officier t’invitera en jeu et le bot ajoutera un ✅."
    : "**How to join the guild**: write your full character name (first and last name) on the first line. An officer will invite you in game and the bot adds a ✅.";
  return [how, questionsBlock(lang, questions)].filter(Boolean).join("\n\n");
}

/** Keeps the pinned guide message in the invite channel current; returns its ID (null when it could not be posted). */
export async function ensureInviteGuide(client: Pick<Client, "channels">, database: Pick<PrismaClient, "guildSettings">, guildId: string): Promise<string | null> {
  const settings = await database.guildSettings.findUnique({ where: { guildId }, select: { inviteChannelId: true, inviteGuideMessageId: true, inviteQuestions: true, language: true } });
  if (!settings?.inviteChannelId) return null;
  const channel = await client.channels.fetch(settings.inviteChannelId).catch(() => null);
  if (!channel?.isTextBased() || !("messages" in channel) || !("send" in channel)) return null;
  const content = guideText(asLang(settings.language), storedQuestions(settings.inviteQuestions));
  const existing = settings.inviteGuideMessageId ? await channel.messages.fetch(settings.inviteGuideMessageId).catch(() => null) : null;
  if (existing?.editable) { if (existing.content !== content) await existing.edit({ content, allowedMentions: { parse: [] } }); return existing.id; }
  const posted = await channel.send({ content, allowedMentions: { parse: [] } }).catch(() => null);
  if (!posted) return null;
  await posted.pin().catch(() => undefined);
  await database.guildSettings.update({ where: { guildId }, data: { inviteGuideMessageId: posted.id } });
  return posted.id;
}

/** Sets stage and/or note on every post of a name. Returns how many records changed. */
export async function updateRecruit(database: Pick<PrismaClient, "inviteRequest">, guildId: string, name: string, change: { stage?: Stage; note?: string | null }): Promise<number> {
  const data: { status?: Stage; note?: string | null; invitedAt?: Date; cleanupAt?: Date | null; cleanedAt?: null; cleanTries?: number; cleanQueuedAt?: null; legacyHandled?: boolean } = {};
  if (change.stage) { data.status = change.stage; if (change.stage !== "PENDING") { data.invitedAt = new Date(); data.cleanupAt = new Date(Date.now() + CLEANUP_DELAY_MS); } else Object.assign(data, { cleanupAt: null, cleanedAt: null, cleanTries: 0, cleanQueuedAt: null, legacyHandled: false }); }
  if (change.note !== undefined) data.note = change.note ? change.note.slice(0, 500) : null;
  if (!Object.keys(data).length) return 0;
  const result = await database.inviteRequest.updateMany({ where: { guildId, nameKey: nameKeyOf(name) }, data });
  return result.count;
}

// ---- Recruiting post template and shared cooldown ----

export const DEFAULT_TEMPLATE = "Guild recruiting! We are looking for new members. Write your full character name in the guild-invites channel and an officer will invite you.";
export const MIN_COOLDOWN_HOURS = 1;
export const MAX_COOLDOWN_HOURS = 720;

export interface CooldownState { cooling: boolean; until: Date | null; by: string | null }
export function cooldownState(settings: { recruitLastPostAt: Date | null; recruitLastPostBy: string | null; recruitCooldownHours: number }, now = new Date()): CooldownState {
  if (!settings.recruitLastPostAt) return { cooling: false, until: null, by: null };
  const until = new Date(settings.recruitLastPostAt.getTime() + settings.recruitCooldownHours * 3_600_000);
  return { cooling: until > now, until, by: settings.recruitLastPostBy };
}

/** An officer says the post went out. Refused while the shared cooldown runs. */
export async function markRecruitPosted(database: Pick<PrismaClient, "guildSettings">, guildId: string, officerDiscordId: string, now = new Date()): Promise<{ ok: boolean; state: CooldownState }> {
  const settings = await database.guildSettings.findUnique({ where: { guildId }, select: { recruitLastPostAt: true, recruitLastPostBy: true, recruitCooldownHours: true } });
  const state = settings ? cooldownState(settings, now) : { cooling: false, until: null, by: null };
  if (state.cooling) return { ok: false, state };
  await database.guildSettings.upsert({ where: { guildId }, create: { guildId, recruitLastPostAt: now, recruitLastPostBy: officerDiscordId }, update: { recruitLastPostAt: now, recruitLastPostBy: officerDiscordId, recruitRemindedAt: null } });
  return { ok: true, state: cooldownState({ recruitLastPostAt: now, recruitLastPostBy: officerDiscordId, recruitCooldownHours: settings?.recruitCooldownHours ?? 72 }, now) };
}

/** Once the cooldown is over, one reminder in the officer log. Automatic, so preview-gated. Returns how many guilds were reminded. */
export async function sendRecruitReminders(client: Pick<Client, "channels">, database: Pick<PrismaClient, "guildSettings">, now = new Date()): Promise<number> {
  const rows = await database.guildSettings.findMany({
    where: { recruitLastPostAt: { not: null }, recruitRemindedAt: null, logChannelId: { not: null } },
    select: { guildId: true, logChannelId: true, recruitLastPostAt: true, recruitLastPostBy: true, recruitCooldownHours: true, language: true, guild: { select: { discordId: true } } }
  });
  let sent = 0;
  for (const row of rows) {
    if (cooldownState(row, now).cooling) continue;
    const channel = await client.channels.fetch(row.logChannelId!).catch(() => null);
    if (!channel?.isTextBased() || !("send" in channel)) continue;
    const text = asLang(row.language) === "fr"
      ? "📣 Le délai de recrutement est écoulé : vous pouvez publier de nouveau le message de recrutement (`/mod invites post`)."
      : "📣 The recruiting cooldown is over: you can post the recruiting message again (`/mod invites post`).";
    await channel.send({ content: text, allowedMentions: { parse: [] } }).catch(() => undefined);
    await database.guildSettings.update({ where: { guildId: row.guildId }, data: { recruitRemindedAt: now } });
    sent++;
  }
  return sent;
}
