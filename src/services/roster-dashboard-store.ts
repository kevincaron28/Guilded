import type { Client } from "discord.js";
import type { PrismaClient, Prisma } from "../generated/prisma/client.js";
import { guildDashboardAccess } from "./guild-dashboard-access.js";
import { characterKey } from "../../companion/character-identity.mjs";
import { gameEditionOf } from "./game-edition.js";
import { characterName } from "./character-display.js";
import { attachRosterActivity } from "./roster-activity.js";

export const ROSTER_LIMIT = 1_000;
export interface RosterGuild { id: string; name: string; edition: string }
export interface RosterCharacter {
  characterId?: string;
  key: string; name: string; realm: string; className: string; race: string | null;
  level: number | null; memberId: string | null; isMain: boolean | null;
  professions: string[]; refreshedAt: Date | null; updatedAt?: Date;
  participation?: { seven: boolean; thirty: boolean } | null;
}
export interface RosterSnapshot { guild: RosterGuild; characters: RosterCharacter[]; truncated: boolean; activityAsOf?: Date }
export interface RosterDashboardStore {
  guilds(userId: string): Promise<RosterGuild[]>;
  load(userId: string, guildId: string): Promise<RosterSnapshot | null>;
}

export function rosterProfessions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap(row => {
    if (!row || typeof row !== "object") return [];
    const name: unknown = row.name ?? row.profession;
    return typeof name === "string" && name.trim() ? [name.trim()] : [];
  }))].sort();
}

// Match /officer export: active linked members with current officer authority.
// Re-check Discord roles for every page/export, including scoped guild role IDs.
export function prismaRosterDashboardStore(database: PrismaClient, client: Client | undefined, allows: (discordId: string) => boolean): RosterDashboardStore {
  const { authorize, guilds } = guildDashboardAccess(database, client, allows);
  return {
    guilds,
    async load(userId, guildId) {
      const guild = await authorize(userId, guildId);
      if (!guild) return null;
      return attachRosterActivity(database, await loadRosterSnapshot(database, guild));
    }
  };
}

// Transaction-safe snapshot read; does not call Discord.
export async function loadRosterSnapshot(database: Pick<Prisma.TransactionClient, "character" | "unclaimedCharacter">, guild: RosterGuild): Promise<RosterSnapshot> {
      const guildId = guild.id;
      const where = { guildId, gameEdition: guild.edition };
      // Bounded, explicit field selections: never include notes, credentials or Discord IDs.
      const linked = await database.character.findMany({
        where: { ...where, member: { guildId, status: "ACTIVE", isTest: false } },
        select: { id: true, name: true, displayName: true, realm: true, className: true, race: true, level: true, memberId: true, isMain: true, updatedAt: true, lastSeenAt: true, professions: { select: { profession: true } } },
        orderBy: [{ name: "asc" }, { realm: "asc" }, { id: "asc" }], take: ROSTER_LIMIT + 1
      });
      const unclaimed = await database.unclaimedCharacter.findMany({
        where, select: { name: true, displayName: true, realm: true, className: true, race: true, level: true, professions: true, lastSeenAt: true },
        orderBy: [{ name: "asc" }, { realm: "asc" }, { id: "asc" }], take: ROSTER_LIMIT + 1
      });
      const characters = new Map<string, RosterCharacter>();
      for (const row of [...linked, ...unclaimed]) {
        const key = characterKey(row.name, row.realm, gameEditionOf({ gameEdition: guild.edition }));
        if (characters.has(key)) continue; // A linked record wins over stale discovery data.
        characters.set(key, { key, name: characterName(row), realm: row.realm, className: row.className, race: row.race,
          ...("memberId" in row ? { characterId: row.id, updatedAt: row.updatedAt } : {}),
          level: row.level, memberId: "memberId" in row ? row.memberId : null, isMain: "isMain" in row ? row.isMain : null,
          professions: rosterProfessions(row.professions), refreshedAt: row.lastSeenAt });
      }
      const truncated = linked.length > ROSTER_LIMIT || unclaimed.length > ROSTER_LIMIT || characters.size > ROSTER_LIMIT;
      return { guild, characters: [...characters.values()].slice(0, ROSTER_LIMIT).sort((a, b) => a.name.localeCompare(b.name) || a.realm.localeCompare(b.realm)), truncated };
}
