import type { PrismaClient } from "@prisma/client";
import { createEpgpService } from "./epgp.js";
import { tx, type Lang } from "../i18n.js";

// The answer channel (5.0): members ask a question in one channel and the bot replies.
//   1. Officer-written answers (FaqEntry, /mod faq): a message matches an entry when it contains
//      every word of one of its triggers ("raid time" matches "what time is the raid?"). The
//      entry with the most specific (longest) matching trigger wins. Free, and always on.
//   2. A raid-schedule answer straight from the database when the question is about raid timing
//      ("raid night?", "quand est le raid ?"): free and always on, no AI needed.
//   3. Optionally an AI answer when neither of the above matches: any OpenAI-compatible chat
//      endpoint, set by AI_BASE_URL / AI_MODEL / AI_API_KEY (a free Gemini or Groq key, or a
//      local Ollama on the server), switched on per guild with /mod faq ai. It only sees the
//      guild facts below.
// Reading messages needs Discord's Message Content intent (MESSAGE_CONTENT_INTENT=true).

export const MAX_TRIGGERS = 10;
export const MAX_ANSWER_LENGTH = 1500;
// One answer per member per this many seconds, so a chatty channel is not flooded.
export const USER_COOLDOWN_MS = 15_000;

// "Quand est le RAID?" -> "quand est le raid": lower case, no accents, words only.
export function foldText(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

// The triggers box: one per line or separated by commas; folded, empty ones and duplicates dropped.
export function parseTriggers(text: string): string[] {
  const seen = new Set<string>();
  for (const part of text.split(/[\n,;]+/)) {
    const trigger = foldText(part);
    if (trigger.length >= 2) seen.add(trigger);
  }
  return [...seen].slice(0, MAX_TRIGGERS);
}

export interface FaqLike { id: string; triggers: string[]; answer: string }

// The entry whose trigger fits the message best, or null. A trigger fits when each of its words
// is a word of the message; more words = more specific = better.
export function matchFaq<T extends FaqLike>(entries: T[], message: string): T | null {
  const words = new Set(foldText(message).split(" ").filter(Boolean));
  if (words.size === 0) return null;
  let best: { entry: T; score: number } | null = null;
  for (const entry of entries) {
    for (const trigger of entry.triggers) {
      const needed = foldText(trigger).split(" ").filter(Boolean);
      if (needed.length === 0 || !needed.every((word) => words.has(word))) continue;
      const score = needed.length * 100 + needed.join("").length;
      if (!best || score > best.score) best = { entry, score };
    }
  }
  return best?.entry ?? null;
}

export function looksLikeQuestion(text: string, mentionsBot: boolean): boolean {
  if (mentionsBot || text.includes("?")) return true;
  const folded = foldText(text);
  return /^(what|when|where|who|why|how|which|can|could|would|do|does|is|are|comment|quand|ou|qui|pourquoi|quel|quelle|quels|quelles|est ce que|peux tu|pouvez vous)\b/.test(folded)
    || /\b(help|aide|explain|explique|how do i|how can i|can you|could you|comment faire|comment utiliser)\b/.test(folded);
}

// "raid night?", "when is the raid", "quand est le raid ce soir", "core schedule", "prochain raid"…
const SCHEDULE_SUBJECT = /\b(raids?|core)\b/;
const SCHEDULE_WORD = /\b(night|nights|time|times|schedule|day|days|hour|hours|when|next|soir|soirs|horaire|horaires|heure|heures|jour|jours|prochain|prochaine|quand)\b/;

// A raid-schedule question doesn't need AI: it names "raid"/"core" and asks about timing.
export function looksLikeScheduleQuestion(text: string): boolean {
  const folded = foldText(text);
  return SCHEDULE_SUBJECT.test(folded) && SCHEDULE_WORD.test(folded);
}

// A free, deterministic answer straight from the database: each core's schedule and the next
// planned raids. Returns null when the guild has nothing to say yet (no core schedule set, no
// raid planned), so the caller can fall back to the AI answer or admit it doesn't know.
export async function scheduleAnswer(
  database: PrismaClient, guildId: string, timeZone: string, lang: Lang, now = new Date()
): Promise<string | null> {
  const [cores, raids] = await Promise.all([
    database.raidCore.findMany({
      where: { guildId, schedule: { not: null } }, select: { name: true, schedule: true }, orderBy: { name: "asc" }, take: 10
    }),
    database.raid.findMany({
      where: { guildId, isTest: false, status: { in: ["PLANNED", "ACTIVE"] }, scheduledAt: { gte: new Date(now.getTime() - 6 * 3_600_000) } },
      orderBy: { scheduledAt: "asc" }, take: 3, include: { core: { select: { name: true } } }
    })
  ]);
  if (cores.length === 0 && raids.length === 0) return null;
  const when = (date: Date) =>
    date.toLocaleString(lang === "fr" ? "fr-CA" : "en-CA", { timeZone, weekday: "long", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const lines: string[] = [];
  if (cores.length) {
    lines.push(tx(lang, "Raid schedule:"));
    for (const core of cores) lines.push(`• **${core.name}** — ${core.schedule}`);
  }
  if (raids.length) {
    if (lines.length) lines.push("");
    lines.push(tx(lang, "Next raid:"));
    for (const raid of raids) lines.push(`• ${raid.title}${raid.core ? ` [${raid.core.name}]` : ""} — ${when(raid.scheduledAt)}`);
  }
  return lines.join("\n").slice(0, MAX_ANSWER_LENGTH);
}

// Remembers when each member was last answered, and how many AI answers each guild used today.
export function createAnswerLimiter(now: () => number = Date.now) {
  const lastAnswer = new Map<string, number>();
  const aiUsed = new Map<string, { day: string; count: number }>();
  const today = () => new Date(now()).toISOString().slice(0, 10);
  const aiCount = (guildId: string, day: string) => {
    const used = aiUsed.get(guildId);
    return used && used.day === day ? used.count : 0;
  };
  const canAnswerUser = (key: string) => {
    const last = lastAnswer.get(key);
    return last === undefined || now() - last >= USER_COOLDOWN_MS;
  };
  const canUseAi = (guildId: string, dailyLimit: number) => aiCount(guildId, today()) < dailyLimit;
  const recordAiAnswer = (guildId: string) => {
    const day = today();
    aiUsed.set(guildId, { day, count: aiCount(guildId, day) + 1 });
  };
  return {
    canAnswerUser,
    recordUserAnswer(key: string): void {
      lastAnswer.set(key, now());
    },
    // True (and remembered) when this member may get an answer now.
    allowUser(key: string): boolean {
      if (!canAnswerUser(key)) return false;
      lastAnswer.set(key, now());
      return true;
    },
    canUseAi,
    recordAiAnswer,
    // True (and counted) while the guild is under its daily AI limit.
    allowAi(guildId: string, dailyLimit: number): boolean {
      if (!canUseAi(guildId, dailyLimit)) return false;
      recordAiAnswer(guildId);
      return true;
    }
  };
}

export interface AiSettings { baseUrl: string; model: string; apiKey?: string | undefined }

// The facts an AI answer may use: the guild's own answers, its cores and next raids, and the
// asker's characters and EPGP standing. Short on purpose (free tiers limit tokens).
export async function guildFacts(
  database: PrismaClient, guildId: string, memberId: string | null, timeZone: string, now = new Date()
): Promise<string> {
  const [guild, settings, faq, cores, raids] = await Promise.all([
    database.guild.findUnique({ where: { id: guildId }, select: { name: true } }),
    database.guildSettings.findUnique({ where: { guildId }, select: { baseGp: true, lootMode: true } }),
    database.faqEntry.findMany({ where: { guildId }, orderBy: { uses: "desc" }, take: 30 }),
    database.raidCore.findMany({ where: { guildId }, select: { name: true, schedule: true, description: true }, take: 10 }),
    database.raid.findMany({
      where: { guildId, isTest: false, status: { in: ["PLANNED", "ACTIVE"] }, scheduledAt: { gte: new Date(now.getTime() - 6 * 3_600_000) } },
      orderBy: { scheduledAt: "asc" }, take: 5, include: { core: { select: { name: true } } }
    })
  ]);
  const when = (date: Date) => date.toLocaleString("en-CA", { timeZone, weekday: "long", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const lines = [`Guild: ${guild?.name ?? "this guild"}. Time zone: ${timeZone}. Now: ${when(now)}. Loot system: ${settings?.lootMode ?? "EPGP"}.`];
  if (faq.length) {
    lines.push("Officer answers:");
    for (const entry of faq) lines.push(`- (${entry.triggers.join(" / ")}) ${entry.answer.slice(0, 300)}`);
  }
  if (cores.length) {
    lines.push("Raid cores:");
    for (const core of cores) lines.push(`- ${core.name}${core.schedule ? `: ${core.schedule}` : ""}${core.description ? ` (${core.description.slice(0, 120)})` : ""}`);
  }
  lines.push(raids.length ? "Next raids:" : "No raid is scheduled right now.");
  for (const raid of raids) lines.push(`- ${raid.title}${raid.core ? ` [${raid.core.name}]` : ""}: ${when(raid.scheduledAt)} (${raid.status.toLowerCase()})`);
  if (memberId) {
    const characters = await database.character.findMany({ where: { memberId }, select: { name: true, className: true, level: true, isMain: true } });
    if (characters.length) lines.push(`The asker's characters: ${characters.map((c) => `${c.name} (${c.level ?? "?"} ${c.className}${c.isMain ? ", main" : ""})`).join(", ")}.`);
    const standing = await createEpgpService(database).getStanding(memberId, settings?.baseGp ?? 0);
    if (standing.ep !== 0 || standing.gp !== 0) lines.push(`The asker's EPGP: EP ${standing.ep}, GP ${standing.gp}, PR ${standing.pr.toFixed(2)}.`);
  }
  return lines.join("\n");
}

export function aiMessages(facts: string, question: string, botName: string, productReference = "") {
  return [
    {
      role: "system" as const,
      content: `You are ${botName}, the helpful support assistant for the Guilded Discord bot and its World of Warcraft Classic addon. Answer in the language the member used (French or English), usually in a few clear sentences. Use the product reference below for exact Guilded command names, syntax, permissions and features. Explain how to use the bot and addon, and answer general World of Warcraft Classic questions. Do not invent commands, options, permissions, guild schedules, loot rules or member data. Guild-specific facts below are authoritative; if they do not contain an answer about this guild, say you do not know and direct the member to an officer. If product documentation does not cover a Guilded-specific detail, say so and suggest /help in Discord or /guilded help in game. Do not mention users or include links unless they are present in the supplied facts.\n\nGuilded product reference:\n${productReference || "Use /help in Discord or /guilded help in game for the current command list."}\n\nGuild facts:\n${facts}`
    },
    { role: "user" as const, content: question.slice(0, 800) }
  ];
}

export type AiFailure =
  | { kind: "http"; status: number }
  | { kind: "timeout" }
  | { kind: "network" }
  | { kind: "invalid-response" }
  | { kind: "empty-response" };

export type AiResult = { answer: string } | { answer: null; failure: AiFailure };

// One chat completion from an OpenAI-compatible endpoint. Failures are classified without
// logging provider response bodies, which may contain sensitive request details.
export async function askAi(
  settings: AiSettings, messages: { role: "system" | "user"; content: string }[],
  fetchImpl: typeof fetch = fetch, timeoutMs = 20_000
): Promise<AiResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${settings.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}) },
      body: JSON.stringify({ model: settings.model, messages, max_tokens: 400, temperature: 0.3 }),
      signal: controller.signal
    });
    if (!response.ok) return { answer: null, failure: { kind: "http", status: response.status } };
    let parsed: unknown;
    try { parsed = await response.json(); } catch {
      return { answer: null, failure: { kind: "invalid-response" } };
    }
    if (typeof parsed !== "object" || parsed === null || !("choices" in parsed) || !Array.isArray(parsed.choices)) {
      return { answer: null, failure: { kind: "invalid-response" } };
    }
    const choice: unknown = parsed.choices[0];
    if (typeof choice !== "object" || choice === null || !("message" in choice) || typeof choice.message !== "object" || choice.message === null || !("content" in choice.message)) {
      return { answer: null, failure: { kind: "empty-response" } };
    }
    const content: unknown = choice.message.content;
    if (typeof content !== "string" || !content.trim()) return { answer: null, failure: { kind: "empty-response" } };
    return { answer: content.trim().slice(0, MAX_ANSWER_LENGTH) };
  } catch {
    return controller.signal.aborted
      ? { answer: null, failure: { kind: "timeout" } }
      : { answer: null, failure: { kind: "network" } };
  } finally {
    clearTimeout(timer);
  }
}
