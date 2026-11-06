import type { PrismaClient } from "../generated/prisma/client.js";
import type { AddonSnapshot } from "../integrations/addon.js";
import { gameEditionOf } from "./game-edition.js";
import { findCharacter } from "./character-match.js";
import { syncProfessionSnapshot } from "./profession-snapshot.js";

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
    const players = new Set((Array.isArray(run.players) ? run.players : [])
      .map((player) => baseName((player as { character?: unknown } | null)?.character)).filter(Boolean));
    if (!players.size) continue;
    const own = [...ownedNames].some((name) => players.has(name));
    const reporters = Array.isArray(run.reporterNames) ? run.reporterNames.map(baseName).filter(Boolean) : [];
    if (own || reporters.some((name) => players.has(name))) kept.push({ run: raw, endedAt });
  }
  return kept.sort((a, b) => b.endedAt - a.endedAt).slice(0, RELAYED_RUNS_PER_UPLOAD).map((entry) => entry.run);
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
      // only when newer than what is stored (first-hand or relayed alike).
      const at = entry.professionsAt;
      if (entry.professionsComplete === true && at && at.getTime() <= now.getTime() + FUTURE_SLACK_MS
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
