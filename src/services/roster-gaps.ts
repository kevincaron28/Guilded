import type { Guild as DiscordGuild } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { displayCharacterName, fullNameBook } from "./character-display.js";
import { cacheAllMembers } from "./member-cache.js";
import { officerSyncRecent } from "./officer-sync.js";
import { characterTrustMap } from "./character-trust.js";

// 8.5 track C1: who is in Discord but not in the WoW guild, who has not linked a character, and which guild
// characters nobody has claimed. Read-only: it never messages or changes anyone (the "ask them to link" button
// in commands/roster.ts is an officer's explicit click).
//
// "In the guild" means a linked character whose in-game rank was refreshed by an officer's upload within 14 days
// (Character.guildRankAt, the same freshness rule as rank roles). Without a recent officer upload every list
// would be wrong, so the report says so instead of guessing.

export const GAP_FRESH_MS = 14 * 24 * 3600_000;

export interface GapDiscordMember { discordUserId: string; displayName: string; isBot: boolean; roleIds: readonly string[] }
export interface GapCharacter { discordUserId: string; name: string; isMain: boolean; guildRankAt: Date | null }
export interface GapUnclaimed { name: string; className: string; level: number | null; lastSeenAt: Date }

export interface NotInGuild { discordUserId: string; displayName: string; inviteName: string; others: string[] }
export interface RosterGaps {
  /** Linked character, but none of them is in the guild roster. */
  notInGuild: NotInGuild[];
  /** No linked character at all. */
  noLink: { discordUserId: string; displayName: string }[];
  /** In the guild roster, linked to nobody in Discord. */
  unclaimed: { name: string; className: string; level: number | null }[];
  /** False when no officer upload is recent: the lists above cannot be trusted. */
  syncFresh: boolean;
  /** Zero-setup companions (no Discord sign-in): characters they reported that no member has linked. */
  fromCompanions?: { name: string; level: number | null }[];
  /** Members counted (not bots, not ignored roles). */
  considered: number;
  /** 9.1: linked characters only reported, not verified (character-trust.ts); omitted = not checked. */
  reported?: { name: string; displayName: string }[];
}

