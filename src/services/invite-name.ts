// Reads a character name out of a sentence in the invite channel ("hello i would like to join the guilde my name is blah blah").
// WoW Forever characters have a first AND a last name and /ginvite needs both, so a lone first name is reported as such
// (the bot then asks for the last name). English and French. Pure: no Discord, no database.

export type ExtractedName =
  | { kind: "name"; displayName: string; nameKey: string; via: "phrase" | "capitalised" }
  | { kind: "first"; first: string }
  | { kind: "none" };

const WORD = /^[\p{L}][\p{L}'’-]{1,23}$/u;

// Greetings, filler and words that are never part of a character name (compared lowercase, accents folded).
const FILLER = new Set(`hello hi hey yo salut bonjour bonsoir coucou allo hola greetings thanks thank merci please pls plz svp stp s'il
 guild guilde guilds invite invitation invitations join joining rejoindre rejoins integrer intégrer entrer
 the a an to and or for of in on at my me mon ma mes moi je tu il on nous vous suis am is are was name nom perso personnage character char ign pseudo
 would like want wanna looking cherche cherches voudrais voudrait veux souhaite aimerais aimerait vouloir peux peut pouvez pourriez pourrais pouvoir can could possible
 new nouveau nouvelle joueur player here ici ce cette ces et ou avec dans pour dans sur de du des la le les un une au aux est c'est cest
 quebec québec gold discord wow forever wotlk classic server serveur level niveau lvl horde alliance
 i i'm im i'd ive i've it its it's that this what who how when where why if so but not no yes oui non pas ok okay ty thx
 ca ça ici stp sil s'il vous plait plaît plait guys everyone all folks team gang monde tous tout toute`.split(/\s+/).filter(Boolean));

// Phrases that introduce the name. `strong` ones accept lowercase names; `weak` ones need Capitalised words (so "i'm looking
// to join" never yields a name). Longest first.
const STRONG: RegExp[] = [
  /\bmy\s+(?:char(?:acter)?|toon|main)(?:\s+name)?\s+is\b/giu, /\bmy\s+(?:char(?:acter)?|toon|main)\b/giu, /\bmy\s+name\s+is\b/giu, /\bname\s+is\b/giu,
  /\bje\s+m['’]appelle\b/giu, /\bmon\s+nom\s+(?:est|c['’]est)\b/giu, /\bmon\s+(?:perso(?:nnage)?|personnage|pseudo)(?:\s+(?:est|c['’]est))?\b/giu,
  /\bnom\s+du\s+(?:perso(?:nnage)?|personnage)\s*(?:est|c['’]est)?\b/giu,
  /\bign\b/giu, /\bchar(?:acter)?\b/giu, /\bperso(?:nnage)?\b/giu, /\bpseudo\b/giu, /\binvite\b/giu, /\binviter\b/giu, /\bnom\b/giu, /\bname\b/giu
];
const WEAK: RegExp[] = [/\bi['’]?m\b/giu, /\bi\s+am\b/giu, /\bje\s+suis\b/giu, /\bc['’]est\b/giu, /\bit['’]?s\b/giu, /\bthis\s+is\b/giu];

const fold = (text: string): string => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
export const isFiller = (word: string): boolean => FILLER.has(fold(word)) || FILLER.has(word.toLowerCase());
const capital = (word: string): boolean => /^\p{Lu}/u.test(word);

/** Capitalises a name the way the game spells it: "blah" -> "Blah", "d'artagnan" keeps its inner letter, "smith-jones" -> "Smith-Jones". */
export function titleCase(word: string): string {
  return word.toLocaleLowerCase().replace(/(^|['’-])(\p{L})/gu, (_all, lead: string, letter: string) => `${lead}${letter.toLocaleUpperCase()}`);
}

function clean(text: string): string {
  return text
    .replace(/<a?:\w+:\d+>|<[@#&!]+\d+>|https?:\/\/\S+/g, " ")
    .replace(/\p{Extended_Pictographic}|\u200d|\ufe0f/gu, " ")
    .replace(/[*_`~|>"“”«»()[\]{}<>:;,.!?¡¿/\\=+]+/g, " ")
    .replace(/\s+/g, " ").trim();
}

const nameOf = (a: string, b: string): Extract<ExtractedName, { kind: "name" }> => {
  const displayName = `${titleCase(a)} ${titleCase(b)}`;
  return { kind: "name", displayName, nameKey: displayName.normalize("NFC").toLowerCase(), via: "phrase" };
};

/** Takes the words after a phrase: up to two name words, stopping at filler. */
function after(tokens: string[], from: number, needCapital: boolean): string[] {
  const out: string[] = [];
  for (let i = from; i < tokens.length && out.length < 2; i++) {
    const word = tokens[i]!;
    if (!WORD.test(word) || isFiller(word)) break;
    if (needCapital && !capital(word)) break;
    out.push(word);
  }
  return out;
}

/** The character name in a free-text message, or what is missing. */
export function extractInviteName(content: string | null | undefined): ExtractedName {
  const text = clean((content ?? "").split(/\r?\n/).slice(0, 6).join(" "));
  if (!text) return { kind: "none" };
  const tokens = text.split(" ");
  // Character offsets of every token, so a phrase match maps to a token index.
  const starts: number[] = [];
  let at = 0;
  for (const token of tokens) { starts.push(at); at += token.length + 1; }
  const indexAt = (offset: number): number => { let i = 0; while (i + 1 < starts.length && starts[i + 1]! <= offset) i++; return i; };

  let first: string | null = null;
  const tryPhrases = (patterns: RegExp[], needCapital: boolean): ExtractedName | null => {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) {
        const end = match.index! + match[0].length;
        if (end >= text.length) continue;
        const words = after(tokens, indexAt(end + 1), needCapital);
        if (words.length === 2) return nameOf(words[0]!, words[1]!);
        if (words.length === 1 && !first) first = titleCase(words[0]!);
      }
    }
    return null;
  };
  const phrase = tryPhrases(STRONG, false) ?? tryPhrases(WEAK, true);
  if (phrase) return phrase;

  // A lone run of Capitalised words: two in a row (greetings and filler dropped) is the name.
  const runs: string[][] = [];
  let run: string[] = [];
  tokens.forEach((word, i) => {
    const eligible = WORD.test(word) && !isFiller(word) && capital(word) && !(i === 0 && isFiller(word));
    if (eligible) run.push(word); else { if (run.length) runs.push(run); run = []; }
  });
  if (run.length) runs.push(run);
  const two = runs.find((candidate) => candidate.length === 2);
  if (two) return { ...nameOf(two[0]!, two[1]!), via: "capitalised" };
  if (first) return { kind: "first", first };
  const single = runs.find((candidate) => candidate.length === 1);
  return single ? { kind: "first", first: titleCase(single[0]!) } : { kind: "none" };
}
