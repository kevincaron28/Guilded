import type { PrismaClient } from "../generated/prisma/client.js";
import type { Filters, Role } from "./recruitment.js";

export interface PublicRaid {
  id: string; title: string; guildName: string; guildDiscordId: string; coreName: string | null;
  scheduledAt: string; realm: string; faction: string; language: string;
  spots: Record<Role, number>; signupUrl: string; inviteUrl: string;
}

export function discordInvite(value: string): string | null {
  return /^https:\/\/(?:discord\.gg\/|discord\.com\/invite\/)[a-z0-9-]{2,100}$/i.test(value.trim()) ? value.trim() : null;
}

export function openRaidSpots(raid: {
  tankLimit: number | null; healerLimit: number | null; dpsLimit: number | null;
  signups: { role: string; status: string }[];
}): Record<Role, number> {
  const taken = (role: Role) => raid.signups.filter(s => s.role === role && s.status === "SIGNED_UP").length;
  // An unspecified cap is unknown, never an advertised unlimited vacancy.
  return {
    TANK: Math.max(0, (raid.tankLimit ?? 0) - taken("TANK")),
    HEALER: Math.max(0, (raid.healerLimit ?? 0) - taken("HEALER")),
    DPS: Math.max(0, (raid.dpsLimit ?? 0) - taken("DPS"))
  };
}

export async function publicRaids(database: Pick<PrismaClient, "raid">, allows: (id: string) => boolean, now = new Date()): Promise<PublicRaid[]> {
  const raids = await database.raid.findMany({
    where: { publicPug: true, isTest: false, status: "PLANNED", scheduledAt: { gt: now, lte: new Date(now.getTime() + 30 * 86_400_000) } },
    select: {
      id: true, title: true, scheduledAt: true, tankLimit: true, healerLimit: true, dpsLimit: true,
      pugRealm: true, pugFaction: true, pugLanguage: true, pugInviteUrl: true,
      signupChannelId: true, signupMessageId: true,
      guild: { select: { name: true, discordId: true } }, core: { select: { name: true } },
      signups: { select: { role: true, status: true } }
    },
    orderBy: [{ scheduledAt: "asc" }, { id: "asc" }]
  });
  return raids.flatMap(raid => {
    if (!allows(raid.guild.discordId) || !raid.pugRealm || !raid.pugFaction || !raid.pugLanguage
      || !raid.pugInviteUrl || !discordInvite(raid.pugInviteUrl) || !raid.signupChannelId || !raid.signupMessageId) return [];
    const spots = openRaidSpots(raid);
    if (!Object.values(spots).some(n => n > 0)) return [];
    return [{
      id: raid.id, title: raid.title, guildName: raid.guild.name, guildDiscordId: raid.guild.discordId,
      coreName: raid.core?.name ?? null, scheduledAt: raid.scheduledAt.toISOString(),
      realm: raid.pugRealm, faction: raid.pugFaction, language: raid.pugLanguage, spots,
      signupUrl: `https://discord.com/channels/${raid.guild.discordId}/${raid.signupChannelId}/${raid.signupMessageId}`,
      inviteUrl: raid.pugInviteUrl
    }];
  }).slice(0, 100);
}

export function publicRaidMatches(raid: PublicRaid, filters: Filters): boolean {
  return (filters.kind === "all" || filters.kind === "raids")
    && (!filters.role || raid.spots[filters.role] > 0)
    && (!filters.faction || raid.faction === filters.faction)
    && (!filters.language || raid.language === "both" || raid.language === filters.language)
    && (!filters.realm || raid.realm.toLocaleLowerCase() === filters.realm.toLocaleLowerCase());
}
