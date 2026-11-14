import type { PrismaClient } from "../generated/prisma/client.js";
import { characterKey, characterReference } from "../../companion/character-identity.mjs";
import { withEdition } from "./edition-context.js";
import { gameEditionOf } from "./game-edition.js";
import { dungeonRunSchema, validateRun, type DungeonRunInput } from "./dungeon-rules.js";
import type { DungeonImportSummary } from "./dungeon-import.js";
import { storeDeviceRuns } from "./companion-device.js";
import { integrityConfig } from "./run-integrity-config.js";
import { voucherOf } from "./run-trust.js";

// Runs made by a party with members of several guilds (9.3.2, docs/plans/CROSS_GUILD_RUN_SHARING_2026-11-14.md). A run that one lane
// has stored (a guild's own import, a device upload, or the public relay) is also offered to every OTHER guild that has a member in
// it. The receiving guild judges it like any run one player's PC reports (storeDeviceRuns): its own season and rules, its own checks
// and review list, points only for its own members, its own receipts. The public boards already hold one row per run.

export interface ShareOrigin {
  /** The guild lane the run came from (left out of the targets); null for the public relay. */
  guildId: string | null;
  /** The uploading PC, when there is one: an officer exclusion of that PC in another guild applies there too. */
  deviceId?: string | null;
  /** The uploader's own characters (the run must be one a player of it reported). */
  characterKeys: readonly string[];
  /** When the bot first received the run. */
  receivedAt: Date;
}
export interface SharedRun { guildId: string; guildName: string; discordId: string; summaries: DungeonImportSummary[] }
export interface ShareOptions { /** False for a Discord server the bot is not in (nothing is stored for it). */ eligible?: (discordId: string) => boolean }

interface Candidate { guild: { id: string; name: string; gameEdition: string; discordId: string }; roster: Set<string> }

const keyOf = (name: string, realm: string | undefined, edition: string) => characterKey(name, realm ?? "", edition);

/**
 * Other guilds that have a member in `run`: a linked or reported character of the guild matches a player by FULL name (and realm
 * where the game uses one), and that player is in the guild's in-game roster as the guild last knows it. What the run says about
 * guilds is never used to choose one. Guilds that switched sharing off or have no Discord server are left out.
 */
export async function guildsWithMembersIn(database: Pick<PrismaClient, "character" | "guildSettings" | "guildRosterEntry" | "guild">, run: DungeonRunInput, exceptGuildId: string | null): Promise<Map<string, Candidate>> {
  const edition = gameEditionOf(run);
  const players = run.players.map((player) => ({ name: characterReference(player.character, player.realm, edition).character.trim(), key: keyOf(player.character, player.realm, edition) })).filter((player) => player.name);
  const keys = [...new Set(players.map((player) => player.key))];
  const found = new Map<string, Candidate>();
  if (!keys.length) return found;
  const rows = await database.character.findMany({
    where: { gameEdition: edition, ...(exceptGuildId ? { guildId: { not: exceptGuildId } } : {}), member: { status: { not: "LEFT" } }, OR: players.map((player) => ({ name: { equals: player.name, mode: "insensitive" as const } })) },
    select: { guildId: true, name: true, realm: true }
  });
  const mine = rows.filter((row) => keys.includes(keyOf(row.name, row.realm, edition)));
  const guildIds = [...new Set(mine.map((row) => row.guildId))].sort();
  if (!guildIds.length) return found;
  const [roster, off, guilds] = await Promise.all([
    database.guildRosterEntry.findMany({ where: { guildId: { in: guildIds }, gameEdition: edition, inGuild: true, nameKey: { in: keys } }, select: { guildId: true, nameKey: true } }),
    database.guildSettings.findMany({ where: { guildId: { in: guildIds }, crossGuildRuns: false }, select: { guildId: true } }),
    database.guild.findMany({ where: { id: { in: guildIds } }, select: { id: true, name: true, gameEdition: true, discordId: true } })
  ]);
  const disabled = new Set(off.map((row) => row.guildId));
  for (const guild of guilds) {
    if (disabled.has(guild.id) || !guild.discordId) continue;
    const inRoster = new Set(roster.filter((row) => row.guildId === guild.id).map((row) => row.nameKey));
    // The guild's own character must be in its in-game roster.
    if (!mine.some((row) => row.guildId === guild.id && inRoster.has(keyOf(row.name, row.realm, edition)))) continue;
    found.set(guild.id, { guild: { id: guild.id, name: guild.name, gameEdition: guild.gameEdition, discordId: guild.discordId }, roster: inRoster });
  }
  return new Map([...found].sort(([a], [b]) => a < b ? -1 : 1));
}

