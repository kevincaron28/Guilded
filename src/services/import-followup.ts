import { updateProfessionDirectory } from "./profession-directory.js";
import { EmbedBuilder, type Guild as DiscordGuild } from "discord.js";
import { prisma } from "../database.js";
import { autoLinkUnclaimed } from "./character-autolink.js";
import { dungeonPosts } from "./dungeon-announce.js";
import { recordRunHighlights } from "./dungeon-records.js";
import { recordCard, recordEmbed, recordItems } from "./record-card.js";
import { updateDungeonLeaderboard } from "./dungeon-leaderboard.js";
import { notifications, notify, notifyDungeon } from "./notify.js";
import { postReadinessBoard } from "./readiness-board.js";
import type { createAddonImportService } from "./addon-import.js";
import { describeCalendar, runCalendarPlan, type CalendarSummary } from "./calendar-sync.js";
import type { HeldRow } from "./addon-import.js";
import type { Lang } from "../i18n.js";
import { currentGuildScope, withGuildScope } from "./guild-scope.js";

type ImportResult = Awaited<ReturnType<ReturnType<typeof createAddonImportService>["apply"]>>;

// Officer-log line for rows that could not be imported yet: counted per reason, with what to do.
export function heldNotice(rows: HeldRow[], lang: Lang): string {
  const fr = lang === "fr";
  const count = (reason: HeldRow["reason"]) => rows.filter((row) => row.reason === reason).length;
  const names = (reason: HeldRow["reason"]) => [...new Set(rows.filter((row) => row.reason === reason).map((row) => row.character))].slice(0, 8).join(", ");
  const lines: string[] = [];
  if (count("UNLINKED")) lines.push(fr
    ? `• ${count("UNLINKED")} pour un personnage non lié (${names("UNLINKED")}) : \`/officer character link\`, puis la prochaine synchronisation les importe.`
    : `• ${count("UNLINKED")} for a character nobody linked (${names("UNLINKED")}): \`/officer character link\`, then the next sync imports them.`);
  if (count("SHARED_FIRST_NAME")) lines.push(fr
    ? `• ${count("SHARED_FIRST_NAME")} sous un prénom WoW Forever partagé par plusieurs membres (${names("SHARED_FIRST_NAME")}) : lie ce nom au bon membre avec \`/officer character link\`, puis la prochaine synchronisation les importe.`
    : `• ${count("SHARED_FIRST_NAME")} under a WoW Forever first name several members' characters share (${names("SHARED_FIRST_NAME")}): link that name to the right member with \`/officer character link\`, then the next sync imports them.`);
  if (count("NO_CORE")) lines.push(fr
    ? `• ${count("NO_CORE")} sans core choisi (${names("NO_CORE")}) : annule-les en jeu (\`/guilded void\`) et redonne-les avec \`/guilded core <nom>\`.`
    : `• ${count("NO_CORE")} given with no raid core chosen (${names("NO_CORE")}): void them in game (\`/guilded void\`) and award again after \`/guilded core <name>\`.`);
  if (count("UNKNOWN_POOL")) lines.push(fr
    ? `• ${count("UNKNOWN_POOL")} pour un core supprimé ou sans pool de points (${names("UNKNOWN_POOL")}).`
    : `• ${count("UNKNOWN_POOL")} for a core that was deleted or has no point pool (${names("UNKNOWN_POOL")}).`);
  if (count("NO_CORE_RAID")) lines.push(fr
    ? `• ${count("NO_CORE_RAID")} butin(s) sans raid de core : ils s'importent après \`/guilded end\` si le raid correspond à un raid Discord.`
    : `• ${count("NO_CORE_RAID")} loot row(s) with no core raid yet: they import after \`/guilded end\` when the raid matches a Discord raid.`);
  return `${fr ? "⚠️ **Entrées de l'addon en attente**" : "⚠️ **Addon entries on hold**"} (${rows.length})\n${lines.join("\n")}\n${fr ? "Le reste a été importé. Liste et retrait : `/import held`." : "Everything else was imported. List or dismiss them: `/import held`."}`;
}

// One post (card + short embed) per completed run, oldest first. True when there was at least one run to announce.
// 9.1: records and challenges are stored first (always), and called out on the run's post unless an officer switched that off.
export async function announceDungeonRuns(discordGuild: DiscordGuild | null, dungeons: ImportResult["dungeons"], guildId?: string): Promise<boolean> {
  if (guildId) {
    await recordRunHighlights(prisma, guildId, dungeons.results);
    const settings = await prisma.guildSettings.findUnique({ where: { guildId }, select: { dungeonHighlightsEnabled: true } }).catch(() => null);
    if (settings && !settings.dungeonHighlightsEnabled) for (const run of dungeons.results) delete run.highlights;
  }
  const runs = dungeonPosts(dungeons, "en");
  for (const index of runs.keys()) {
    await notifyDungeon(discordGuild, (lang) => {
      const post = dungeonPosts(dungeons, lang)[index] ?? runs[index]!;
      return { embed: post.embed, card: post.card, cardOnly: post.cardOnly, components: post.components, ...(post.content ? { content: post.content } : {}) };
    });
    // A guild record gets its own card right after the run's post, so it is not lost among the run cards. Highlights were
    // removed above when an officer switched records off, so this follows the same switch. No mentions.
    const run = dungeons.results.find(result => result.runRef === runs[index]!.runRef);
    for (const item of run ? recordItems(run.highlights) : []) {
      await notifyDungeon(discordGuild, (lang) => ({ embed: recordEmbed(run!, item, lang), card: recordCard(run!, item, lang), cardOnly: { embed: new EmbedBuilder().setColor(0xffd100) } }));
    }
  }
  return runs.length > 0;
}

