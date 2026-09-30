import { updateProfessionDirectory } from "./profession-directory.js";
import type { Guild as DiscordGuild } from "discord.js";
import { prisma } from "../database.js";
import { autoLinkUnclaimed } from "./character-autolink.js";
import { dungeonAnnouncement } from "./dungeon-announce.js";
import { updateDungeonLeaderboard } from "./dungeon-leaderboard.js";
import { notifications, notify, notifyDungeon } from "./notify.js";
import { postReadinessBoard } from "./readiness-board.js";
import type { createAddonImportService } from "./addon-import.js";
import { describeCalendar, runCalendarPlan, type CalendarSummary } from "./calendar-sync.js";

type ImportResult = Awaited<ReturnType<ReturnType<typeof createAddonImportService>["apply"]>>;

// Everything that follows an applied import, whoever applied it (an officer
// with /import apply, or the bot itself when auto-apply is on): link newly
// discovered characters by Discord name, announce the import, dungeon runs
// and the leaderboard, and refresh the readiness board.
export async function followUpImport(discordGuild: DiscordGuild | null, guildId: string, result: ImportResult): Promise<{ autoLinked: { character: string; member: string }[]; calendar: CalendarSummary | null }> {
  const autoLinked = discordGuild && result.discovery.discovered > 0
    ? await autoLinkUnclaimed(discordGuild, prisma, guildId).catch(() => [])
    : [];
  await updateProfessionDirectory(discordGuild);
  const matchedRaids = result.raids.filter((raid) => raid.matchedRaidTitle).length;
  if (result.epgpTransactions.length > 0 || matchedRaids > 0) {
    // Housekeeping for officers, not news for members: the private officer log.
    await notify(discordGuild, notifications.importApplied(result.epgpTransactions.length, matchedRaids), "officer");
  }
  if (discordGuild && result.loot.recordedIds?.length) {
    const awards = await prisma.lootAward.findMany({ where: { guildId, id: { in: result.loot.recordedIds } }, include: { member: true } });
    const raids = await prisma.raid.findMany({ where: { guildId, id: { in: awards.flatMap(award => award.raidId ? [award.raidId] : []) } }, select: { id: true, coreId: true } });
    const coreByRaid = new Map(raids.map(raid => [raid.id, raid.coreId]));
    for (const award of awards) await notify(discordGuild, notifications.lootAwarded(award.itemName, award.member.displayName, award.amount), "loot", award.raidId ? coreByRaid.get(award.raidId) ?? null : null);
  }
  const dungeonPost = dungeonAnnouncement(result.dungeons, "en");
  if (dungeonPost) {
    await notifyDungeon(discordGuild, (lang) => dungeonAnnouncement(result.dungeons, lang) ?? dungeonPost);
    await updateDungeonLeaderboard(discordGuild);
  }
  if (result.readinessSnapshots.length > 0 || result.consumables > 0) await postReadinessBoard(discordGuild, guildId, "updated after an addon import");
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
