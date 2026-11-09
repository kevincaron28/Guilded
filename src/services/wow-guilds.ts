import { z } from "zod";
import { GAME_EDITIONS } from "../../companion/game-edition.mjs";
import type { PrismaClient } from "../generated/prisma/client.js";

const label = z.string().trim().min(1).max(80).refine(value => !value.includes("|") && Array.from(value).every(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127));
export const wowGuildInput = z.object({ gameEdition: z.enum(GAME_EDITIONS), name: label, realm: label });
type Db = Pick<PrismaClient, "wowGuild">;
const key = (value: string) => value.normalize("NFC").toLowerCase();

/** Idempotent registration within the authenticated Discord server. */
export async function registerWowGuild(database: Db, guildId: string, input: unknown) {
  const data = wowGuildInput.parse(input);
  const identity = { guildId, gameEdition: data.gameEdition, nameKey: key(data.name), realmKey: key(data.realm) };
  return database.wowGuild.upsert({
    where: { guildId_gameEdition_realmKey_nameKey: identity },
    create: { ...identity, ...data },
    update: { name: data.name, realm: data.realm }
  });
}

/** Never select the first guild: ambiguous choices require a concrete guild ID. */
export async function resolveWowGuild(database: Db, guildId: string, selectedId?: string) {
  if (selectedId) {
    const selected = await database.wowGuild.findFirst({ where: { id: selectedId, guildId } });
    if (!selected) throw new Error("That in-game guild is not configured in this Discord server.");
    return selected;
  }
  const choices = await database.wowGuild.findMany({ where: { guildId }, take: 2, orderBy: { id: "asc" } });
  if (choices.length !== 1) throw new Error(choices.length ? "Choose the in-game guild for this action." : "Configure an in-game guild first.");
  return choices[0]!;
}

/** Separate Guild IDs reuse all existing ledger/raid/setting foreign keys. */
export async function provisionWowGuild(database: PrismaClient, rootGuildId: string, input: unknown, roles: { officer?: string; member?: string } = {}) {
  return database.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${rootGuildId}, 0))`;
    const root = await tx.guild.findUniqueOrThrow({ where: { id: rootGuildId } });
    if (root.scopeKey !== "default") throw new Error("Add in-game guilds from the Discord server's main setup.");
    const space = await registerWowGuild(tx as unknown as Db, rootGuildId, input);
    if (space.scopeGuildId) return space;
    const scoped = await tx.guild.create({ data: {
      discordId: root.discordId, scopeKey: space.id, gameEdition: space.gameEdition,
      name: space.name, settings: { create: {} }
    } });
    return tx.wowGuild.update({ where: { id: space.id }, data: {
      scopeGuildId: scoped.id, permissionRoles: roles.officer ? { officer: roles.officer } : {}, memberRoleId: roles.member ?? null
    } });
  });
}

/**
 * Does this server know the in-game guild an upload came from? `known: false` means the character's guild is not set up here
 * (the 9 Nov 2026 wrong-connection case). Matches the server's own guild name and every registered in-game guild, with or without the realm.
 */
export async function serverKnowsWowGuild(database: Pick<PrismaClient, "wowGuild">, guild: { id: string; name?: string | null }, uploaded: string | undefined): Promise<{ known: boolean; name: string } | undefined> {
  if (!uploaded?.trim()) return undefined;
  const norm = (value: string) => value.normalize("NFKC").trim().toLowerCase();
  const rows = await database.wowGuild.findMany({ where: { OR: [{ scopeGuildId: guild.id }, { guildId: guild.id }] }, select: { name: true, realm: true } });
  const known = new Set<string>();
  if (guild.name) known.add(norm(guild.name));
  for (const row of rows) { known.add(norm(row.name)); known.add(norm(`${row.name}-${row.realm}`)); }
  const full = norm(uploaded);
  const name = full.includes("-") ? full.slice(0, full.lastIndexOf("-")) : full;
  return { known: known.has(full) || known.has(name), name: guild.name ?? "" };
}
