import type { PrismaClient } from "../generated/prisma/client.js";
import type { GuildDashboardAccess } from "./guild-dashboard-access.js";
import type { RosterGuild } from "./roster-dashboard-store.js";
import { characterName } from "./character-display.js";
import { findCharacter } from "./character-match.js";
import { asGroupKind, GROUP_CAPS, groupSize } from "./dungeon-group.js";

export interface CraftRow { character: string; realm: string; profession: string; itemKey: number; itemName: string; scannedAt: Date }
export interface TeamMember { characterId: string | null; name: string; realm: string; role: string; bench: boolean; trial: boolean; main: string | null; backups: string[]; assigned?: boolean; className?: string | null }
export interface TeamView { id: string; name: string; schedule: string | null; timezone: string | null; tankLimit: number | null; healerLimit: number | null; dpsLimit: number | null; members: TeamMember[]; truncated: boolean }
export interface HistoryEvent { at: Date; kind: "attendance" | "loot" | "points"; title: string; detail: string; team: string | null }
export interface CharacterHistory { name: string; characters: { id: string; name: string; realm: string; main: boolean }[]; events: HistoryEvent[]; truncated: boolean }
export interface GroupView { title: string; kind: string; minLevel: number | null; maxLevel: number | null; createdAt: Date; size: number; signedUp: number; missing: { TANK: number; HEALER: number; DPS: number } | null; url: string | null }
export interface ToolResult<T> { guild: RosterGuild; data: T; truncated: boolean }
export interface GuildToolsStore {
  guilds: GuildDashboardAccess["guilds"];
  craft(user: string, guild: string, query: string): Promise<ToolResult<CraftRow[]> | null>;
  teams(user: string, guild: string): Promise<ToolResult<TeamView[]> | null>;
  history(user: string, guild: string, characterId: string): Promise<ToolResult<CharacterHistory> | null>;
  groups(user: string, guild: string): Promise<ToolResult<GroupView[]> | null>;
}

export function recipeQuery(text: string): { itemKey: number } | { itemName: { contains: string; mode: "insensitive" } } {
  const value = text.trim();
  if (!value || value.length > 200) throw new Error("Enter an item name, ID or item link (200 characters maximum).");
  const link = /\|H(item|spell):(\d+)(?=[:|])/.exec(value);
  const numeric = link ? (link[1] === "spell" ? -1 : 1) * Number(link[2]) : /^-?\d+$/.test(value) ? Number(value) : null;
  if (numeric !== null) {
    if (!Number.isSafeInteger(numeric) || numeric === 0 || Math.abs(numeric) > 2_147_483_647) throw new Error("Invalid recipe ID.");
    return { itemKey: numeric };
  }
  if (value.includes("|H")) throw new Error("Invalid item link.");
  return { itemName: { contains: value, mode: "insensitive" } };
}

const CHARACTER = { id: true, guildId: true, gameEdition: true, name: true, displayName: true, realm: true, isMain: true, className: true } as const;
const LIMIT = 200;

