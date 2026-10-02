import { ChannelType, EmbedBuilder, type Guild as DiscordGuild, type GuildTextBasedChannel, type ForumChannel } from "discord.js";
import type { GuildSettings, PrismaClient } from "@prisma/client";
import { t, tx, type Lang } from "../i18n.js";
import { dungeonGuideState, ensureDungeonSignupGuide } from "./dungeon-guide.js";
import { ensureWelcomePanel, welcomePanelState } from "./onboarding.js";

// The messages the bot keeps in its channels, for the /setup checklist: is each one there, and is
// it the current text? "Update bot messages" puts every one back or brings it up to date.
//   botGuide     pinned getting-started guide in the bot guide channel
//   groupFinder  pinned group finder menu (was the dungeon signup guide)
//   craftGuide   pinned "Start here" post of the craft board forum
//   welcomePanel pinned onboarding panel of the welcome channel (rules, games, pairing, first steps)
//   leaderboard  the dungeon leaderboard message (kept current by the bot)
//   roster       each raid core's roster message (kept current by the bot; outdated while the
//                core has no channels of its own)

export type BotMessageState = "current" | "outdated" | "missing";
export interface BotMessageFact { kind: "botGuide" | "groupFinder" | "craftGuide" | "welcomePanel" | "leaderboard" | "roster"; name?: string; state: BotMessageState }

export const ADDON_URL = "https://www.curseforge.com/wow/addons/guilded";

export function gettingStartedPost(lang: Lang): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(t(lang, "guide.title"))
    .setColor(0xd4af37)
    .setDescription(t(lang, "guide.body", { url: ADDON_URL }));
}

// The pinned guide in the bot guide channel: missing, the current text, or an older text.
export async function botGuideState(channel: GuildTextBasedChannel, lang: Lang): Promise<BotMessageState> {
  const pins = await channel.messages.fetchPinned().catch(() => null);
  const guide = pins?.find((message) => message.embeds.some((embed) => embed.title === t(lang, "guide.title")));
  if (!guide) return "missing";
  return guide.embeds[0]?.description === gettingStartedPost(lang).data.description ? "current" : "outdated";
}

// Pins the guide, or brings the pinned one up to date. Safe to call again.
export async function ensureBotGuide(channel: GuildTextBasedChannel, lang: Lang): Promise<void> {
  const pins = await channel.messages.fetchPinned().catch(() => null);
  const existing = pins?.find((message) => message.embeds.some((embed) => embed.title === t(lang, "guide.title")));
  if (existing) {
    if (existing.editable && existing.embeds[0]?.description !== gettingStartedPost(lang).data.description) {
      await existing.edit({ embeds: [gettingStartedPost(lang)] });
    }
    return;
  }
  const message = await channel.send({ embeds: [gettingStartedPost(lang)] });
  await message.pin().catch(() => undefined);
}

// The craft board forum's pinned "Start here" post, compared with `guideText`.
export async function craftGuideState(forum: ForumChannel, guideText: string): Promise<BotMessageState> {
  const threads = await forum.threads.fetchActive().catch(() => null);
  const pinned = threads?.threads.find((thread) => thread.flags.has("Pinned"));
  if (!pinned) return "missing";
  const starter = await pinned.fetchStarterMessage().catch(() => null);
  if (!starter) return "missing";
  return starter.content === guideText ? "current" : "outdated";
}

async function textChannel(guild: DiscordGuild, id: string | null | undefined): Promise<GuildTextBasedChannel | null> {
  if (!id) return null;
  const channel = await guild.channels.fetch(id).catch(() => null);
  return channel?.isTextBased() && "messages" in channel ? channel as GuildTextBasedChannel : null;
}

