// One-off backfill (20 November 2026): post the congratulations for promotions of the last 7 days, once each, through the same Discord job as
// the live post (queuePromotionCongrats in src/services/promotion.ts, so a promotion already posted that day is skipped).
//   npx tsx scripts/announce-recent-promotions.ts [--days 7]                 dry run: lists what would be posted, and where
//   npx tsx scripts/announce-recent-promotions.ts [--days 7] --apply         queues the posts (the running bot delivers them)
//   add --spread <hours> to release the cards gradually: every card is queued now but job i is not delivered before now + i * hours / n
//     (oldest promotion first, the first one right away). The dry run prints each planned time.
//   add --recap for ONE post per server instead (owner choice, 20 Nov 2026): each member's final rank once, names shown, nobody pinged.
// Default mode: one card post per member (text pinging only that member, plus the rank-tier card) in the community chat channel
// (findCommunityChatChannelId: the chat channel of the Community category, read through the Discord REST API with the bot token, no client
// started), else the announcements / hall-of-fame channel. Each character is posted at its FINAL rank of the window only.
// Data source: the game's own guild event log (GuildEventEntry, kind "promote", filled by every member's addon upload). An event gives the
// character, the NEW rank and a time that is only accurate to a few hours (the game reports ages in whole hours). It needs the character to
// be linked to a Discord member, a channel and the switch on; the Alt rank is never posted, and a promotion followed by a later demotion of
// the same character is skipped. Prints names only, never Discord ids. Never run without the owner's yes.
import { REST, Routes } from "discord.js";
import { createPrismaClient } from "../src/database.js";
import { cleanCharacterName } from "../src/services/character-display.js";
import { isAltRank, promotionCongratsChannel, queuePromotionCongrats, spreadSchedule, type ChannelLike } from "../src/services/promotion.js";
import { enqueueDiscordJob } from "../src/services/discord-jobs.js";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const recap = args.includes("--recap");
const dayArg = args.indexOf("--days");
const days = Math.max(1, Math.min(30, Number(dayArg >= 0 ? args[dayArg + 1] : 7) || 7));
const spreadArg = args.indexOf("--spread");
const spreadHours = spreadArg >= 0 ? Math.max(0, Math.min(72, Number(args[spreadArg + 1]) || 0)) : 0;
const since = new Date(Date.now() - days * 86_400_000);
const prisma = createPrismaClient();
const rest = new REST({ version: "10" }).setToken(process.env["DISCORD_TOKEN"] ?? "");

/** The server's channels from Discord (REST), reduced to what the chat lookup needs. Empty when unreachable: the fallback channels apply. */
async function restChannels(discordGuildId: string): Promise<ChannelLike[]> {
  try {
    const rows = (await rest.get(Routes.guildChannels(discordGuildId))) as { id: string; name?: string; type: number; parent_id?: string | null }[];
    return rows.map((c) => ({ id: c.id, name: c.name ?? null, type: c.type, parentId: c.parent_id ?? null }));
  } catch (error) {
    console.log(`  (could not read the server's channels: ${error instanceof Error ? error.message : "error"})`);
    return [];
  }
}

try {
  const guilds = await prisma.guild.findMany({ select: { id: true, discordId: true, name: true, gameEdition: true, settings: { select: { language: true, promotionCongratsEnabled: true } } } });
  let total = 0;
  for (const guild of guilds) {
    if (guild.settings?.promotionCongratsEnabled === false) continue;
    const edition = guild.gameEdition ?? "forever";
    const events = await prisma.guildEventEntry.findMany({ where: { guildId: guild.id, gameEdition: edition, kind: { in: ["promote", "demote"] }, at: { gte: since } }, orderBy: { at: "asc" } });
    const promotions = events.filter((e) => e.kind === "promote" && e.target && e.rank && !isAltRank(e.rank));
    if (!promotions.length) continue;
    const channels = await restChannels(guild.discordId);
    const channelId = await promotionCongratsChannel(prisma, guild.id, channels);
    if (!channelId) { console.log(`${guild.name}: ${promotions.length} promotion(s) but no congratulations channel, skipped.`); continue; }
    const lang = guild.settings?.language === "fr" ? "fr" : "en";
    const characters = await prisma.character.findMany({ where: { member: { guildId: guild.id }, gameEdition: edition }, select: { name: true, member: { select: { discordUserId: true, displayName: true } } } });
    console.log(`${guild.name}: ${promotions.length} promotion(s) in the last ${days} day(s), channel #${channels.find((c) => c.id === channelId)?.name ?? "(announcements or hall of fame)"}.`);

    // Final rank per character: the latest promotion wins, and one followed by a demotion is dropped; unlinked characters are dropped.
    const latest = new Map<string, (typeof promotions)[number]>();
    for (const event of promotions) latest.set(event.target!.toLowerCase(), event);
    const finals: { event: (typeof promotions)[number]; owner: { discordUserId: string; displayName: string }; label: string }[] = [];
    for (const [target, event] of [...latest].sort((a, b) => a[1].at.getTime() - b[1].at.getTime())) {
      const label = `${cleanCharacterName(event.target!)} -> ${event.rank} (${event.at.toISOString().slice(0, 16)}Z)`;
      if (events.some((e) => e.kind === "demote" && (e.target ?? "").toLowerCase() === target && e.at > event.at)) { console.log(`  skip (demoted since): ${label}`); continue; }
      const owner = characters.find((c) => c.name.toLowerCase() === target)?.member;
      if (!owner || !/^\d{17,20}$/.test(owner.discordUserId)) { console.log(`  skip (not linked): ${label}`); continue; }
      finals.push({ event, owner, label });
    }

    if (recap) {
      const lines = finals.map((f) => `<@${f.owner.discordUserId}> (${cleanCharacterName(f.event.target!)}) → **${f.event.rank}**`);
      for (const f of finals) console.log(`  in recap: ${f.label} for ${f.owner.displayName}`);
      if (!lines.length) continue;
      let description = "";
      for (const [i, line] of lines.entries()) {
        const more = lines.length - i;
        if (description.length + line.length + 40 > 4000) { description += lang === "fr" ? `… et ${more} de plus` : `… and ${more} more`; break; }
        description += `${line}\n`;
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

    // One card each, released evenly across --spread hours (card i at now + i * hours / n), oldest promotion first.
    const times = spreadSchedule(finals.length, spreadHours);
    for (const [i, f] of finals.entries()) {
      const notBefore = times[i];
      const when = notBefore ? ` at ${notBefore.toISOString().slice(0, 16)}Z` : "";
      if (!apply) { console.log(`  would post${when}: ${f.label} for ${f.owner.displayName}`); total++; continue; }
      const queued = await queuePromotionCongrats(prisma, guild.id, channelId, lang, { userId: f.owner.discordUserId, memberName: f.owner.displayName, name: f.event.target!, rankName: f.event.rank!, at: f.event.at }, notBefore);
      console.log(`  ${queued ? `queued${when}` : "already posted"}: ${f.label}`);
      if (queued) total++;
    }
  }
  console.log(`${apply ? "Queued" : "Would post"} ${total}.${apply ? "" : " Dry run: add --apply to queue them."}`);
} finally {
  await prisma.$disconnect();
}
