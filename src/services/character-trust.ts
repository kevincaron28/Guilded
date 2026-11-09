import type { PrismaClient } from "../generated/prisma/client.js";
import { characterKey } from "../../companion/character-identity.mjs";

// "Reported, not verified" (docs/JEEVES_COMPARISON.md idea 1). WoW Forever has no Blizzard API, so
// every character comes from a client. Some sources prove the character is the member's, others only
// say so. Shown next to each character on /me/data, /character list, /who and /officer roster gaps.
//
// Confirmed when:
//   * the member's own signed-in companion uploaded it (Character.confirmedAt, set on every own upload),
//   * an officer linked it by hand (/officer character link, also confirmedAt), or
//   * an officer's upload heard the member's /guilded verify code (CharacterVerifyClaim LINKED).
// Reported otherwise: typed in (/character add, import code), matched by name, a guildmate's addon heard
// the code (PROVISIONAL), or an invite request named it. Rows from before 9.1 have no confirmedAt yet:
// they turn confirmed with the member's next companion upload.

export type CharacterTrust = "confirmed" | "reported";

export interface TrustedCharacter {
  id: string;
  memberId: string;
  name: string;
  realm: string;
  gameEdition?: string | null;
  confirmedAt?: Date | null;
}

const keyOf = (character: TrustedCharacter) => `${character.memberId}\n${characterKey(character.name, character.realm, character.gameEdition ?? "forever")}`;

/** Pure: one character's trust from its confirmedAt and whether its member's verify claim is LINKED. */
export function characterTrust(character: Pick<TrustedCharacter, "confirmedAt">, linkedClaim = false): CharacterTrust {
  return character.confirmedAt || linkedClaim ? "confirmed" : "reported";
}

/** Each character's trust (by id), reading the LINKED verify claims of their members in one query. */
export async function characterTrustMap(database: Pick<PrismaClient, "characterVerifyClaim">, guildId: string, characters: readonly TrustedCharacter[]): Promise<Map<string, CharacterTrust>> {
  const result = new Map<string, CharacterTrust>();
  const unconfirmed = characters.filter((character) => !character.confirmedAt);
  const linked = new Set<string>();
  if (unconfirmed.length) {
    const claims = await database.characterVerifyClaim.findMany({
      where: { guildId, status: "LINKED", memberId: { in: [...new Set(unconfirmed.map((character) => character.memberId))] } },
      select: { memberId: true, nameKey: true }
    });
    for (const claim of claims) linked.add(`${claim.memberId}\n${claim.nameKey}`);
  }
  for (const character of characters) result.set(character.id, characterTrust(character, linked.has(keyOf(character))));
  return result;
}

/** The short label, English or French. */
export function trustLabel(trust: CharacterTrust, lang: "en" | "fr" = "en"): string {
  if (trust === "confirmed") return lang === "fr" ? "confirmé" : "confirmed";
  return lang === "fr" ? "signalé, non vérifié" : "reported, not verified";
}

/** One line under a Discord list that shows a reported character (English; these commands are English-only). */
export const REPORTED_HINT = "Reported, not verified: typed in, matched by name or heard by a guildmate's addon. The member's next sync with the Guilded app (or an officer's link or sync) confirms it.";

/** For Discord lines: " · ✅ confirmed" or " · ⚠️ reported, not verified". */
export function trustSuffix(trust: CharacterTrust | undefined, lang: "en" | "fr" = "en"): string {
  if (!trust) return "";
  return ` · ${trust === "confirmed" ? "✅" : "⚠️"} ${trustLabel(trust, lang)}`;
}
