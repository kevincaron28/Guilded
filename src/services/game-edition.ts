import { gameEditionOf, type GameEdition } from "../../companion/game-edition.mjs";
import type { AddonSnapshot } from "../integrations/addon.js";

export { gameEditionOf, type GameEdition };

export class GameEditionError extends Error {}

/** Validate the complete envelope before any linking, relay or ledger writes. */
export function assertSnapshotEdition(snapshot: AddonSnapshot, expected: GameEdition): void {
  try {
    if (expected !== "forever") throw new Error("Connected guild sync for this WoW edition is not enabled yet.");
    if (gameEditionOf(snapshot) !== expected) throw new Error(`This guild uses ${expected}; select a saved file from that WoW edition.`);
    for (const character of [snapshot.character, ...snapshot.alts, ...snapshot.characters]) {
      if (!character) continue;
      // Legacy peer records inherit the envelope; explicit metadata must agree.
      if ((character.gameEdition !== undefined || character.interface !== undefined) && gameEditionOf(character) !== expected) {
        throw new Error("The upload contains characters from different WoW editions.");
      }
    }
    for (const raw of snapshot.dungeonRuns) {
      if (!raw || typeof raw !== "object") continue; // Row validation reports malformed runs.
      if (gameEditionOf(raw) !== expected) throw new Error("The upload contains dungeon runs from a different WoW edition.");
    }
  } catch (error) {
    throw new GameEditionError(error instanceof Error ? error.message : "Invalid WoW edition metadata.");
  }
}
