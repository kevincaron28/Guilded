import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { characterKey } from "../../companion/character-identity.mjs";
import { BETA_PRESET_ID, BETA_SEASON_NAME } from "./dungeon-beta-preset.js";
import { enqueueDiscordJob } from "./discord-jobs.js";

// Owner-run cleanup of WoW Forever beta / pre-launch data (docs/PRELAUNCH_CLEANUP.md), for
// scripts/prelaunch-cleanup.ts: preview by default, --apply deletes in one transaction per guild.
//
// THE RULE. WoW Forever launched on 2026-11-04 at 23:00 UTC (Season 1, current-v1). Nothing
// played on Forever before that is live data: it is the beta.
//   * Character (gameEdition "forever"): deleted when its LAST ACTIVITY is before launch. Activity
//     = the latest of lastSeenAt, professionsUpdatedAt, guildRankAt and relayedAt. Any activity at
//     or after launch keeps it. A row never seen in game (none of those set) is deleted only on a
//     "Beta" realm label; otherwise it is kept and listed (an officer may have added it by hand
//     before launch). A "Beta" realm label with activity after launch is kept and listed.
//   * UnclaimedCharacter (forever): the same rule on lastSeenAt.
//   * Recipes and profession cooldowns: those of a deleted character, and any scanned before launch
//     that belong to no character or unclaimed row that is kept.
//   * Race to 60 (LevelRaceEntry, RaceHallEntry): entries whose name key is no kept character's.
//   * Dungeon seasons: the beta preset (presetId forever-beta-2026-10-13-v1 or its name) and any
//     season that ENDED before launch. A season that started before launch and is still open is
//     listed as ambiguous, never deleted. Runs that ended before launch or belong to a deleted
//     season, with their players, dungeon points and dungeon achievements.
// Never touched: EP/GP and DKP ledgers (they belong to members), members, Retail/Classic
// characters, anything dated at or after launch, Season 1. Deleting a character also removes what
// hangs on it (its professions, attunements, wishlist, gear checks, signups); the preview counts them.

export const FOREVER_LAUNCH = new Date("2026-11-04T23:00:00Z");
const BETA_REALM = /\bbeta\b/i;

export interface CharacterRow { id: string; name: string; realm: string; gameEdition: string; createdAt: Date; lastSeenAt: Date | null;
  professionsUpdatedAt?: Date | null; guildRankAt?: Date | null; relayedAt?: Date | null; displayName?: string | null }
export interface UnclaimedRow { id: string; name: string; realm: string; gameEdition: string; nameKey: string; lastSeenAt: Date }
export interface RecipeRow { id: string; character: string; realm: string; scannedAt: Date }
export interface RaceRow { id: string; nameKey: string; name: string }
export interface SeasonRow { id: string; name: string; startsAt: Date; endsAt: Date | null; status: string; ratingRules: unknown; rulesSnapshot: unknown }
export interface RunRow { id: string; seasonId: string | null; endedAt: Date | null; createdAt: Date; dungeonName: string }

export interface CleanupInput {
  characters: CharacterRow[]; unclaimed: UnclaimedRow[]; recipes: RecipeRow[]; cooldowns: RecipeRow[];
  levelRace: RaceRow[]; raceHall: RaceRow[]; seasons: SeasonRow[]; runs: RunRow[];
}
export interface CleanupPlan {
  characters: CharacterRow[]; unclaimed: UnclaimedRow[]; recipeIds: string[]; cooldownIds: string[];
  levelRaceIds: string[]; raceHallIds: string[]; seasons: SeasonRow[]; runIds: string[];
  ambiguous: string[];
}

const lastActivity = (row: CharacterRow) => {
  const stamps = [row.lastSeenAt, row.professionsUpdatedAt, row.guildRankAt, row.relayedAt].filter((d): d is Date => d instanceof Date);
  return stamps.length ? new Date(Math.max(...stamps.map((d) => d.getTime()))) : row.createdAt;
};
const presetOf = (value: unknown) => value && typeof value === "object" ? (value as { presetId?: unknown }).presetId : undefined;
const nameRealm = (name: string, realm: string) => `${name.trim().toLowerCase()}\n${realm.replace(/\s+/g, "").toLowerCase()}`;

