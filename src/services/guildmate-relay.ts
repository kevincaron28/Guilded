import type { PrismaClient } from "../generated/prisma/client.js";
import type { AddonSnapshot } from "../integrations/addon.js";
import { gameEditionOf } from "./game-edition.js";
import { findCharacter } from "./character-match.js";
import { syncProfessionSnapshot } from "./profession-snapshot.js";
import { foreverSameName } from "../../companion/character-identity.mjs";

// Addon-only members still reach Discord (8.5, Track K; docs/ADDON_ONLY_SYNC.md).
//
// A member without the companion tells the guild who they are in game (level, class, race and
// professions in the READINESS digest) and shares their finished dungeon runs (SUM). Every
// guildmate's addon keeps those under the name the game says sent them, so any guildmate's
// companion upload carries them. An officer's upload was already trusted with all of it; a paired
// member's upload was cut to that member's own characters. This file is the narrow lane through
// which a member's upload now relays guildmates' data, under these rules:
//   * never links or creates a character (linking stays with /guilded verify, character-verify.ts);
//   * never touches the uploader's own characters (their own upload is first-hand);
//   * never replaces newer first-hand data: levels only go up, class and race only fill a blank,
//     professions only when the author's own clock says they are newer (syncProfessionSnapshot);
//   * every change is stamped relayedAt / relayedById ("reported by a guildmate").
// Dungeon runs keep their own checks (dungeon-rules validateRun: the recorder and a reporter must
// have been in the run; dungeon-import: one row per run id, so a later copy never doubles points).

/** Digests heard longer ago than this are stale (the addon prunes them too). */
export const RELAY_MAX_AGE_MS = 45 * 24 * 3600 * 1000;
/** A clock a little ahead is tolerated; further ahead is not believed. */
const FUTURE_SLACK_MS = 10 * 60 * 1000;
const CHARACTERS_PER_UPLOAD = 300;
/** Dungeon runs a member's upload may carry: its own, and guildmates' witnessed ones. */
export const RELAYED_RUNS_PER_UPLOAD = 25;
export const RELAYED_RUN_MAX_AGE_SEC = 30 * 24 * 3600;

const baseName = (value: unknown) => typeof value === "string" ? value.split("-")[0]!.trim().toLowerCase() : "";

/**
 * The dungeon runs a paired member's upload may carry. A run is kept when one of the uploader's
 * own characters played it (first-hand), or when it reached the uploader's addon from someone who
 * played it (reporterNames, which the addon fills only with the game-reported sender of a SUM it
 * accepted from a participant). Recent runs only, newest first, capped.
 */
export function relayableDungeonRuns(runs: readonly unknown[], ownedNames: ReadonlySet<string>, nowSec = Math.floor(Date.now() / 1000)): unknown[] {
  const kept: { run: unknown; endedAt: number }[] = [];
  for (const raw of runs) {
    if (!raw || typeof raw !== "object") continue;
    const run = raw as { players?: unknown; reporterNames?: unknown; endedAt?: unknown };
    const endedAt = Number(run.endedAt);
    if (!Number.isFinite(endedAt) || endedAt <= 0 || endedAt < nowSec - RELAYED_RUN_MAX_AGE_SEC || endedAt > nowSec + 600) continue;
    const players = (Array.isArray(run.players) ? run.players : [])
      .map((player) => baseName((player as { character?: unknown } | null)?.character)).filter(Boolean);
    if (!players.length) continue;
    // Forever names: a first-name row from before 8.5 still matches "First Last" (foreverSameName).
    const played = (name: string) => players.some((player) => foreverSameName(player, name));
    const own = [...ownedNames].some(played);
    const reporters = Array.isArray(run.reporterNames) ? run.reporterNames.map(baseName).filter(Boolean) : [];
    if (own || reporters.some(played)) kept.push({ run: raw, endedAt });
  }
  return kept.sort((a, b) => b.endedAt - a.endedAt).slice(0, RELAYED_RUNS_PER_UPLOAD).map((entry) => entry.run);
}

/** Crafting data a member's upload may relay (9.1): at most this many recipe lists and attunements. */
export const RELAYED_RECIPE_SETS_PER_UPLOAD = 150;
export const RELAYED_COOLDOWN_SETS_PER_UPLOAD = 100;
export const RELAYED_ATTUNEMENTS_PER_UPLOAD = 300;
/** A recipe list is a slow-changing fact: its author's stamp may be this old (the addon keeps lists 45 days when forwarding). */
export const RELAYED_RECIPE_MAX_AGE_MS = 180 * 24 * 3600 * 1000;

export interface RelayLinkedCharacter { name: string; realm: string; memberId: string; gameEdition?: string }
type CraftSnapshot = Pick<AddonSnapshot, "recipes" | "recipeNames" | "cooldowns" | "attunements" | "gameEdition" | "interface">;

/**
 * Guildmates' recipe lists, profession cooldowns and attunements that reached the uploader's addon
 * (their own broadcasts, or a catch-up forward) and are in the uploader's companion upload (9.1).
 * Only what the guild already sees, and only for characters that are already linked in this guild:
 *   * never the uploader's own characters (their own upload is first-hand and handled separately);
 *   * a stamp is believed only up to "now": a list from the future is clamped to the upload time, so
 *     a relayer can never out-date its owner's next real scan by more than the time of this upload;
 *   * recipe lists older than 180 days are ignored; applyRecipeData still keeps only the NEWEST list
 *     per character and profession, so a relay never replaces newer data and never counts twice;
 *   * attunements only ever say "completed" (a relay cannot take an attunement away);
 *   * capped per upload; names only for recipes that are kept.
 */