// What the checklist shows for the bot's messages. Channels that are not set are skipped
// (their own channel row already says so).
export async function botMessageFacts(
  guild: DiscordGuild, database: Pick<PrismaClient, "raidCore">, settings: GuildSettings, lang: Lang, craftGuideText: string
): Promise<BotMessageFact[]> {
  const facts: BotMessageFact[] = [];
  const guideChannel = await textChannel(guild, settings.guideChannelId);
  if (guideChannel) facts.push({ kind: "botGuide", state: await botGuideState(guideChannel, lang) });
  const finder = await textChannel(guild, settings.dungeonSignupChannelId);
  if (finder) facts.push({ kind: "groupFinder", state: await dungeonGuideState(finder).catch(() => "missing" as const) });
  if (settings.craftChannelId) {
    const forum = await guild.channels.fetch(settings.craftChannelId).catch(() => null);
    if (forum?.type === ChannelType.GuildForum) facts.push({ kind: "craftGuide", state: await craftGuideState(forum, craftGuideText) });
  }
  const welcome = await textChannel(guild, settings.welcomeChannelId);
  if (welcome) facts.push({ kind: "welcomePanel", state: await welcomePanelState(welcome, settings, lang) });
  const board = await textChannel(guild, settings.dungeonLeaderboardChannelId);
  if (board) {
    const message = settings.dungeonLeaderboardMessageId ? await board.messages.fetch(settings.dungeonLeaderboardMessageId).catch(() => null) : null;
    facts.push({ kind: "leaderboard", state: message ? "current" : "missing" });
  }
  const cores = await database.raidCore.findMany({ where: { guildId: settings.guildId }, orderBy: { name: "asc" } });
  for (const core of cores) {
    const channel = await textChannel(guild, core.rosterChannelId ?? settings.coreChannelId);
    if (!channel) continue;
    const message = core.rosterMessageId ? await channel.messages.fetch(core.rosterMessageId).catch(() => null) : null;
    // A core without its own channels (made before 5.0) is out of date: "Update bot messages"
    // creates them and moves the roster there.
    facts.push({ kind: "roster", name: core.name, state: !message ? "missing" : core.categoryId ? "current" : "outdated" });
  }
  return facts;
}

// Puts back or updates every bot message whose channel is set. `extra` does the ones that live
// in command files (the craft board guide, the leaderboard, the rosters). Returns a short note.
export async function updateBotMessages(
  guild: DiscordGuild, settings: GuildSettings, lang: Lang,
  extra: { craftGuide?: () => Promise<void>; leaderboard?: () => Promise<unknown>; rosters?: () => Promise<unknown> }
): Promise<string> {
  const done: string[] = [];
  const guideChannel = await textChannel(guild, settings.guideChannelId);
  if (guideChannel) { await ensureBotGuide(guideChannel, lang); done.push(tx(lang, "bot guide")); }
  const finder = await textChannel(guild, settings.dungeonSignupChannelId);
  if (finder) { await ensureDungeonSignupGuide(finder, lang); done.push(tx(lang, "group finder menu")); }
  if (extra.craftGuide) { await extra.craftGuide(); done.push(tx(lang, "craft board guide")); }
  const welcome = await textChannel(guild, settings.welcomeChannelId);
  if (welcome) { await ensureWelcomePanel(welcome, settings, lang); done.push(tx(lang, "welcome panel")); }
  if (extra.leaderboard && settings.dungeonLeaderboardChannelId) { await extra.leaderboard(); done.push(tx(lang, "dungeon leaderboard")); }
  if (extra.rosters) { await extra.rosters(); done.push(tx(lang, "core rosters")); }
  return done.length ? tx(lang, "Updated: {list}.", { list: done.join(", ") }) : tx(lang, "No bot message channel is set yet.");
}

// The label used for each kind in /setup's checklist (roster gets its own name-based label there).
const HEALTH_LABELS: Record<Exclude<BotMessageFact["kind"], "roster">, string> = {
  botGuide: "Pinned bot guide", groupFinder: "Pinned group finder menu", craftGuide: "Pinned craft board guide", welcomePanel: "Pinned welcome panel", leaderboard: "Dungeon leaderboard message"
};

// An answer-channel summary of botMessageFacts, for an officer asking if anything is outdated or
// missing: same facts and wording as /setup's checklist, but as a short chat reply. Never null.
export async function botHealthAnswer(
  guild: DiscordGuild, database: Pick<PrismaClient, "raidCore">, settings: GuildSettings, lang: Lang, craftGuideText: string
): Promise<string> {
  const facts = await botMessageFacts(guild, database, settings, lang, craftGuideText);
  const stale = facts.filter((fact) => fact.state !== "current");
  if (stale.length === 0) return tx(lang, "Everything looks current: no outdated or missing bot messages found.");
  const lines = [tx(lang, "These bot messages need attention:")];
  for (const fact of stale) {
    const label = fact.kind === "roster" ? tx(lang, "Roster message: {name}", { name: fact.name ?? "?" }) : tx(lang, HEALTH_LABELS[fact.kind]);
    lines.push(fact.state === "missing" ? tx(lang, "• {label} — missing", { label }) : tx(lang, "• {label} — out of date", { label }));
  }
  lines.push(tx(lang, "An officer can fix these: run /setup start, then press \"Update bot messages\"."));
  // 1500 matches MAX_ANSWER_LENGTH in services/answers.ts (kept as a literal to avoid this file
  // depending on answers.ts, which faq.ts already imports both of for the answer channel).
  return lines.join("\n").slice(0, 1500);
}
