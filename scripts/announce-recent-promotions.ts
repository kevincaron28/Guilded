// One-off backfill (20 November 2026): post the congratulations for promotions of the last 7 days, once each, through the same Discord job as
// the live post (queuePromotionCongrats in src/services/promotion.ts, so a promotion already posted that day is skipped).
//   npx tsx scripts/announce-recent-promotions.ts [--days 7]            dry run: lists what would be posted
//   npx tsx scripts/announce-recent-promotions.ts [--days 7] --apply    queues the posts (the running bot delivers them)
// Data source: the game's own guild event log (GuildEventEntry, kind "promote", filled by every member's addon upload). An event gives the
// character, the NEW rank and a time that is only accurate to a few hours (the game reports ages in whole hours). It needs the character to
// be linked to a Discord member, a congratulations channel (announcements, else hall of fame) and the switch on; the Alt rank is never posted,
// and a promotion followed by a later demotion of the same character is skipped. Prints names only, never Discord ids. Never run without the owner's yes.
import { createPrismaClient } from "../src/database.js";
import { cleanCharacterName } from "../src/services/character-display.js";
import { isAltRank, promotionCongratsChannel, queuePromotionCongrats } from "../src/services/promotion.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const dayArg = args.indexOf("--days");
const days = Math.max(1, Math.min(30, Number(dayArg >= 0 ? args[dayArg + 1] : 7) || 7));
const since = new Date(Date.now() - days * 86_400_000);
const prisma = createPrismaClient();

try {
  const guilds = await prisma.guild.findMany({ select: { id: true, name: true, gameEdition: true, settings: { select: { language: true, promotionCongratsEnabled: true } } } });
  let total = 0;
  for (const guild of guilds) {
    if (guild.settings?.promotionCongratsEnabled === false) continue;
    const edition = guild.gameEdition ?? "forever";
    const events = await prisma.guildEventEntry.findMany({ where: { guildId: guild.id, gameEdition: edition, kind: { in: ["promote", "demote"] }, at: { gte: since } }, orderBy: { at: "asc" } });
    const promotions = events.filter((e) => e.kind === "promote" && e.target && e.rank && !isAltRank(e.rank));
    if (!promotions.length) continue;
    const channelId = await promotionCongratsChannel(prisma, guild.id);
    if (!channelId) { console.log(`${guild.name}: ${promotions.length} promotion(s) but no congratulations channel, skipped.`); continue; }
    const lang = guild.settings?.language === "fr" ? "fr" : "en";
    const characters = await prisma.character.findMany({ where: { member: { guildId: guild.id }, gameEdition: edition }, select: { name: true, member: { select: { discordUserId: true, displayName: true } } } });
    console.log(`${guild.name}: ${promotions.length} promotion(s) in the last ${days} day(s), channel found.`);
    for (const event of promotions) {
      const target = event.target!.toLowerCase();
      const label = `${cleanCharacterName(event.target!)} -> ${event.rank} (${event.at.toISOString().slice(0, 16)}Z)`;
      if (events.some((e) => e.kind === "demote" && (e.target ?? "").toLowerCase() === target && e.at > event.at)) { console.log(`  skip (demoted since): ${label}`); continue; }
      const owner = characters.find((c) => c.name.toLowerCase() === target)?.member;
      if (!owner) { console.log(`  skip (not linked): ${label}`); continue; }
      if (!apply) { console.log(`  would post: ${label} for ${owner.displayName}`); total++; continue; }
      const queued = await queuePromotionCongrats(prisma, guild.id, channelId, lang, { userId: owner.discordUserId, memberName: owner.displayName, name: event.target!, rankName: event.rank!, at: event.at });
      console.log(`  ${queued ? "queued" : "already posted"}: ${label}`);
      if (queued) total++;
    }
  }
  console.log(`${apply ? "Queued" : "Would post"} ${total}.${apply ? "" : " Dry run: add --apply to queue them."}`);
} finally {
  await prisma.$disconnect();
}