/** Pure: what the cleanup deletes for one guild, and what it keeps but lists. */
export function planPrelaunchCleanup(input: CleanupInput, launch = FOREVER_LAUNCH): CleanupPlan {
  const plan: CleanupPlan = { characters: [], unclaimed: [], recipeIds: [], cooldownIds: [], levelRaceIds: [], raceHallIds: [], seasons: [], runIds: [], ambiguous: [] };
  const keptCharacters: CharacterRow[] = [];
  for (const row of input.characters) {
    if (row.gameEdition !== "forever") { keptCharacters.push(row); continue; }
    const live = lastActivity(row) >= launch;
    const neverSeen = ![row.lastSeenAt, row.professionsUpdatedAt, row.guildRankAt, row.relayedAt].some((d) => d instanceof Date);
    // Never seen in game and not on a beta realm: maybe added by hand before launch (core
    // planning). Not evidence of the beta, so it stays and is listed.
    if (!live && neverSeen && !BETA_REALM.test(row.realm)) {
      keptCharacters.push(row);
      plan.ambiguous.push(`character ${row.displayName ?? row.name} (${row.realm}): added before launch and never seen in game; kept`);
      continue;
    }
    if (!live) { plan.characters.push(row); continue; }
    keptCharacters.push(row);
    if (BETA_REALM.test(row.realm)) plan.ambiguous.push(`character ${row.displayName ?? row.name} (${row.realm}): beta realm label but active since launch; kept`);
  }
  const keptUnclaimed: UnclaimedRow[] = [];
  for (const row of input.unclaimed) {
    if (row.gameEdition === "forever" && row.lastSeenAt < launch) { plan.unclaimed.push(row); continue; }
    keptUnclaimed.push(row);
    if (row.gameEdition === "forever" && BETA_REALM.test(row.realm)) plan.ambiguous.push(`unclaimed ${row.name} (${row.realm}): beta realm label but seen since launch; kept`);
  }
  // Names that stay: every kept character and unclaimed row, by name+realm and by name alone
  // (Forever realm labels are unreliable, so a kept name protects its recipes on any label).
  const keptPairs = new Set([...keptCharacters, ...keptUnclaimed].map((row) => nameRealm(row.name, row.realm)));
  const keptNames = new Set([...keptCharacters, ...keptUnclaimed].map((row) => row.name.trim().toLowerCase()));
  const deletedPairs = new Set([...plan.characters, ...plan.unclaimed].map((row) => nameRealm(row.name, row.realm)));
  const doomed = (row: RecipeRow) => !keptPairs.has(nameRealm(row.character, row.realm))
    && (deletedPairs.has(nameRealm(row.character, row.realm)) || (row.scannedAt < launch && !keptNames.has(row.character.trim().toLowerCase())));
  plan.recipeIds = input.recipes.filter(doomed).map((row) => row.id);
  plan.cooldownIds = input.cooldowns.filter(doomed).map((row) => row.id);
  const keptKeys = new Set([
    ...keptCharacters.map((row) => String(characterKey(row.name, row.realm, row.gameEdition))),
    ...keptUnclaimed.map((row) => row.nameKey)
  ]);
  plan.levelRaceIds = input.levelRace.filter((row) => !keptKeys.has(row.nameKey)).map((row) => row.id);
  plan.raceHallIds = input.raceHall.filter((row) => !keptKeys.has(row.nameKey)).map((row) => row.id);
  for (const season of input.seasons) {
    const beta = presetOf(season.ratingRules) === BETA_PRESET_ID || presetOf(season.rulesSnapshot) === BETA_PRESET_ID || season.name === BETA_SEASON_NAME;
    if (beta || (season.endsAt && season.endsAt <= launch)) { plan.seasons.push(season); continue; }
    if (season.startsAt < launch) plan.ambiguous.push(`dungeon season "${season.name}" started before launch and is still open (${season.status}); kept`);
  }
  const deletedSeasons = new Set(plan.seasons.map((season) => season.id));
  plan.runIds = input.runs.filter((run) => (run.seasonId && deletedSeasons.has(run.seasonId)) || (run.endedAt ?? run.createdAt) < launch).map((run) => run.id);
  return plan;
}

type Db = Pick<PrismaClient, "character" | "unclaimedCharacter" | "recipeKnown" | "professionCooldown" | "levelRaceEntry" | "raceHallEntry" | "dungeonSeason" | "dungeonRun">;

/** Everything the rule looks at for one guild. */
export async function loadCleanupInput(db: Db, guildId: string): Promise<CleanupInput> {
  const [characters, unclaimed, recipes, cooldowns, levelRace, raceHall, seasons, runs] = await Promise.all([
    db.character.findMany({ where: { member: { guildId } }, select: { id: true, name: true, displayName: true, realm: true, gameEdition: true, createdAt: true, lastSeenAt: true, professionsUpdatedAt: true, guildRankAt: true, relayedAt: true } }),
    db.unclaimedCharacter.findMany({ where: { guildId }, select: { id: true, name: true, realm: true, gameEdition: true, nameKey: true, lastSeenAt: true } }),
    db.recipeKnown.findMany({ where: { guildId }, select: { id: true, character: true, realm: true, scannedAt: true } }),
    db.professionCooldown.findMany({ where: { guildId }, select: { id: true, character: true, realm: true, scannedAt: true } }),
    db.levelRaceEntry.findMany({ where: { guildId }, select: { id: true, nameKey: true, name: true } }),
    db.raceHallEntry.findMany({ where: { guildId }, select: { id: true, nameKey: true, name: true } }),
    db.dungeonSeason.findMany({ where: { guildId }, select: { id: true, name: true, startsAt: true, endsAt: true, status: true, ratingRules: true, rulesSnapshot: true } }),
    db.dungeonRun.findMany({ where: { guildId }, select: { id: true, seasonId: true, endedAt: true, createdAt: true, dungeonName: true } })
  ]);
  return { characters, unclaimed, recipes, cooldowns, levelRace, raceHall, seasons, runs };
}

