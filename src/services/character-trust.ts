import type { PrismaClient } from "../generated/prisma/client.js";
import { characterKey } from "../../companion/character-identity.mjs";

// "Reported, not verified" (docs/JEEVES_COMPARISON.md idea 1). WoW Forever has no Blizzard API, so
// every character comes from a client. Some sources prove the character is the member's, others only
// say so. Shown next to each character on /me/data, /character list, /who and /officer roster gaps;
// nickname sync only uses a confirmed main (nickname-sync.ts).
//
// Linking audit T8 (owner decision, 10 November 2026). Confirmed when:
//   * the member's own signed-in companion uploaded it (Character.confirmedAt) AND something outside
//     that companion agrees: the character is in the guild roster the companions sync from the game
//     (GuildRosterEntry, still in the guild), or a guildmate's addon heard the member's /guilded verify
//     code from it (CharacterVerifyClaim PROVISIONAL or LINKED, or linkEvidence "heard"); or
//   * an officer vouched for it: /officer character link or move (linkEvidence "officer"), or an
//     officer's own addon heard the code (CharacterVerifyClaim LINKED).
// Grandfathered (owner decision, 10 November 2026: "grandfather the old links"): a character whose confirmedAt is
// before T8_STRICT_FROM, the instant the strict rule went live, stays confirmed exactly as before T8 (the member's own
// companion or an officer linked it). The strict rule above applies only to links confirmed at or after it.
// Reported otherwise: typed in, matched by name, named in an invite request, heard by a guildmate's
// addon without the member's own companion, or uploaded by the member's companion alone (a saved file
// can name any character).
// Nothing is migrated: confirmedAt keeps meaning "their own companion uploaded it" and the rule is
// applied when trust is read. Two kinds of row that were confirmed are now reported until the roster
// or a verify code agrees: own-companion characters that are not in the synced roster, and characters
// an officer linked by hand before linkEvidence existed (their confirmedAt cannot be told apart).

export type CharacterTrust = "confirmed" | "reported";

export interface TrustedCharacter {
  id: string;
  memberId: string;
  name: string;
  realm: string;
  gameEdition?: string | null;
  confirmedAt?: Date | null;
  linkEvidence?: string | null;
}

/** What agrees with a link from outside the member's own companion. */
export interface TrustProof {
  /** The member's verify claim for this character: LINKED (an officer's addon) or PROVISIONAL (a guildmate's). */
  claim?: string | null;
  /** The character is in the synced guild roster and still in the guild. */
  inRoster?: boolean;
}

const nameKeyOf = (character: TrustedCharacter) => characterKey(character.name, character.realm, character.gameEdition ?? "forever");
const keyOf = (character: TrustedCharacter) => `${character.memberId}\n${nameKeyOf(character)}`;

/** When the strict rule (T8, #724) went live on the bot. Older links keep the pre-T8 meaning of confirmedAt. */
export const T8_STRICT_FROM = new Date("2026-11-10T15:14:00Z");

/** Pure: one character's trust from its own fields and what agrees with them. */
export function characterTrust(character: Pick<TrustedCharacter, "confirmedAt" | "linkEvidence">, proof: TrustProof = {}): CharacterTrust {
  if (character.linkEvidence === "officer" || proof.claim === "LINKED") return "confirmed";
  if (character.confirmedAt && character.confirmedAt < T8_STRICT_FROM) return "confirmed";
  const heard = proof.claim === "PROVISIONAL" || character.linkEvidence === "heard";
  return character.confirmedAt && (heard || proof.inRoster) ? "confirmed" : "reported";
}

type TrustDatabase = Pick<PrismaClient, "characterVerifyClaim" | "guildRosterEntry">;

/** Each character's trust (by id): one query for the verify claims of their members, one for the roster. */
export async function characterTrustMap(database: TrustDatabase, guildId: string, characters: readonly TrustedCharacter[]): Promise<Map<string, CharacterTrust>> {
  const result = new Map<string, CharacterTrust>();
  const open = characters.filter((character) => character.linkEvidence !== "officer");
  const claimed = new Map<string, string>();
  const roster = new Set<string>();
  if (open.length) {
    const claims = await database.characterVerifyClaim.findMany({
      where: { guildId, status: { in: ["LINKED", "PROVISIONAL"] }, memberId: { in: [...new Set(open.map((character) => character.memberId))] } },
      select: { memberId: true, nameKey: true, status: true }
    });
    for (const claim of claims) claimed.set(`${claim.memberId}\n${claim.nameKey}`, claim.status);
    // Only a character the member's own companion uploaded can be confirmed by the roster.
    const own = open.filter((character) => character.confirmedAt && character.confirmedAt >= T8_STRICT_FROM && claimed.get(keyOf(character)) !== "LINKED");
    if (own.length) {
      const rows = await database.guildRosterEntry.findMany({
        where: { guildId, inGuild: true, nameKey: { in: [...new Set(own.map(nameKeyOf))] } },
        select: { nameKey: true, gameEdition: true }
      });
      for (const row of rows) roster.add(`${row.gameEdition}\n${row.nameKey}`);
    }
  }
  for (const character of characters) {
    result.set(character.id, characterTrust(character, { claim: claimed.get(keyOf(character)) ?? null, inRoster: roster.has(`${character.gameEdition ?? "forever"}\n${nameKeyOf(character)}`) }));
  }
  return result;
}

/** The short label, English or French. */
export function trustLabel(trust: CharacterTrust, lang: "en" | "fr" = "en"): string {
  if (trust === "confirmed") return lang === "fr" ? "confirmé" : "confirmed";
  return lang === "fr" ? "signalé, non vérifié" : "reported, not verified";
}

/** One line under a Discord list that shows a reported character (English; these commands are English-only). */
export const REPORTED_HINT = "Reported, not verified. It is confirmed once the member's own Guilded app has synced it and the guild roster (or a guildmate's addon hearing their /guilded verify line) agrees, or when an officer links it.";

/** For Discord lines: " · ✅ confirmed" or " · ⚠️ reported, not verified". */
export function trustSuffix(trust: CharacterTrust | undefined, lang: "en" | "fr" = "en"): string {
  if (!trust) return "";
  return ` · ${trust === "confirmed" ? "✅" : "⚠️"} ${trustLabel(trust, lang)}`;
}
