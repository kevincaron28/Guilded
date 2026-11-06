import type { PrismaClient } from "../generated/prisma/client.js";
import { ACTIVE_EDITIONS } from "../../companion/active-editions.mjs";

// The plain status a member sees on /me/, in the Discord welcome message and (later) in the app:
// Connected / Last synced / What to do next. No jargon, one next step.

export interface LinkStatus {
  battleNet: boolean;
  companion: boolean;
  characters: number;
  lastSynced: Date | null;
}
export type NextStep = "connect" | "characters" | "sync" | "done";

/** The newest of several dates, or null. */
function newest(...dates: (Date | null | undefined)[]): Date | null {
  return dates.reduce<Date | null>((best, date) => date instanceof Date && (!best || date > best) ? date : best, null);
}

export async function memberLinkStatus(database: PrismaClient, discordUserId: string, guildId?: string): Promise<LinkStatus> {
  const memberWhere = { discordUserId, ...(guildId ? { guildId } : {}), status: { not: "LEFT" as const } };
  const [battleNet, webDevices, memberDevices, characters, seen, webSynced, memberSynced] = await Promise.all([
    database.battleNetIdentity.count({ where: { account: { discordUserId } } }),
    database.webCompanionCredential.count({ where: { revokedAt: null, account: { discordUserId } } }),
    database.companionCredential.count({ where: { revokedAt: null, member: memberWhere } }),
    database.character.count({ where: { member: memberWhere } }),
    database.character.findFirst({ where: { member: memberWhere }, orderBy: { lastSeenAt: "desc" }, select: { lastSeenAt: true } }),
    // A companion upload does not always touch a character's lastSeenAt: the device's own last sync
    // counts too, so "Last synced: Not yet" never shows right after a sync.
    guildId ? null : database.webCompanionCredential.findFirst({ where: { revokedAt: null, account: { discordUserId }, lastUsedAt: { not: null } }, orderBy: { lastUsedAt: "desc" }, select: { lastUsedAt: true } }),
    database.companionCredential.findFirst({ where: { revokedAt: null, member: memberWhere, lastUsedAt: { not: null } }, orderBy: { lastUsedAt: "desc" }, select: { lastUsedAt: true } })
  ]);
  return { battleNet: battleNet > 0, companion: webDevices + memberDevices > 0, characters, lastSynced: newest(seen?.lastSeenAt, webSynced?.lastUsedAt, memberSynced?.lastUsedAt) };
}

export function nextStep(status: LinkStatus): NextStep {
  // The app is connected but no character is linked yet: never tell them to install it again.
  if (!status.characters && !status.battleNet) return status.companion ? "characters" : "connect";
  if (!status.companion) return "sync";
  return "done";
}

const ago = (date: Date, now: Date, fr: boolean) => {
  const hours = Math.floor((now.getTime() - date.getTime()) / 3_600_000);
  if (hours < 1) return fr ? "il y a moins d'une heure" : "less than an hour ago";
  if (hours < 48) return fr ? `il y a ${hours} h` : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return fr ? `il y a ${days} jours` : `${days} days ago`;
};

/**
 * Battle.net only helps for editions Blizzard's API can answer for. While WoW Forever is the only
 * edition offered (companion/active-editions.mjs) it knows none of their characters, so "Press
 * Connect Battle.net" would send a new member down a dead end: the app is the way in.
 */
export const battleNetUseful = (active: readonly string[] = ACTIVE_EDITIONS) => active.some((edition) => edition !== "forever");

/** Three short lines, English or French. */
export function linkStatusLines(status: LinkStatus, lang: "en" | "fr", now = new Date(), useBattleNet = battleNetUseful()): string[] {
  const fr = lang === "fr";
  const parts = [status.battleNet ? "Battle.net" : "", status.companion ? (fr ? "application Guilded" : "Guilded app") : ""].filter(Boolean);
  const connected = parts.length ? parts.join(" + ") : (fr ? "Pas encore" : "Not yet");
  const synced = status.lastSynced ? ago(status.lastSynced, now, fr) : (fr ? "Pas encore" : "Not yet");
  const step = nextStep(status);
  const next = {
    connect: !useBattleNet
      ? (fr ? "Installe l'application Windows Guilded et connecte-toi avec Discord : tes personnages se lient tout seuls." : "Get the Guilded Windows app and sign in with Discord: your characters link themselves.")
      : fr ? "Appuie sur « Connecter Battle.net »." : "Press “Connect Battle.net”.",
    characters: fr
      ? "Ton application est connectée. Rejoins le serveur Discord de ta guilde qui utilise Guilded, puis appuie sur Relier dans l'application ; sinon connecte-toi à WoW et tape /reload."
      : "Your app is connected. Join your guild's Discord server that uses Guilded, then press Link in the app; otherwise log in to WoW and type /reload.",
    sync: fr ? "Ouvre l'application Guilded et connecte-toi avec Discord pour que tout se synchronise tout seul." : "Open the Guilded app and sign in with Discord so everything syncs by itself.",
    done: fr ? "Rien. Tout est prêt." : "Nothing. You're all set."
  }[step];
  return fr
    ? [`**Connecté :** ${connected}`, `**Dernière synchronisation :** ${synced}`, `**À faire :** ${next}`]
    : [`**Connected:** ${connected}`, `**Last synced:** ${synced}`, `**What to do next:** ${next}`];
}
