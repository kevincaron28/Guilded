import type { PrismaClient } from "../generated/prisma/client.js";
import type { GuildDashboardAccess } from "./guild-dashboard-access.js";
import type { RosterGuild } from "./roster-dashboard-store.js";
import { characterName } from "./character-display.js";

export const AVAILABILITY_ROLES = ["ANY", "TANK", "HEALER", "DPS"] as const;
export const AVAILABILITY_MINUTES = [15, 30, 60] as const;
export interface AvailableCharacter { id: string; name: string; realm: string }
export interface AvailabilitySnapshot {
  guild: RosterGuild; characters: AvailableCharacter[];
  rows: { character: AvailableCharacter; role: string; expiresAt: Date; mine: boolean }[];
  truncated: boolean;
}
export interface AvailabilityStore {
  guilds(user: string): Promise<RosterGuild[]>;
  load(user: string, guildId: string, now: Date): Promise<AvailabilitySnapshot | null>;
  share(user: string, guildId: string, characterId: string, role: string, minutes: number, now: Date): Promise<void>;
  revoke(user: string, guildId: string): Promise<void>;
}
export function prismaAvailabilityStore(database: PrismaClient, access: GuildDashboardAccess): AvailabilityStore {
  return {
    guilds: access.guilds,
    async load(user, guildId, now) {
      const guild = await access.authorize(user, guildId);
      if (!guild) return null;
      const scope = { guildId, gameEdition: guild.edition };
      const active = { guildId, status: "ACTIVE" as const, isTest: false };
      const characters = await database.character.findMany({ where: { ...scope, member: { ...active, discordUserId: user } },
        select: { id: true, name: true, displayName: true, realm: true }, orderBy: { name: "asc" }, take: 100 });
      const entries = await database.webAvailability.findMany({ where: { ...scope, expiresAt: { gt: now }, member: active,
        character: { ...scope, member: active } },
        select: { memberId: true, role: true, expiresAt: true, character: { select: { id: true, name: true, displayName: true, realm: true, memberId: true } } },
        orderBy: [{ expiresAt: "asc" }, { memberId: "asc" }], take: 101 });
      const own = new Set(characters.map(row => row.id));
      return { guild, characters: characters.map(row => ({ id: row.id, name: characterName(row), realm: row.realm })), truncated: entries.length > 100,
        rows: entries.slice(0, 100).filter(row => row.memberId === row.character.memberId).map(row => ({ character: { id: row.character.id, name: characterName(row.character), realm: row.character.realm },
          role: row.role, expiresAt: row.expiresAt, mine: own.has(row.character.id) })) };
    },
    async share(user, guildId, characterId, role, minutes, now) {
      if (!AVAILABILITY_ROLES.includes(role as typeof AVAILABILITY_ROLES[number]) || !AVAILABILITY_MINUTES.includes(minutes as typeof AVAILABILITY_MINUTES[number])) throw new Error("Invalid availability");
      const guild = await access.authorize(user, guildId);
      if (!guild) throw new Error("Access changed");
      await database.$transaction(async tx => {
        const character = await tx.character.findFirst({ where: { id: characterId, guildId, gameEdition: guild.edition,
          member: { guildId, discordUserId: user, status: "ACTIVE", isTest: false } }, select: { memberId: true } });
        if (!character) throw new Error("Character ownership changed");
        const data = { characterId, guildId, gameEdition: guild.edition, role, expiresAt: new Date(now.getTime() + minutes * 60_000) };
        await tx.webAvailability.upsert({ where: { memberId: character.memberId }, create: { memberId: character.memberId, ...data }, update: data });
      }, { isolationLevel: "Serializable", maxWait: 15_000, timeout: 15_000 });
    },
    async revoke(user, guildId) {
      // Removal remains available after role loss or leaving; never lets users remove peers.
      await database.webAvailability.deleteMany({ where: { guildId, member: { guildId, discordUserId: user } } });
    }
  };
}
