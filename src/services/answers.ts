import type { PrismaClient } from "@prisma/client";
import { createEpgpService } from "./epgp.js";
import { tx, type Lang } from "../i18n.js";
import { gettingStartedPost } from "./bot-messages.js";

// The answer channel (5.0): members ask a question in one channel and the bot replies.
//   1. Officer-written answers (FaqEntry, /mod faq): a message matches an entry when it contains
//      every word of one of its triggers ("raid time" matches "what time is the raid?"). The
//      entry with the most specific (longest) matching trigger wins. Free, and always on.
//   2. Free, deterministic answers straight from the database when a question names its subject
//      (raid timing, loot rules, open groups, an active poll, or — for a linked member — their
//      own EPGP standing, characters, application status, or bank/craft requests). Always on, no
//      AI needed: each `looksLikeX`/`xAnswer` pair below returns null when the guild or member has
//      nothing to say yet, so the caller falls through to the next check.
//   3. Optionally an AI answer when nothing above matches: any OpenAI-compatible chat endpoint,
//      set by AI_BASE_URL / AI_MODEL / AI_API_KEY (a free Gemini or Groq key, or a local Ollama on
//      the server), switched on per guild with /mod faq ai. It only sees the guild facts below.
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
// A message word fits a trigger word when equal, or when one is the other plus up to two letters
// (plural, "installing"/"install"); 4+ letters so short words never match loosely.
export function wordFits(messageWord: string, triggerWord: string): number {
  if (messageWord === triggerWord) return 2;
  const [short, long] = messageWord.length <= triggerWord.length ? [messageWord, triggerWord] : [triggerWord, messageWord];
  return short.length >= 4 && long.length - short.length <= 2 && long.startsWith(short) ? 1 : 0;
}

export function matchFaq<T extends FaqLike>(entries: T[], message: string): T | null {
  const words = [...new Set(foldText(message).split(" ").filter(Boolean))];
  if (words.length === 0) return null;
  let best: { entry: T; score: number } | null = null;
  for (const entry of entries) {
    for (const trigger of entry.triggers) {
      const needed = foldText(trigger).split(" ").filter(Boolean);
      if (needed.length === 0) continue;
      let exact = 0;
      let fits = true;
      for (const word of needed) {
        const quality = Math.max(0, ...words.map((w) => wordFits(w, word)));
        if (quality === 0) { fits = false; break; }
        if (quality === 2) exact++;
      }
      if (!fits) continue;
      const score = needed.length * 100 + needed.join("").length + exact;
      if (!best || score > best.score) best = { entry, score };
    }
  }
  return best?.entry ?? null;
}

// Topic words that make a plain statement ("poe2 companion not working") worth answering.
const TOPIC_WORDS = /\b(poe2?|poe 2|path of exile|attunement|attunements|wcl|warcraft logs|wishlist|dkp|epgp|pairing|pairage|sync|synchronisation|profession|professions|metier|metiers|companion|compagnon|addon)\b/;

export function looksLikeQuestion(text: string, mentionsBot: boolean): boolean {
  if (mentionsBot || text.includes("?")) return true;
  const folded = foldText(text);
  if (TOPIC_WORDS.test(folded)) return true;
  return /^(what|when|where|who|why|how|which|can|could|would|do|does|is|are|comment|quand|ou|qui|pourquoi|quel|quelle|quels|quelles|est ce que|peux tu|pouvez vous)\b/.test(folded)
    || /\b(help|aide|explain|explique|how do i|how can i|can you|could you|comment faire|comment utiliser)\b/.test(folded);
}

// Installation help works without AI or a member/character record.
export function looksLikeInstallationQuestion(text: string): boolean {
  const folded = foldText(text);
  return /\b(addon|add on|companion|compagnon|guilded)\b/.test(folded)
    && /\b(install|installation|installer|installe|download|telecharger|pair|pairing|pairage|connect|connecter|relier|zip|synchroniser|sync)\b/.test(folded);
}

export function installationAnswer(lang: Lang): string {
  const body = gettingStartedPost(lang).data.description ?? "";
  // Reuse the two installation sections of the pinned guide, without its
  // welcome and game-activity sections.
  return body.split("\n\n").slice(1, 3).join("\n\n").slice(0, MAX_ANSWER_LENGTH);
}