// Everything that follows an applied import, whoever applied it (an officer
// with /import apply, or the bot itself when auto-apply is on): link newly
// discovered characters by Discord name, announce the import, dungeon runs
// and the leaderboard, and refresh the readiness board.
export async function followUpImport(discordGuild: DiscordGuild | null, guildId: string, result: ImportResult, options: { since?: Date; refresh?: boolean } = {}): Promise<{ autoLinked: { character: string; member: string }[]; calendar: CalendarSummary | null }> {
  if (currentGuildScope()?.guild.id !== guildId) return withGuildScope(prisma, guildId, () => followUpImport(discordGuild, guildId, result, options));
  const autoLinked = discordGuild && result.discovery.discovered > 0
    ? await autoLinkUnclaimed(discordGuild, prisma, guildId, options).catch(() => [])
    : [];
  // `refresh: false` (a backlog of follow-ups for one guild): the idempotent board/directory refreshes are skipped, the
  // per-import parts (notices, cards, highlights, calendar, linking) still run for every import. The next refresh catches up.
  const refresh = options.refresh !== false;
  if (refresh) await updateProfessionDirectory(discordGuild);
  // Levels arrive with every roster upload; the race board is a no-op unless the server opted in.
  if (discordGuild && refresh) await import("./race-board.js").then(module => module.updateRaceBoard(discordGuild)).catch(() => false);
  const matchedRaids = result.raids.filter((raid) => raid.matchedRaidTitle).length;
  if (result.epgpTransactions.length > 0 || matchedRaids > 0) {
    // Housekeeping for officers, not news for members: the private officer log.
    await notify(discordGuild, notifications.importApplied(result.epgpTransactions.length, matchedRaids), "officer");
  }
  // Only when something new is waiting: the same rows come back with every upload.
  if (result.held.fresh > 0) await notify(discordGuild, (lang) => heldNotice(result.held.rows, lang), "officer");
  if (discordGuild && result.loot.recordedIds?.length) {
    const awards = await prisma.lootAward.findMany({ where: { guildId, id: { in: result.loot.recordedIds } }, include: { member: true } });
    const raids = await prisma.raid.findMany({ where: { guildId, id: { in: awards.flatMap(award => award.raidId ? [award.raidId] : []) } }, select: { id: true, coreId: true } });
    const coreByRaid = new Map(raids.map(raid => [raid.id, raid.coreId]));
    for (const award of awards) await notify(discordGuild, notifications.lootAwarded(award.itemName, award.member.displayName, award.amount), "loot", award.raidId ? coreByRaid.get(award.raidId) ?? null : null);
  }
  if (await announceDungeonRuns(discordGuild, result.dungeons, guildId) && refresh) await updateDungeonLeaderboard(discordGuild);
  // (9.3.2) A run with players of other guilds is also stored (and its card posted) in those guilds.
  if (result.dungeons.shareable?.length) void import("./cross-guild-post.js").then((module) => module.shareAndAnnounce(discordGuild?.client, { guildId, characterKeys: [], receivedAt: result.dungeons.receivedAt ?? new Date() }, result.dungeons.shareable)).catch(() => undefined);
  if (refresh && (result.readinessSnapshots.length > 0 || result.consumables > 0)) await postReadinessBoard(discordGuild, guildId);
  // In-game calendar answers fill in the signups of the matching Discord raids.
  let calendar: CalendarSummary | null = null;
  if (result.calendarPlan.matches.length > 0 || result.calendarPlan.unmatched.length > 0) {
    calendar = await runCalendarPlan(prisma, guildId, result.calendarPlan).catch((error: unknown) => {
      console.error("Calendar sync failed", error);
      return null;
    });
    if (calendar && discordGuild && calendar.changedRaidIds.length > 0) {
      const { syncSignupEmbed } = await import("../commands/raid.js");
      for (const raidId of calendar.changedRaidIds) await syncSignupEmbed(discordGuild, guildId, raidId);
    }
    const text = describeCalendar(calendar);
    if (text && calendar && (calendar.signedUp + calendar.maybe + calendar.waitlisted > 0 || calendar.unmatched.length > 0)) {
      await notify(discordGuild, `📅 **Calendar sync**\n${text}`, "officer");
    }
  }
  return { autoLinked, calendar };
}