export function relayableCraftData(snapshot: CraftSnapshot, uploaderMemberId: string, linked: readonly RelayLinkedCharacter[],
  now = new Date()): Pick<AddonSnapshot, "recipes" | "recipeNames" | "cooldowns" | "attunements"> {
  const edition = gameEditionOf(snapshot);
  const others = linked.filter((row) => row.memberId !== uploaderMemberId);
  const isOther = (name: string, realm: string) => {
    const hit = findCharacter(linked, name, realm, edition);
    return !!hit && hit.memberId !== uploaderMemberId && others.includes(hit);
  };
  const clamp = (at: Date) => at.getTime() > now.getTime() ? now : at;
  const recipes = snapshot.recipes
    .filter((set) => set.keys.length > 0 && now.getTime() - set.at.getTime() <= RELAYED_RECIPE_MAX_AGE_MS && isOther(set.character, set.realm))
    .slice(0, RELAYED_RECIPE_SETS_PER_UPLOAD).map((set) => ({ ...set, at: clamp(set.at) }));
  const used = new Set(recipes.flatMap((set) => set.keys.map(String)));
  const recipeNames = Object.fromEntries(Object.entries(snapshot.recipeNames).filter(([key]) => used.has(key)));
  const cooldowns = snapshot.cooldowns
    .filter((set) => set.entries.length > 0 && now.getTime() - set.at.getTime() <= RELAY_MAX_AGE_MS && isOther(set.character, set.realm))
    .slice(0, RELAYED_COOLDOWN_SETS_PER_UPLOAD).map((set) => ({ ...set, at: clamp(set.at) }));
  const attunements = snapshot.attunements
    .filter((row) => row.completed && isOther(row.character, row.realm)).slice(0, RELAYED_ATTUNEMENTS_PER_UPLOAD);
  return { recipes, recipeNames, cooldowns, attunements };
}

export interface GuildmateRelayResult {
  /** Characters whose level, class or race changed. */
  updated: number;
  /** Characters whose professions changed. */
  professions: number;
  /** Guildmates heard in game who are not linked to anyone yet (left alone). */
  unlinked: number;
  /** Older than first-hand data, too old, from the future, or the uploader's own. */
  ignored: number;
}

type RelayDatabase = Pick<PrismaClient, "$transaction">;

/** The stored skills already say exactly this (names trimmed, order and case of listing ignored). */
function sameProfessions(stored: readonly { profession: string; skillLevel: number }[], heard: readonly { name: string; skillLevel: number }[]): boolean {
  const key = (name: string, skill: number) => `${name.trim().toLowerCase()}:${skill}`;
  const a = new Set(stored.map((row) => key(row.profession, row.skillLevel)));
  const b = new Set(heard.filter((row) => row.name.trim()).map((row) => key(row.name, row.skillLevel)));
  return a.size === b.size && [...a].every((item) => b.has(item));
}

/**
 * Applies guildmates' self-reported digests from a paired member's upload to characters that are
 * already linked in this guild. See the rules at the top of this file.
 */
export async function applyGuildmateRelay(database: RelayDatabase, guildId: string, uploaderMemberId: string,
  snapshot: Pick<AddonSnapshot, "characters" | "gameEdition" | "interface">, now = new Date()): Promise<GuildmateRelayResult> {
  const result: GuildmateRelayResult = { updated: 0, professions: 0, unlinked: 0, ignored: 0 };
  const edition = gameEditionOf(snapshot);
  const entries = snapshot.characters.filter((entry) => entry.observedAt && entry.class).slice(0, CHARACTERS_PER_UPLOAD);
  if (!entries.length) return result;
  return database.$transaction(async (tx) => {
    const linked = await tx.character.findMany({
      where: { member: { guildId }, gameEdition: edition },
      select: { id: true, name: true, realm: true, memberId: true, gameEdition: true, level: true, className: true, race: true }
    });
    for (const entry of entries) {
      const observed = entry.observedAt!.getTime();
      if (observed > now.getTime() + FUTURE_SLACK_MS || now.getTime() - observed > RELAY_MAX_AGE_MS) { result.ignored++; continue; }
      const character = findCharacter(linked, entry.name, entry.realm, edition);
      if (!character) { result.unlinked++; continue; }
      if (character.memberId === uploaderMemberId) { result.ignored++; continue; }
      const data: { level?: number; className?: string; race?: string } = {};
      if (entry.level > 0 && entry.level > (character.level ?? 0)) data.level = entry.level;
      if ((!character.className || character.className === "UNKNOWN") && entry.class) data.className = entry.class;
      if (!character.race && entry.race) data.race = entry.race;
      let changed = false;
      if (Object.keys(data).length) {
        await tx.character.update({ where: { id: character.id }, data });
        Object.assign(character, data);
        result.updated++;
        changed = true;
      }
      // Only a complete list stamped by the author's own client can replace professions, and
      // only when newer than what is stored (first-hand or relayed alike) AND different: every
      // guildmate's 10-minute digest carries a fresh stamp, so a newer stamp alone is no change
      // (8.5 hotfix: counting it made every member upload a "change" and starved the standings feed).
      const at = entry.professionsAt;
      if (entry.professionsComplete === true && at && at.getTime() <= now.getTime() + FUTURE_SLACK_MS
        && !sameProfessions(await tx.professionSkill.findMany({ where: { characterId: character.id }, select: { profession: true, skillLevel: true } }), entry.professions)
        && await syncProfessionSnapshot(tx, guildId, character, entry.professions, true, at)) {
        result.professions++;
        changed = true;
      }
      if (changed) await tx.character.update({ where: { id: character.id }, data: { relayedAt: now, relayedById: uploaderMemberId } });
      else result.ignored++;
    }
    return result;
  }, { timeout: 60_000, maxWait: 15_000 });
}
