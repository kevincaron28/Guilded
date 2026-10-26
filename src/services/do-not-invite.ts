import type { Guild as DiscordGuild } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { prisma } from "../database.js";
import { postToLogChannel } from "./housekeeping.js";

// The officers' shared "do not invite" list. Officer-only: entries are never shown to members.
// A match only warns the officer log (an application, someone joining the Discord); nothing is
// blocked, kicked or hidden automatically.
export interface DniEntry { id: string; name: string; realm: string | null; discordUserId: string | null; reason: string; addedBy: string; createdAt: Date }
export interface DniCandidate { discordUserId?: string | null; names?: string[] }

const fold = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
const realmKey = (value: string) => fold(value).replace(/[\s'-]/g, "");

// "Name", "Name-Realm" or "First Last-Realm": the realm is after the last hyphen.
function splitCharacter(value: string): { name: string; realm: string | null } {
  const at = value.lastIndexOf("-");
  return at > 0 ? { name: fold(value.slice(0, at)), realm: realmKey(value.slice(at + 1)) || null } : { name: fold(value), realm: null };
}

export function dniMatches(entries: DniEntry[], candidate: DniCandidate): DniEntry[] {
  const names = (candidate.names ?? []).filter(Boolean).map(splitCharacter);
  return entries.filter((entry) => {
    if (entry.discordUserId && candidate.discordUserId && entry.discordUserId === candidate.discordUserId) return true;
    const name = fold(entry.name), realm = entry.realm ? realmKey(entry.realm) : null;
    return names.some((candidateName) => candidateName.name === name && (!realm || !candidateName.realm || realm === candidateName.realm));
  });
}

export function dniWarning(entry: DniEntry, who: string, where: "application" | "join"): string {
  const day = `<t:${Math.floor(entry.createdAt.getTime() / 1000)}:D>`;
  return `⚠️ Do-not-invite list: ${who} ${where === "application" ? "applied" : "joined the Discord"} and matches **${entry.name}${entry.realm ? `-${entry.realm}` : ""}**`
    + ` — ${entry.reason} (added by <@${entry.addedBy}>, ${day}). Nothing was blocked; review with /mod dni list.`;
}

type Db = Pick<PrismaClient, "doNotInvite">;

export function createDoNotInviteService(database: Db) {
  return {
    async add(guildId: string, input: { name: string; realm?: string | null; discordUserId?: string | null; reason: string; addedBy: string }) {
      const name = input.name.trim(), reason = input.reason.trim();
      if (name.length < 2 || name.length > 60) throw new Error("Give a character name of 2 to 60 characters.");
      if (reason.length < 3) throw new Error("Give a short reason (officers see it when there is a match).");
      return database.doNotInvite.create({ data: { guildId, name, realm: input.realm?.trim() || null, discordUserId: input.discordUserId ?? null, reason: reason.slice(0, 200), addedBy: input.addedBy } });
    },
    async remove(guildId: string, id: string) {
      const removed = await database.doNotInvite.deleteMany({ where: { id, guildId } });
      if (!removed.count) throw new Error("That entry was not found.");
    },
    list(guildId: string) {
      return database.doNotInvite.findMany({ where: { guildId }, orderBy: { createdAt: "desc" }, take: 100 });
    },
    // Every in-game guild sharing this Discord server: someone joining the server concerns them all.
    forDiscordServer(discordId: string) {
      return database.doNotInvite.findMany({ where: { guild: { discordId } }, take: 500 });
    }
  };
}

// Never throws: a warning must not be able to break the application or join that triggered it.
export async function warnDoNotInvite(discordGuild: DiscordGuild | null, candidate: DniCandidate, who: string, where: "application" | "join"): Promise<void> {
  if (!discordGuild) return;
  try {
    const matches = dniMatches(await createDoNotInviteService(prisma).forDiscordServer(discordGuild.id), candidate);
    for (const entry of matches.slice(0, 3)) await postToLogChannel(discordGuild, dniWarning(entry, who, where));
  } catch (error) {
    console.error("Do-not-invite check failed", error);
  }
}