// Shared bot help never gives the AI private raid/core or member records.
export function sharedSupportFacts(name: string, entries: readonly FaqLike[]): string {
  return [
    `Guild: ${name}. This is a shared bot-support channel for all games.`,
    "Only public product help and the officer-written answers below are available. Do not infer private guild, game, raid, character or member data. For personal records, direct the member to the appropriate Discord slash command; for game activities, to that game's section.",
    ...entries.slice(0, 30).map(entry => `Public officer answer: ${entry.answer.slice(0, 300)}`)
  ].join("\n");
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

// "how does loot work", "epgp rules", "comment fonctionne le loot"…
const LOOT_SUBJECT = /\b(loot|epgp|dkp)\b/;
const LOOT_WORD = /\b(work|works|worked|rule|rules|system|mode|how|explain|explique|comment|regle|regles|fonctionne|fonctionnent)\b/;

export function looksLikeLootRulesQuestion(text: string): boolean {
  const folded = foldText(text);
  return LOOT_SUBJECT.test(folded) && LOOT_WORD.test(folded);
}

// A free explanation of the guild's own loot rules, straight from its settings. Synchronous:
// callers already have the settings row (from answerSettings/guildService.getSettings).
export function lootRulesAnswer(
  settings: { lootMode: string; baseGp: number; epgpDecayPercent: number; epgpDecayIntervalHours: number } | null, lang: Lang
): string | null {
  if (!settings) return null;
  if (settings.lootMode === "COUNCIL") {
    return tx(lang, "This guild uses council loot: officers decide who gets each drop. There is no bidding.");
  }
  const lines = [tx(lang, "This guild uses EPGP loot: priority (PR) is EP ÷ (GP + {baseGp}), and the highest PR wins each roll or bid.", { baseGp: settings.baseGp })];
  if (settings.epgpDecayPercent > 0) {
    lines.push(tx(lang, "EP and GP can decay by {percent}% every {hours}h (an officer runs this).", {
      percent: (settings.epgpDecayPercent * 100).toFixed(0), hours: settings.epgpDecayIntervalHours
    }));
  }
  lines.push(tx(lang, "Check your own numbers with /epgp."));
  return lines.join("\n").slice(0, MAX_ANSWER_LENGTH);
}

// "any groups open?", "lfg?", "des groupes ouverts?"…
const GROUP_SUBJECT = /\b(group|groups|lfg|dungeon|donjon|groupe|groupes)\b/;
const GROUP_WORD = /\b(open|opens|looking|need|any|active|ouvert|ouverts|cherche|besoin)\b/;

export function looksLikeOpenGroupsQuestion(text: string): boolean {
  const folded = foldText(text);
  return GROUP_SUBJECT.test(folded) && GROUP_WORD.test(folded);
}

// Every open (not yet started) dungeon/group-finder group, guild-wide. Returns null when none
// are open right now.
export async function openGroupsAnswer(database: PrismaClient, guildId: string, lang: Lang): Promise<string | null> {
  const groups = await database.dungeonGroup.findMany({
    where: { guildId, status: "OPEN" },
    select: { title: true, maxSize: true, _count: { select: { signups: true } } },
    orderBy: { createdAt: "desc" }, take: 5
  });
  if (groups.length === 0) return null;
  const lines = [tx(lang, "Open groups:")];
  for (const group of groups) lines.push(`• ${group.title} (${group._count.signups}/${group.maxSize})`);
  return lines.join("\n").slice(0, MAX_ANSWER_LENGTH);
}

// "any poll?", "active vote", "un sondage en cours?"…
const POLL_SUBJECT = /\b(poll|polls|vote|votes|voting|sondage|sondages)\b/;
const POLL_WORD = /\b(open|active|current|any|ongoing|ouvert|actif|cours)\b/;

export function looksLikeActivePollQuestion(text: string): boolean {
  const folded = foldText(text);
  return POLL_SUBJECT.test(folded) && POLL_WORD.test(folded);
}

// The most recent still-open poll, guild-wide. Returns null when nothing is open.
export async function activePollAnswer(database: PrismaClient, guildId: string, lang: Lang): Promise<string | null> {
  const poll = await database.poll.findFirst({ where: { guildId, closed: false }, orderBy: { createdAt: "desc" }, select: { question: true, options: true } });
  if (!poll) return null;
  return tx(lang, "Open poll: {question} ({options})", { question: poll.question, options: poll.options.join(", ") });
}

// "what's my ep", "my gp", "combien j'ai de ep"… narrow subject (ep/gp/pr are rare outside this
// context) so a loose intent word ("my"/"i") stays safe.
const EPGP_PERSONAL_SUBJECT = /\b(ep|gp|pr|epgp|dkp)\b/;
const EPGP_PERSONAL_WORD = /\b(my|mine|i|me|combien|mon|ma|mes)\b/;

export function looksLikePersonalStandingQuestion(text: string): boolean {
  const folded = foldText(text);
  return EPGP_PERSONAL_SUBJECT.test(folded) && EPGP_PERSONAL_WORD.test(folded);
}

// The asker's own EPGP standing. Returns null when they have never earned or spent any (nothing
// to report, same threshold guildFacts uses for the AI answer).
export async function personalStandingAnswer(database: PrismaClient, memberId: string, baseGp: number, lang: Lang): Promise<string | null> {
  const standing = await createEpgpService(database).getStanding(memberId, baseGp);
  if (standing.ep === 0 && standing.gp === 0) return null;
  return tx(lang, "Your EPGP: EP {ep}, GP {gp}, PR {pr}.", { ep: standing.ep, gp: standing.gp, pr: standing.pr.toFixed(2) });
}

// "my characters", "which toons do I have", "mes personnages"…
const CHARACTERS_SUBJECT = /\b(character|characters|char|chars|toon|toons|alt|alts|perso|personnage|personnages)\b/;
const CHARACTERS_WORD = /\b(my|mine|i|me|which|what|combien|mon|ma|mes|quel|quels|quelle|quelles)\b/;

export function looksLikeMyCharactersQuestion(text: string): boolean {
  const folded = foldText(text);
  return CHARACTERS_SUBJECT.test(folded) && CHARACTERS_WORD.test(folded);
}

// The asker's own linked characters. Returns null when they have none linked yet.
export async function myCharactersAnswer(database: PrismaClient, memberId: string, lang: Lang): Promise<string | null> {
  const characters = await database.character.findMany({
    where: { memberId }, select: { name: true, className: true, level: true, isMain: true }, orderBy: [{ isMain: "desc" }, { name: "asc" }]
  });
  if (characters.length === 0) return null;
  const list = characters.map((c) => `${c.name} (${c.level ?? "?"} ${c.className}${c.isMain ? `, ${tx(lang, "main")}` : ""})`).join(", ");
  return tx(lang, "Your characters: {list}", { list });
}

// "my application", "did I get accepted", "ma candidature", "statut de ma demande"…
const APPLICATION_SUBJECT = /\b(application|apply|applied|applying|candidature|postule|postuler)\b/;
const APPLICATION_WORD = /\b(my|mine|i|me|status|accepted|rejected|approved|combien|mon|ma|mes|statut|accepte|refuse)\b/;

export function looksLikeApplicationStatusQuestion(text: string): boolean {
  const folded = foldText(text);
  return APPLICATION_SUBJECT.test(folded) && APPLICATION_WORD.test(folded);
}

// The asker's most recent application. Returns null when they have never applied.
export async function applicationStatusAnswer(database: PrismaClient, memberId: string, lang: Lang): Promise<string | null> {
  const application = await database.application.findFirst({ where: { memberId }, orderBy: { createdAt: "desc" }, select: { status: true, character: true } });
  if (!application) return null;
  const statusText: Record<string, string> = {
    PENDING: tx(lang, "still pending review"),
    APPROVED: tx(lang, "approved"),
    TRIAL: tx(lang, "on trial"),
    REJECTED: tx(lang, "not accepted")
  };
  return tx(lang, "Your application for {character} is {status}.", { character: application.character, status: statusText[application.status] ?? application.status });
}

// "my bank request", "where's my bank item", "ma demande de banque"…
const BANK_REQUEST_SUBJECT = /\bbank\b|\bbanque\b/;
const BANK_REQUEST_WORD = /\b(my|mine|request|requests|status|where|demande)\b/;

export function looksLikeBankRequestQuestion(text: string): boolean {
  const folded = foldText(text);
  return BANK_REQUEST_SUBJECT.test(folded) && BANK_REQUEST_WORD.test(folded);
}

// The asker's most recent guild bank request. Returns null when they have never made one.
export async function myBankRequestAnswer(database: PrismaClient, memberId: string, lang: Lang): Promise<string | null> {
  const request = await database.bankRequest.findFirst({ where: { memberId }, orderBy: { createdAt: "desc" }, select: { item: true, quantity: true, status: true, reply: true } });
  if (!request) return null;
  const statusText: Record<string, string> = {
    PENDING: tx(lang, "waiting for an officer"),
    APPROVED: tx(lang, "approved, waiting to be handed out"),
    FULFILLED: tx(lang, "fulfilled"),
    DENIED: tx(lang, "denied"),
    CANCELLED: tx(lang, "cancelled")
  };
  const base = tx(lang, "Your bank request for {item} x{quantity} is {status}.", { item: request.item, quantity: request.quantity, status: statusText[request.status] ?? request.status });
  return request.reply ? `${base} ${request.reply}` : base;
}

// "my craft request", "is my craft done", "ma commande d'artisanat"…
const CRAFT_REQUEST_SUBJECT = /\bcraft(ed|ing)?\b|\bcommande\b/;
const CRAFT_REQUEST_WORD = /\b(my|mine|request|requests|status|where|done|ready|order|orders|ma|mes|commande|commandes)\b/;

export function looksLikeCraftRequestQuestion(text: string): boolean {
  const folded = foldText(text);
  return CRAFT_REQUEST_SUBJECT.test(folded) && CRAFT_REQUEST_WORD.test(folded);
}

// The asker's most recent craft request. Returns null when they have never made one.
export async function myCraftRequestAnswer(database: PrismaClient, memberId: string, lang: Lang): Promise<string | null> {
  const request = await database.craftRequest.findFirst({ where: { requesterId: memberId }, orderBy: { createdAt: "desc" }, select: { item: true, quantity: true, status: true } });
  if (!request) return null;
  const statusText: Record<string, string> = {
    OPEN: tx(lang, "waiting for a crafter"),
    CLAIMED: tx(lang, "claimed by a crafter"),
    DONE: tx(lang, "done"),
    CANCELLED: tx(lang, "cancelled")
  };
  return tx(lang, "Your craft request for {item} x{quantity} is {status}.", { item: request.item, quantity: request.quantity, status: statusText[request.status] ?? request.status });
}

// "what commands", "how do I use this bot", "quelles commandes", "comment utiliser ce bot"…
const COMMAND_HELP_SUBJECT = /\b(command|commands|commande|commandes)\b/;
const COMMAND_HELP_WORD = /\b(what|which|list|how|use|do|quel|quelle|quels|quelles|comment|utiliser|liste)\b/;
const COMMAND_HELP_PHRASE = /\b(what can you do|how do i use (this|the) bot|how does (this|the) bot work|comment (utiliser|fonctionne) (ce|le) bot|que peux tu faire)\b/;

// A question about the bot's commands or how to use it: doesn't need AI, just a pointer to /help
// (the full, rank-aware command list) and, for officers, /setup.
export function looksLikeCommandHelpQuestion(text: string): boolean {
  const folded = foldText(text);
  return (COMMAND_HELP_SUBJECT.test(folded) && COMMAND_HELP_WORD.test(folded)) || COMMAND_HELP_PHRASE.test(folded);
}

// Always answers (never null): the command list lives in /help, so this only points to it.
export function commandHelpAnswer(canOfficer: boolean, lang: Lang): string {
  const lines = [
    tx(lang, "Use /help to see every command you can use, grouped by what it's for."),
    tx(lang, "A few common ones: /raid signup, /epgp balance, /character pair.")
  ];
  if (canOfficer) {
    lines.push(tx(lang, "Officers: /setup start walks through setting up (or checking) everything, and /mod faq manages this answer channel."));
  }
  return lines.join("\n").slice(0, MAX_ANSWER_LENGTH);
}

// "is the bot outdated", "does the bot need updating", "old version", "pinned messages up to
// date", "vieille version", "a besoin d'une mise a jour"… officer-only: see faq.ts.
const BOT_HEALTH_SUBJECT = /\b(bot|pin|pins|pinned|messages?|version|setup|epingle|epingles|epinglee|epinglees)\b/;
const BOT_HEALTH_WORD = /\b(outdated|out of date|old|update|updates|updated|updating|missing|current|perime|perimee|perimes|vieux|vieille|vieilles|desuet|desuete|manque|manquant|manquants)\b|\ba jour\b/;

export function looksLikeBotHealthQuestion(text: string): boolean {
  const folded = foldText(text);
  return BOT_HEALTH_SUBJECT.test(folded) && BOT_HEALTH_WORD.test(folded);
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
