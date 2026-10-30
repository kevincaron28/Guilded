import { EmbedBuilder, escapeMarkdown } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { Lang } from "../i18n.js";
import { reportWeek } from "./weekly-report.js";

type Db = Pick<PrismaClient, "member" | "dungeonPointTransaction" | "dungeonAchievement" | "communityBadge" | "raidSignup">;

/** Private recap for on-demand or explicitly approved delivery. Resolve the member from the authenticated Discord actor and
 * existing guild scope; no arbitrary member selector or public report fallback. */
export async function personalWeeklyRecap(database: Db, guildId: string, discordUserId: string, now = new Date(), canViewChannel?: (channelId: string) => Promise<boolean>) {
  const member = await database.member.findFirst({ where: { guildId, discordUserId }, select: { id: true } });
  if (!member) throw new Error("Your member record is not available in this guild.");
  const { start, end } = reportWeek(now);
  const window = { gte: start, lt: end };
  const [points, dungeonBadges, communityBadges, signups] = await Promise.all([
    database.dungeonPointTransaction.aggregate({ where: { guildId, memberId: member.id, createdAt: window }, _sum: { amount: true }, _count: true }),
    database.dungeonAchievement.findMany({ where: { guildId, memberId: member.id, earnedAt: window, revokedAt: null }, select: { key: true, earnedAt: true }, orderBy: [{ earnedAt: "asc" }, { id: "asc" }], take: 11 }),
    database.communityBadge.findMany({ where: { userId: discordUserId, season: { guildId }, earnedAt: window, source: { in: ["LEDGER", "REVIEW"] } }, select: { code: true, earnedAt: true }, orderBy: [{ earnedAt: "asc" }, { id: "asc" }], take: 11 }),
    database.raidSignup.findMany({ where: { memberId: member.id, status: { in: ["SIGNED_UP", "MAYBE", "WAITLISTED"] },
      raid: { guildId, isTest: false, status: "PLANNED", scheduledAt: { gte: now, lt: new Date(now.getTime() + 7 * 86_400_000) } } },
      select: { status: true, raid: { select: { title: true, scheduledAt: true, signupChannelId: true } } }, orderBy: [{ raid: { scheduledAt: "asc" } }, { id: "asc" }], take: 6 })
  ]);
  const visibleSignups = [];
  for (const signup of signups) if (!canViewChannel || signup.raid.signupChannelId && await canViewChannel(signup.raid.signupChannelId)) visibleSignups.push(signup);
  return { start, end, netParticipationPoints: points._sum.amount ?? 0, pointEntries: points._count,
    dungeonBadges: dungeonBadges.slice(0, 10), communityBadges: communityBadges.slice(0, 10), signups: visibleSignups.slice(0, 5),
    moreBadges: dungeonBadges.length > 10 || communityBadges.length > 10, moreSignups: visibleSignups.length > 5 };
}

export function personalWeeklyRecapEmbed(recap: Awaited<ReturnType<typeof personalWeeklyRecap>>, lang: Lang) {
  const fr = lang === "fr";
  const badgeCodes = [...recap.dungeonBadges.map(row => row.key), ...recap.communityBadges.map(row => row.code)];
  const badgeText = badgeCodes.map(code => escapeMarkdown(code).slice(0, 80)).join(", ").slice(0, 900);
  const signupStatus = { SIGNED_UP: fr ? "Inscrit" : "Signed up", MAYBE: fr ? "Peut-être" : "Maybe", WAITLISTED: fr ? "Liste d’attente" : "Waitlisted" };
  return new EmbedBuilder().setColor(0x57a773).setTitle(fr ? "Mon bilan hebdomadaire" : "My weekly recap")
    .setDescription(`<t:${Math.floor(recap.start.getTime() / 1000)}:d> – <t:${Math.floor(recap.end.getTime() / 1000)}:d>\n`
      + (fr ? "Dernière semaine complète, selon les données enregistrées." : "Last complete week, based on recorded data."))
    .addFields(
      { name: fr ? "Participation aux donjons" : "Dungeon participation", value: `${recap.netParticipationPoints} ${fr ? "points nets" : "net points"} · ${recap.pointEntries} ${fr ? "écritures" : "entries"}` },
      { name: fr ? "Badges gagnés" : "Earned badges", value: (badgeText || (fr ? "Aucun enregistré cette semaine." : "None recorded this week.")) + (recap.moreBadges ? " …" : "") },
      { name: fr ? "Mes inscriptions · 7 prochains jours" : "My signups · next 7 days", value: recap.signups.map(row =>
        `${escapeMarkdown(row.raid.title).slice(0, 100)} · <t:${Math.floor(row.raid.scheduledAt.getTime() / 1000)}:f> · ${signupStatus[row.status as keyof typeof signupStatus] ?? row.status}`).join("\n").slice(0, 950)
        + (recap.moreSignups ? "\n…" : "") || (fr ? "Aucune inscription enregistrée." : "No signups recorded.") })
    .setFooter({ text: fr ? "Aperçu privé sur demande · Envoi automatique désactivé" : "Private on-demand preview · Automatic delivery is off" });
}