/** The copy for one guild: only that guild's own roster members are marked as in the guild (the origin guild's marks do not carry over). */
export function localiseRun(raw: unknown, roster: ReadonlySet<string>, edition: string): unknown {
  const run = raw as { players?: { character?: unknown; realm?: unknown; inGuild?: unknown }[] };
  if (!Array.isArray(run.players)) return raw;
  return { ...run, players: run.players.map((player) => ({ ...player,
    inGuild: typeof player.character === "string" && roster.has(keyOf(player.character, typeof player.realm === "string" ? player.realm : "", edition)) })) };
}

const inboxToken = (guildId: string) => `xguild-inbox:${guildId}`;

/**
 * Offers `rawRuns` to every other guild with a member in them. Never throws: the work that stored the runs is already saved, and one
 * guild's problem must not stop the others. Returns what each guild stored (the caller posts its run cards).
 */
export async function shareRuns(database: PrismaClient, origin: ShareOrigin, rawRuns: readonly unknown[], options: ShareOptions = {}): Promise<SharedRun[]> {
  const config = integrityConfig();
  const keys = new Set(origin.characterKeys);
  const perGuild = new Map<string, { candidate: Candidate; runs: unknown[] }>();
  try {
    const device = origin.deviceId ? await database.companionDevice.findUnique({ where: { id: origin.deviceId }, select: { excludedGuilds: true } }) : null;
    for (const raw of rawRuns) {
      try {
        const parsed = dungeonRunSchema.safeParse(raw);
        if (!parsed.success) continue;
        const run = parsed.data;
        // A finished, valid run that its own lane accepted, with a player of the run behind it (the uploader's own character, or a
        // participant's own report); a name written in the file is not enough.
        if (run.state !== "COMPLETED" || run.viaGroup === true || !validateRun(run, origin.receivedAt).ok || !voucherOf(raw, keys)) continue;
        const targets = [...await guildsWithMembersIn(database, run, origin.guildId)].slice(0, config.crossGuildMaxGuilds);
        for (const [guildId, candidate] of targets) {
          if (options.eligible && !options.eligible(candidate.guild.discordId)) continue;
          if (device?.excludedGuilds?.includes(guildId)) continue;
          // A run the guild holds for review is not copied.
          if (await database.dungeonRunWitness.findFirst({ where: { guildId, runRef: run.id, status: "held" }, select: { id: true } })) continue;
          const entry = perGuild.get(guildId) ?? { candidate, runs: [] };
          entry.runs.push(localiseRun(raw, candidate.roster, gameEditionOf(candidate.guild)));
          perGuild.set(guildId, entry);
        }
      } catch (error) {
        console.error(`Cross-guild run sharing failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } catch (error) {
    console.error(`Cross-guild run sharing failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const shared: SharedRun[] = [];
  for (const [guildId, { candidate, runs }] of perGuild) {
    try {
      const device = await database.companionDevice.upsert({ where: { tokenHash: inboxToken(guildId) }, create: { tokenHash: inboxToken(guildId) }, update: {}, select: { id: true } });
      const since = new Date(origin.receivedAt.getTime() - 86_400_000);
      const received = await database.dungeonRunWitness.count({ where: { guildId, deviceId: device.id, firstSeenAt: { gte: since } } });
      const room = Math.max(0, config.crossGuildCopiesPerDay - received);
      if (!room) continue;
      const result = await withEdition(gameEditionOf(candidate.guild), () => database.$transaction((tx) => storeDeviceRuns(tx as never, guildId, runs.slice(0, room), origin.receivedAt,
        { deviceId: device.id, characterKeys: [...origin.characterKeys], sealKey: null, shared: true }), { timeout: 60_000, maxWait: 15_000 }));
      if (result.summaries?.length) shared.push({ guildId, guildName: candidate.guild.name, discordId: candidate.guild.discordId, summaries: result.summaries });
    } catch (error) {
      console.error(`Cross-guild run could not be stored for a guild: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return shared;
}
