import type { PrismaClient } from "../generated/prisma/client.js";
import { characterReference } from "../../companion/character-identity.mjs";
import { findCharacter } from "./character-match.js";
import { withEdition } from "./edition-context.js";
import { gameEditionOf } from "./game-edition.js";
import { dungeonRunSchema, validateRun, type DungeonRunInput } from "./dungeon-rules.js";
import { importSharedRun, type DungeonImportSummary } from "./dungeon-import.js";
import { integrityConfig } from "./run-integrity-config.js";

// Runs made by a party with members of several guilds (9.3.2, docs/plans/CROSS_GUILD_RUN_SHARING_2026-11-14.md). A run that one
// lane has stored (a guild's own import, a device upload, or the public relay) is also stored in every OTHER guild that has a member
// in it, through the same import pipeline as that guild's own uploads: that guild's season and rules, points only for its own
// members, its own receipts. The public boards already hold one row per run key, so nothing is shown twice there.

export interface SharedRun { guildId: string; guildName: string; discordId: string | null; summary: DungeonImportSummary }

const first = (name: string) => name.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";

/**
 * Other guilds that have a member in `run`: guilds whose own roster (a linked or reported character of one of their members) names a
 * player of the run, in the same game edition. The run's own claims about who belongs to which guild are never used to pick a guild.
 */
export async function guildsWithMembersIn(database: Pick<PrismaClient, "character" | "guildSettings">, run: DungeonRunInput, exceptGuildId: string | null) {
  const edition = gameEditionOf(run);
  const names = [...new Set(run.players.map((player) => first(characterReference(player.character, player.realm, edition).character)).filter(Boolean))];
  if (!names.length) return new Map<string, { id: string; name: string; realm: string; memberId: string; spec: string | null; displayName: string | null; gameEdition: string; discordId: string | null }[]>();
  const rows = await database.character.findMany({
    where: { gameEdition: edition, ...(exceptGuildId ? { guildId: { not: exceptGuildId } } : {}), member: { status: { not: "LEFT" } }, OR: names.map((name) => ({ name: { startsWith: name, mode: "insensitive" as const } })) },
    select: { id: true, guildId: true, name: true, realm: true, memberId: true, spec: true, displayName: true, gameEdition: true, member: { select: { discordUserId: true } } }
  });
  const off = new Set((await database.guildSettings.findMany({ where: { guildId: { in: [...new Set(rows.map((row) => row.guildId))] }, crossGuildRuns: false }, select: { guildId: true } })).map((row) => row.guildId));
  const byGuild = new Map<string, { id: string; name: string; realm: string; memberId: string; spec: string | null; displayName: string | null; gameEdition: string; discordId: string | null }[]>();
  for (const row of rows) {
    if (off.has(row.guildId)) continue;
    const list = byGuild.get(row.guildId) ?? [];
    list.push({ id: row.id, name: row.name, realm: row.realm, memberId: row.memberId, spec: row.spec, displayName: row.displayName, gameEdition: row.gameEdition, discordId: row.member?.discordUserId ?? null });
    byGuild.set(row.guildId, list);
  }
  // A guild counts only when one of its characters really is a player of the run (the loose first-name search above is only a pre-filter).
  for (const [guildId, list] of [...byGuild]) {
    if (!run.players.some((player) => findCharacter(list, player.character, player.realm, edition))) byGuild.delete(guildId);
  }
  return byGuild;
}

/**
 * Stores `rawRuns` in every other guild with a member in them. Never throws: the work that stored the runs is already saved, and one
 * guild's problem must not stop the others. Returns what each guild stored (the caller posts the run cards).
 */
export async function shareRuns(database: PrismaClient, originGuildId: string | null, rawRuns: readonly unknown[], now = new Date()): Promise<SharedRun[]> {
  const config = integrityConfig();
  const shared: SharedRun[] = [];
  for (const raw of rawRuns) {
    try {
      const parsed = dungeonRunSchema.safeParse(raw);
      if (!parsed.success) continue;
      const run = parsed.data;
      // Only a finished, valid run that its own lane accepted, with the players' own reports behind it.
      if (run.state !== "COMPLETED" || run.viaGroup === true || !validateRun(run, now).ok) continue;
      const reporters = new Set([...(run.reporterNames ?? []), ...(run.recorder ? [run.recorder] : [])].map(first));
      if (reporters.size < config.crossGuildMinReporters) continue;
      const guilds = [...(await guildsWithMembersIn(database, run, originGuildId))].slice(0, config.crossGuildMaxGuilds);
      for (const [guildId, characters] of guilds) {
        try {
          const guild = await database.guild.findUnique({ where: { id: guildId }, select: { name: true, gameEdition: true, discordId: true } });
          if (!guild) continue;
          const summary = await withEdition(gameEditionOf(guild), () => database.$transaction((tx) => importSharedRun(tx as never, guildId, raw, characters, now), { timeout: 60_000, maxWait: 15_000 }));
          if (summary.results.length) shared.push({ guildId, guildName: guild.name, discordId: guild.discordId ?? null, summary });
        } catch (error) {
          console.error(`Cross-guild run could not be stored for a guild: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } catch (error) {
      console.error(`Cross-guild run sharing failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return shared;
}