export interface CleanupCounts {
  characters: number; unclaimed: number; recipes: number; cooldowns: number; levelRace: number; raceHall: number;
  seasons: number; runs: number; dungeonPoints: number; dungeonAchievements: number;
}

type Tx = Pick<Prisma.TransactionClient, "character" | "unclaimedCharacter" | "recipeKnown" | "professionCooldown" | "levelRaceEntry" | "raceHallEntry"
  | "dungeonSeason" | "dungeonRun" | "dungeonPointTransaction" | "dungeonAchievement" | "discordJob">;

/** Deletes a plan's rows inside the caller's transaction (one per guild), then asks the bot to redraw. */
export async function applyPrelaunchCleanup(tx: Tx, guildId: string, plan: CleanupPlan): Promise<CleanupCounts> {
  const seasonIds = plan.seasons.map((season) => season.id);
  const byRunOrSeason = { guildId, OR: [{ runId: { in: plan.runIds } }, { seasonId: { in: seasonIds } }] };
  const dungeonPoints = (await tx.dungeonPointTransaction.deleteMany({ where: byRunOrSeason })).count;
  const dungeonAchievements = (await tx.dungeonAchievement.deleteMany({ where: byRunOrSeason })).count;
  const counts: CleanupCounts = {
    dungeonPoints, dungeonAchievements,
    runs: (await tx.dungeonRun.deleteMany({ where: { guildId, id: { in: plan.runIds } } })).count,
    seasons: (await tx.dungeonSeason.deleteMany({ where: { guildId, id: { in: seasonIds } } })).count,
    recipes: (await tx.recipeKnown.deleteMany({ where: { guildId, id: { in: plan.recipeIds } } })).count,
    cooldowns: (await tx.professionCooldown.deleteMany({ where: { guildId, id: { in: plan.cooldownIds } } })).count,
    levelRace: (await tx.levelRaceEntry.deleteMany({ where: { guildId, id: { in: plan.levelRaceIds } } })).count,
    raceHall: (await tx.raceHallEntry.deleteMany({ where: { guildId, id: { in: plan.raceHallIds } } })).count,
    unclaimed: (await tx.unclaimedCharacter.deleteMany({ where: { guildId, id: { in: plan.unclaimed.map((row) => row.id) } } })).count,
    // Scoped to this guild and to Forever: a stale id from another guild can never match.
    characters: (await tx.character.deleteMany({ where: { member: { guildId }, gameEdition: "forever", id: { in: plan.characters.map((row) => row.id) } } })).count
  };
  // The live bot redraws the Discord surfaces (no second Discord login from the script).
  if (counts.characters || counts.recipes || counts.cooldowns || counts.unclaimed) await enqueueDiscordJob(tx, guildId, "professions", "PROFESSIONS");
  if (counts.characters || counts.unclaimed || counts.levelRace || counts.raceHall) await enqueueDiscordJob(tx, guildId, "race-board", "RACE_BOARD");
  if (counts.runs || counts.seasons) await enqueueDiscordJob(tx, guildId, "dungeon-board", "DUNGEON_BOARD");
  return counts;
}

/** Owner-readable preview for one guild. */
export function describeCleanup(guildName: string, plan: CleanupPlan, dependents: Record<string, number> = {}): string[] {
  const names = (rows: { name: string; displayName?: string | null; realm: string }[]) => rows.slice(0, 40).map((row) => `${row.displayName ?? row.name} (${row.realm})`).join(", ")
    + (rows.length > 40 ? `, … ${rows.length - 40} more` : "");
  const lines = [`${guildName}:`];
  lines.push(`  characters: ${plan.characters.length}${plan.characters.length ? ` - ${names(plan.characters)}` : ""}`);
  const extra = Object.entries(dependents).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`);
  if (extra.length) lines.push(`    removed with them: ${extra.join(", ")}`);
  lines.push(`  unlinked characters: ${plan.unclaimed.length}${plan.unclaimed.length ? ` - ${names(plan.unclaimed)}` : ""}`);
  lines.push(`  recipes: ${plan.recipeIds.length}, profession cooldowns: ${plan.cooldownIds.length}`);
  lines.push(`  race to 60: ${plan.levelRaceIds.length} board entries, ${plan.raceHallIds.length} hall of fame entries`);
  lines.push(`  dungeon seasons: ${plan.seasons.length}${plan.seasons.length ? ` - ${plan.seasons.map((s) => `"${s.name}"`).join(", ")}` : ""}; dungeon runs: ${plan.runIds.length} (with their points and dungeon achievements)`);
  for (const note of plan.ambiguous) lines.push(`  KEPT, CHECK: ${note}`);
  return lines;
}
