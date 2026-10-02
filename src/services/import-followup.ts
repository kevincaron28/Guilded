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
import type { HeldRow } from "./addon-import.js";
import type { Lang } from "../i18n.js";

type ImportResult = Awaited<ReturnType<ReturnType<typeof createAddonImportService>["apply"]>>;

// Officer-log line for rows that could not be imported yet: counted per reason, with what to do.
export function heldNotice(rows: HeldRow[], lang: Lang): string {
  const fr = lang === "fr";
  const count = (reason: HeldRow["reason"]) => rows.filter((row) => row.reason === reason).length;
  const names = (reason: HeldRow["reason"]) => [...new Set(rows.filter((row) => row.reason === reason).map((row) => row.character))].slice(0, 8).join(", ");
  const lines: string[] = [];
  if (count("UNLINKED")) lines.push(fr
    ? `• ${count("UNLINKED")} pour un personnage non lié (${names("UNLINKED")}) : \`/character link\`, puis la prochaine synchronisation les importe.`
    : `• ${count("UNLINKED")} for a character nobody linked (${names("UNLINKED")}): \`/character link\`, then the next sync imports them.`);
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
  // Only when something new is waiting: the same rows come back with every upload.
  if (result.held.fresh > 0) await notify(discordGuild, (lang) => heldNotice(result.held.rows, lang), "officer");
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