/** A name safe to paste after /ginvite (Forever names are "First Last"): no line breaks or backticks. */
export function inviteName(name: string): string {
  return name.replace(/[\p{Cc}`]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 40);
}

export function inviteLines(rows: readonly Pick<NotInGuild, "inviteName">[]): string[] {
  return rows.map((row) => `/ginvite ${row.inviteName}`);
}

export function planRosterGaps(input: {
  members: readonly GapDiscordMember[]; characters: readonly GapCharacter[]; unclaimed: readonly GapUnclaimed[];
  ignoredRoleIds?: readonly string[]; syncFresh: boolean; now?: Date;
}): RosterGaps {
  const now = (input.now ?? new Date()).getTime();
  const fresh = (at: Date | null) => at !== null && now - at.getTime() <= GAP_FRESH_MS;
  const ignored = new Set(input.ignoredRoleIds ?? []);
  const byUser = new Map<string, GapCharacter[]>();
  for (const character of input.characters) byUser.set(character.discordUserId, [...(byUser.get(character.discordUserId) ?? []), character]);
  const notInGuild: NotInGuild[] = [], noLink: RosterGaps["noLink"] = [];
  let considered = 0;
  for (const member of input.members) {
    if (member.isBot || member.roleIds.some((id) => ignored.has(id))) continue;
    considered++;
    const characters = byUser.get(member.discordUserId) ?? [];
    if (!characters.length) { noLink.push({ discordUserId: member.discordUserId, displayName: member.displayName }); continue; }
    if (characters.some((character) => fresh(character.guildRankAt))) continue;
    // Invite the main first, then the rest by name.
    const ordered = [...characters].sort((a, b) => Number(b.isMain) - Number(a.isMain) || a.name.localeCompare(b.name));
    notInGuild.push({ discordUserId: member.discordUserId, displayName: member.displayName, inviteName: inviteName(ordered[0]!.name), others: ordered.slice(1).map((c) => inviteName(c.name)) });
  }
  const by = (a: { displayName: string }, b: { displayName: string }) => a.displayName.localeCompare(b.displayName);
  notInGuild.sort(by); noLink.sort(by);
  const unclaimed = input.unclaimed.filter((row) => fresh(row.lastSeenAt)).map(({ name, className, level }) => ({ name, className, level }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { notInGuild, noLink, unclaimed, syncFresh: input.syncFresh, considered };
}

type Db = Pick<PrismaClient, "member" | "unclaimedCharacter" | "guild" | "guildSettings" | "characterVerifyClaim">;

/** Loads the three lists for one server. Needs the member list (it pages through REST, see member-cache.ts). */
export async function loadRosterGaps(db: Db, discordGuild: Pick<DiscordGuild, "members" | "memberCount">, guildId: string, edition: string, now = new Date()): Promise<RosterGaps> {
  await cacheAllMembers(discordGuild).catch(() => undefined);
  const [people, unclaimed, guild, settings] = await Promise.all([
    db.member.findMany({
      where: { guildId, status: "ACTIVE", isTest: false },
      select: { discordUserId: true, displayName: true, characters: { where: { gameEdition: edition }, select: { id: true, memberId: true, realm: true, gameEdition: true, confirmedAt: true, name: true, displayName: true, isMain: true, guildRankAt: true } } }
    }),
    db.unclaimedCharacter.findMany({ where: { guildId, gameEdition: edition }, select: { name: true, displayName: true, className: true, level: true, lastSeenAt: true } }),
    db.guild.findUnique({ where: { id: guildId }, select: { officerSyncAt: true } }),
    db.guildSettings.findUnique({ where: { guildId }, select: { rosterIgnoredRoleIds: true } })
  ]);
  const book = fullNameBook([...people.flatMap((person) => person.characters), ...unclaimed]);
  const characters = people.flatMap((person) => person.characters.map((c) => ({ discordUserId: person.discordUserId, name: displayCharacterName(c, book), isMain: c.isMain, guildRankAt: c.guildRankAt })));
  const members = [...discordGuild.members.cache.values()].map((m) => ({ discordUserId: m.id, displayName: m.displayName, isBot: m.user.bot, roleIds: [...m.roles.cache.keys()] }));
  const gaps = planRosterGaps({
    members, characters, unclaimed: unclaimed.map((u) => ({ name: displayCharacterName(u, book), className: u.className, level: u.level, lastSeenAt: u.lastSeenAt })),
    ignoredRoleIds: settings?.rosterIgnoredRoleIds ?? [], syncFresh: officerSyncRecent(guild?.officerSyncAt), now
  });
  const trust = await characterTrustMap(db, guildId, people.flatMap((person) => person.characters)).catch(() => null);
  if (trust) gaps.reported = people.flatMap((person) => person.characters.filter((c) => trust.get(c.id) === "reported")
    .map((c) => ({ name: displayCharacterName(c, book), displayName: person.displayName }))).sort((a, b) => a.name.localeCompare(b.name));
  return gaps;
}

/** The three lists as Discord text, in English or French; every line capped so the message stays under 2000 characters. */
export function formatRosterGaps(gaps: RosterGaps, lang: "en" | "fr"): { text: string; invites: string } {
  const t = (en: string, fr: string) => lang === "fr" ? fr : en;
  const lines: string[] = [];
  if (!gaps.syncFresh) lines.push(t("⚠️ No officer upload in the last 14 days: \"not in the guild\" may be wrong. Run the companion as an officer first.", "⚠️ Aucun envoi d'officier depuis 14 jours : « hors de la guilde » peut être inexact. Lance d'abord le compagnon en tant qu'officier."));
  const invites = inviteLines(gaps.notInGuild);
  lines.push(`**${t("In Discord, not in the guild", "Dans Discord, pas dans la guilde")}** (${gaps.notInGuild.length})`);
  lines.push(...gaps.notInGuild.slice(0, 15).map((row) => `• ${row.displayName.slice(0, 32)} — \`/ginvite ${row.inviteName}\`${row.others.length ? ` (+${row.others.length})` : ""}`));
  if (gaps.notInGuild.length > 15) lines.push(t(`…and ${gaps.notInGuild.length - 15} more (all in the copy block below).`, `… et ${gaps.notInGuild.length - 15} autres (tous dans le bloc à copier).`));
  lines.push("", `**${t("No linked character", "Aucun personnage lié")}** (${gaps.noLink.length})`);
  lines.push(...(gaps.noLink.length ? [gaps.noLink.slice(0, 20).map((row) => row.displayName.slice(0, 24)).join(", ") + (gaps.noLink.length > 20 ? ` +${gaps.noLink.length - 20}` : "")] : ["—"]));
  lines.push("", `**${t("In the guild, nobody claimed", "Dans la guilde, personne ne l'a réclamé")}** (${gaps.unclaimed.length})`);
  lines.push(...(gaps.unclaimed.length ? [gaps.unclaimed.slice(0, 20).map((row) => `${row.name}${row.level ? ` ${row.level}` : ""}`).join(", ") + (gaps.unclaimed.length > 20 ? ` +${gaps.unclaimed.length - 20}` : "")] : ["—"]));
  if (gaps.reported) {
    // Linked, but only reported: an officer's companion sync or the member's own app upload confirms it.
    lines.push("", `**${t("Linked, reported but not verified", "Liés, signalés mais non vérifiés")}** (${gaps.reported.length})`);
    lines.push(gaps.reported.length
      ? gaps.reported.slice(0, 15).map((row) => `${row.name} (${row.displayName.slice(0, 20)})`).join(", ") + (gaps.reported.length > 15 ? ` +${gaps.reported.length - 15}` : "")
        + `\n-# ${t("Confirmed when the member syncs with their own Guilded app, an officer links it, or an officer's sync hears their /guilded verify code.", "Confirmé quand le membre synchronise avec sa propre application Guilded, qu'un officier le lie, ou que la synchro d'un officier entend son code /guilded verify.")}`
      : "—");
  }
  if (gaps.fromCompanions?.length) {
    // docs/ZERO_SETUP_COMPANION.md: reported only; the member's Discord sign-in in that companion confirms them.
    lines.push("", `**${t("Reported by a companion without Discord sign-in", "Signalés par un compagnon sans connexion Discord")}** (${gaps.fromCompanions.length})`);
    lines.push(gaps.fromCompanions.slice(0, 20).map((row) => `${row.name}${row.level ? ` ${row.level}` : ""}`).join(", ") + (gaps.fromCompanions.length > 20 ? ` +${gaps.fromCompanions.length - 20}` : ""));
  }
  return { text: lines.join("\n").slice(0, 1900), invites: invites.join("\n") };
}
