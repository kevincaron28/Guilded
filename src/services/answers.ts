import type { PrismaClient } from "@prisma/client";
import { createEpgpService } from "./epgp.js";

// The answer channel (5.0): members ask a question in one channel and the bot replies.
//   1. Officer-written answers (FaqEntry, /mod faq): a message matches an entry when it contains
//      every word of one of its triggers ("raid time" matches "what time is the raid?"). The
//      entry with the most specific (longest) matching trigger wins. Free, and always on.
//   2. Optionally an AI answer when no entry matches: any OpenAI-compatible chat endpoint, set by
//      AI_BASE_URL / AI_MODEL / AI_API_KEY (a free Gemini or Groq key, or a local Ollama on the
//      server), switched on per guild with /mod faq ai. It only sees the guild facts below.
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

// Remembers when each member was last answered, and how many AI answers each guild used today.
export function createAnswerLimiter(now: () => number = Date.now) {
  const lastAnswer = new Map<string, number>();
  const aiUsed = new Map<string, { day: string; count: number }>();
  const today = () => new Date(now()).toISOString().slice(0, 10);
  return {
    // True (and remembered) when this member may get an answer now.
    allowUser(key: string): boolean {
      const last = lastAnswer.get(key);
      if (last !== undefined && now() - last < USER_COOLDOWN_MS) return false;
      lastAnswer.set(key, now());
      return true;
    },
    // True (and counted) while the guild is under its daily AI limit.
    allowAi(guildId: string, dailyLimit: number): boolean {
      const day = today();
      const used = aiUsed.get(guildId);
      const count = used && used.day === day ? used.count : 0;
      if (count >= dailyLimit) return false;
      aiUsed.set(guildId, { day, count: count + 1 });
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

export function aiMessages(facts: string, question: string, botName: string) {
  return [
    {
      role: "system" as const,
      content: `You are ${botName}, the helper bot of a World of Warcraft Classic guild on Discord. Answer the member's question in at most 4 short sentences, in the language they wrote in (French or English). Use only the guild facts below and general World of Warcraft Classic knowledge. If the facts do not answer a question about the guild (times, rules, loot, who is in charge), say you do not know and to ask an officer; never invent guild rules, times or numbers. No mentions, no links unless they are in the facts.\n\nGuild facts:\n${facts}`
    },
    { role: "user" as const, content: question.slice(0, 800) }
  ];
}

// One chat completion from an OpenAI-compatible endpoint. Null on any failure (the caller stays
// quiet: a missing answer is better than an error message in the channel).
export async function askAi(
  settings: AiSettings, messages: { role: "system" | "user"; content: string }[],
  fetchImpl: typeof fetch = fetch, timeoutMs = 20_000
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${settings.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}) },
      body: JSON.stringify({ model: settings.model, messages, max_tokens: 400, temperature: 0.3 }),
      signal: controller.signal
    });
    if (!response.ok) return null;
    const body = await response.json() as { choices?: { message?: { content?: string } }[] };
    const text = body.choices?.[0]?.message?.content?.trim();
    return text ? text.slice(0, MAX_ANSWER_LENGTH) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