export function prismaGuildToolsStore(db: PrismaClient, access: GuildDashboardAccess): GuildToolsStore {
  return {
    guilds: access.guilds,
    async craft(user, guildId, query) {
      const guild = await access.authorize(user, guildId);
      if (!guild) return null;
      if (!query.trim()) return { guild, data: [], truncated: false };
      const recipes = await db.recipeKnown.findMany({ where: { guildId, ...recipeQuery(query) }, select: { character: true, realm: true, profession: true, itemKey: true, itemName: true, scannedAt: true }, orderBy: [{ itemName: "asc" }, { character: "asc" }, { realm: "asc" }], take: LIMIT + 1 });
      const names = [...new Set(recipes.map(row => row.character))];
      const scope = { guildId, gameEdition: guild.edition, name: { in: names } };
      const linked = names.length ? await db.character.findMany({ where: { ...scope, member: { status: "ACTIVE", isTest: false, guildId } }, select: { name: true, displayName: true, realm: true, gameEdition: true }, take: 1_001 }) : [];
      const unclaimed = names.length ? await db.unclaimedCharacter.findMany({ where: scope, select: { name: true, displayName: true, realm: true, gameEdition: true }, take: 1_001 }) : [];
      const characters = [...linked, ...unclaimed];
      return { guild, truncated: recipes.length > LIMIT, data: recipes.slice(0, LIMIT).map(row => {
        const character = findCharacter(characters, row.character, row.realm, guild.edition);
        return { ...row, character: character ? characterName(character) : row.character };
      }) };
    },
    async teams(user, guildId) {
      const guild = await access.authorize(user, guildId);
      if (!guild) return null;
      const cores = await db.raidCore.findMany({ where: { guildId }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 51,
        select: { id: true, name: true, schedule: true, weeklyTimezone: true, tankLimit: true, healerLimit: true, dpsLimit: true,
          members: { where: { member: { guildId, status: "ACTIVE", isTest: false } }, orderBy: { addedAt: "asc" }, take: 81,
            select: { role: true, bench: true, trial: true, character: { select: CHARACTER }, backups: { take: 20, select: { role: true, character: { select: CHARACTER } } },
              member: { select: { characters: { where: { guildId, gameEdition: guild.edition }, select: CHARACTER, orderBy: [{ isMain: "desc" }, { name: "asc" }], take: 20 } } } } } } });
      const belongs = (character: { guildId: string; gameEdition: string } | null) => character?.guildId === guildId && character.gameEdition === guild.edition;
      const data = cores.slice(0, 50).map(core => ({ id: core.id, name: core.name, schedule: core.schedule, timezone: core.weeklyTimezone,
        tankLimit: core.tankLimit, healerLimit: core.healerLimit, dpsLimit: core.dpsLimit, truncated: core.members.length > 80,
        members: core.members.slice(0, 80).map(spot => {
          const main = spot.member.characters.find(row => row.isMain);
          const character = belongs(spot.character) ? spot.character : null;
          return { characterId: character?.id ?? main?.id ?? null, name: character ? characterName(character) : main ? characterName(main) : "", realm: character?.realm ?? main?.realm ?? "",
            role: spot.role, bench: spot.bench, trial: spot.trial, main: main ? characterName(main) : null, assigned: character !== null, className: character?.className ?? null,
            backups: spot.backups.filter(row => belongs(row.character)).map(row => `${characterName(row.character)} · ${row.character.realm} · ${row.role}`) };
        }) }));
      return { guild, data, truncated: cores.length > 50 || data.some(core => core.truncated) };
    },
    async history(user, guildId, characterId) {
      const guild = await access.authorize(user, guildId);
      if (!guild) return null;
      const character = await db.character.findFirst({ where: { id: characterId, guildId, gameEdition: guild.edition, member: { guildId, status: "ACTIVE", isTest: false } },
        select: { ...CHARACTER, memberId: true, member: { select: { characters: { where: { guildId, gameEdition: guild.edition }, select: CHARACTER, orderBy: [{ isMain: "desc" }, { name: "asc" }], take: 101 } } } } });
      if (!character) return null;
      const memberId = character.memberId;
      const attendance = await db.raidAttendance.findMany({ where: { memberId, raid: { guildId, isTest: false, status: "COMPLETED" } },
        select: { status: true, raid: { select: { title: true, scheduledAt: true, core: { select: { name: true } } } } }, orderBy: { raid: { scheduledAt: "desc" } }, take: 101 });
      const loot = await db.lootAward.findMany({ where: { guildId, memberId }, select: { itemName: true, amount: true, awardedAt: true }, orderBy: { awardedAt: "desc" }, take: 101 });
      const points = await db.epgpTransaction.findMany({ where: { guildId, memberId }, select: { type: true, epAmount: true, gpAmount: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 101 });
      const events: HistoryEvent[] = [
        ...attendance.slice(0, 100).map(row => ({ at: row.raid.scheduledAt, kind: "attendance" as const, title: row.raid.title, detail: row.status, team: row.raid.core?.name ?? null })),
        ...loot.slice(0, 100).map(row => ({ at: row.awardedAt, kind: "loot" as const, title: row.itemName, detail: `${row.amount} GP`, team: null })),
        ...points.slice(0, 100).map(row => ({ at: row.createdAt, kind: "points" as const, title: row.type, detail: `${row.epAmount} EP / ${row.gpAmount} GP`, team: null }))
      ].sort((a, b) => b.at.getTime() - a.at.getTime());
      const truncated = attendance.length > 100 || loot.length > 100 || points.length > 100 || character.member.characters.length > 100;
      return { guild, truncated, data: { name: characterName(character), characters: character.member.characters.slice(0, 100).map(row => ({ id: row.id, name: characterName(row), realm: row.realm, main: row.isMain })), events, truncated } };
    },
    async groups(user, guildId) {
      const guild = await access.authorize(user, guildId);
      if (!guild) return null;
      const rows = await db.dungeonGroup.findMany({ where: { guildId, status: "OPEN" }, orderBy: { createdAt: "desc" }, take: 101,
        select: { title: true, kind: true, minLevel: true, maxLevel: true, maxSize: true, createdAt: true, signupChannelId: true, signupMessageId: true,
          guild: { select: { discordId: true } }, signups: { where: { status: "SIGNED_UP", member: { guildId, status: "ACTIVE", isTest: false } }, select: { role: true }, take: 41 } } });
      const data = rows.slice(0, 100).map(row => {
        const kind = asGroupKind(row.kind);
        const counts = { TANK: 0, HEALER: 0, DPS: 0 };
        for (const signup of row.signups) counts[signup.role]++;
        const ids = [row.guild.discordId, row.signupChannelId, row.signupMessageId];
        return { title: row.title, kind, minLevel: row.minLevel, maxLevel: row.maxLevel, createdAt: row.createdAt, size: groupSize(kind, row.maxSize), signedUp: row.signups.length,
          missing: kind === "DUNGEON" ? { TANK: Math.max(0, GROUP_CAPS.TANK - counts.TANK), HEALER: Math.max(0, GROUP_CAPS.HEALER - counts.HEALER), DPS: Math.max(0, GROUP_CAPS.DPS - counts.DPS) } : null,
          url: ids.every(id => typeof id === "string" && /^\d{15,22}$/.test(id)) ? `https://discord.com/channels/${ids.join("/")}` : null };
      });
      return { guild, data, truncated: rows.length > 100 };
    }
  };
}
