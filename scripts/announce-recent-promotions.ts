// One-off backfill (20 November 2026): post the congratulations for promotions of the last 7 days, once each, through the same Discord job as
// the live post (queuePromotionCongrats in src/services/promotion.ts, so a promotion already posted that day is skipped).
//   npx tsx scripts/announce-recent-promotions.ts [--days 7]            dry run: lists what would be posted
//   npx tsx scripts/announce-recent-promotions.ts [--days 7] --apply    queues the posts (the running bot delivers them)
//   add --recap for ONE post per server instead (owner choice, 20 Nov 2026): each member's final rank once, names shown, nobody pinged.
// Data source: the game's own guild event log (GuildEventEntry, kind "promote", filled by every member's addon upload). An event gives the
// character, the NEW rank and a time that is only accurate to a few hours (the game reports ages in whole hours). It needs the character to
// be linked to a Discord member, a congratulations channel (announcements, else hall of fame) and the switch on; the Alt rank is never posted,
// and a promotion followed by a later demotion of the same character is skipped. Prints names only, never Discord ids. Never run without the owner's yes.
import { createPrismaClient } from "../src/database.js";
import { cleanCharacterName } from "../src/services/character-display.js";
import { isAltRank, promotionCongratsChannel, queuePromotionCongrats } from "../src/services/promotion.js";
import { enqueueDiscordJob } from "../src/services/discord-jobs.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const recap = args.includes("--recap");
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
    if (recap) {
      // Final rank per character: the latest promotion wins, and one followed by a demotion is dropped.
      const latest = new Map<string, (typeof promotions)[number]>();
      for (const event of promotions) latest.set(event.target!.toLowerCase(), event);
      const lines: string[] = [];
      for (const [target, event] of latest) {
        const label = `${cleanCharacterName(event.target!)} -> ${event.rank}`;
        if (events.some((e) => e.kind === "demote" && (e.target ?? "").toLowerCase() === target && e.at > event.at)) { console.log(`  skip (demoted since): ${label}`); continue; }
        const owner = characters.find((c) => c.name.toLowerCase() === target)?.member;
        if (!owner || !/^d{17,20}$/.test(owner.discordUserId)) { console.log(`  skip (not linked): ${label}`); continue; }
        lines.push(`<@${owner.discordUserId}> (${cleanCharacterName(event.target!)}) → **${event.rank}**`);
        console.log(`  in recap: ${label} for ${owner.displayName}`);
      }
      if (!lines.length) continue;
      let description = "";
      for (const [i, line] of lines.entries()) {
        const more = lines.length - i;
        if (description.length + line.length + 40 > 4000) { description += lang === "fr" ? `… et ${more} de plus` : `… and ${more} more`; break; }
        description += line + "
";
      }
      const title = lang === "fr" ? `🎉 Promotions des ${days} derniers jours` : `🎉 Promotions from the last ${days} days`;
      const footer = lang === "fr" ? "Promotions vues dans le jeu. Félicitations à tous !" : "Promotions seen in the game. Congratulations, everyone!";
      total += lines.length;
      if (!apply) continue;
      const key = `promotion-recap:${since.toISOString().slice(0, 10)}:${new Date().toISOString().slice(0, 10)}`;
      if (await prisma.discordJob.findUnique({ where: { guildId_key: { guildId: guild.id, key } }, select: { id: true } })) { console.log("  recap already queued today"); continue; }
      await enqueueDiscordJob(prisma, guild.id, key, "MESSAGE", { channelId, message: { embeds: [{ title, description: description.trimEnd(), color: 0xc9a227, footer: { text: footer } }] }, mentionUsers: [] });
      console.log(`  recap queued (${lines.length} member(s))`);
      continue;
    }
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
