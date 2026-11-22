import { selectedCharacter } from "./character-match.js";
import { tx, type Lang } from "../i18n.js";

/** The one next step for a member with no linked character (never a pick-list of unclaimed characters). */
export const LINK_NEXT_STEP = "DM your character's full name (First Last) to the bot, or type it in the guild-invite channel.";

/** LINK_NEXT_STEP in the guild's language. */
export const linkNextStep = (lang: Lang = "en"): string => tx(lang, LINK_NEXT_STEP);

/**
 * The member's own character for a command: the one they picked, else their main, else the only
 * one they have. Throws a message with the next step when there is none, or when a choice is needed.
 */
export function pickOwnCharacter<T extends { id?: string; name: string; realm: string; displayName?: string | null; isMain?: boolean }>(characters: readonly T[], requested: string | null | undefined, lang: Lang = "en"): T {
  if (requested?.trim()) {
    const picked = selectedCharacter(characters, requested);
    if (!picked) throw new Error(`${tx(lang, "That character is not linked to your profile.")} ${characters.length ? tx(lang, "Pick one from the list, or leave the character out to use your main.") : linkNextStep(lang)}`);
    return picked;
  }
  if (!characters.length) throw new Error(`${tx(lang, "You have no linked character yet.")} ${linkNextStep(lang)}`);
  if (characters.length === 1) return characters[0]!;
  const mains = characters.filter((character) => character.isMain);
  if (mains.length === 1) return mains[0]!;
  throw new Error(tx(lang, "You have several characters and no main set: pick one in the character option (`/character list` sets your main)."));
}
