// Parses WoW item links out of chat text (item previews, docs/ITEM_PREVIEWS.md).
// No regular expression is run over the whole message: it is scanned with indexOf and hard caps, so a
// hostile message cannot cause backtracking. Two shapes are understood:
//   raw link   |cff0070dd|Hitem:2092:0:0:0:0:0:-1234:0:60|h[Name]|h|r  -> verified numeric id
//   bracket    [Name]                                                  -> name only, unverified
// A relay that keeps only the bracket text yields unverified entries; the code never guesses an id.

export const MAX_MESSAGE_SCAN = 2000;
export const MAX_ITEMS_PER_MESSAGE = 5;
export const MAX_NAME_LENGTH = 60;
const MAX_LINK_LENGTH = 200;

export interface ParsedItem {
  /** Numeric item id; present only for raw links. */
  itemId: number | null;
  /** Item name as shown in the brackets. */
  name: string;
  /** "verified" = a numeric id came from the link itself; otherwise the name is all we know. */
  verified: boolean;
  /** Enchant id from the link, when non-zero. */
  enchantId?: number;
  /** Random-suffix id from the link (negative = "of the Owl"-style suffix), when non-zero. */
  suffixId?: number;
  /** Item quality 0-5 from the colour code, when present and recognised. */
  quality?: number;
}

const QUALITY_BY_COLOR: Record<string, number> = {
  "9d9d9d": 0, "ffffff": 1, "1eff00": 2, "0070dd": 3, "a335ee": 4, "ff8000": 5
};

const isDigits = (value: string) => value.length > 0 && value.length <= 9 && [...value].every(c => c >= "0" && c <= "9");
const toInt = (value: string | undefined): number | null => {
  if (value === undefined || value === "") return null;
  const negative = value.startsWith("-");
  const digits = negative ? value.slice(1) : value;
  if (!isDigits(digits)) return null;
  return (negative ? -1 : 1) * Number(digits);
};

const collapse = (raw: string): string => {
  let out = "";
  let space = false;
  for (const c of raw) {
    if (c === " " || c === "\t" || c === "\n" || c === "\r") { space = true; continue; }
    if (space && out) out += " ";
    space = false;
    out += c;
  }
  return out;
};

const cleanName = (raw: string): string | null => {
  const name = collapse(raw);
  if (name.length < 2 || name.length > MAX_NAME_LENGTH) return null;
  if ([...name].some(c => c === "[" || c === "]" || c === "|" || c < " ")) return null;
  // Needs at least one letter (any script), so "[1]" or "[...]" are not items.
  if (!/\p{L}/u.test(name)) return null;
  return name;
};

const colorBefore = (text: string, linkStart: number): number | undefined => {
  // "|cffRRGGBB" sits immediately before "|Hitem" (10 characters).
  const colorStart = linkStart - 10;
  if (colorStart < 0 || text.slice(colorStart, colorStart + 4).toLowerCase() !== "|cff") return undefined;
  return QUALITY_BY_COLOR[text.slice(colorStart + 4, linkStart).toLowerCase()];
};

export function parseItemLinks(input: string): ParsedItem[] {
  const text = input.length > MAX_MESSAGE_SCAN ? input.slice(0, MAX_MESSAGE_SCAN) : input;
  const found: ParsedItem[] = [];
  const seen = new Set<string>();
  const add = (item: ParsedItem) => {
    const key = item.verified ? `id:${item.itemId}:${item.suffixId ?? 0}:${item.enchantId ?? 0}` : `name:${item.name.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push(item);
  };

  // Pass 1: raw links. Remember their ranges so the bracket pass does not read them again.
  const consumed: Array<[number, number]> = [];
  const lower = text.toLowerCase();
  let cursor = 0;
  while (found.length < MAX_ITEMS_PER_MESSAGE) {
    const start = lower.indexOf("|hitem:", cursor);
    if (start < 0) break;
    cursor = start + 7;
    const nameOpen = text.indexOf("|h[", start);
    if (nameOpen < 0 || nameOpen - start > MAX_LINK_LENGTH) continue;
    const nameClose = text.indexOf("]|h", nameOpen + 3);
    if (nameClose < 0 || nameClose - nameOpen > MAX_NAME_LENGTH + 6) continue;
    const fields = text.slice(start + 7, nameOpen).split(":");
    const itemId = toInt(fields[0]);
    const name = cleanName(text.slice(nameOpen + 3, nameClose));
    if (itemId === null || itemId <= 0 || !name) continue;
    const enchant = toInt(fields[1]);
    const suffix = toInt(fields[6]);
    const quality = colorBefore(text, start);
    consumed.push([Math.max(0, start - 10), nameClose + 3]);
    add({
      itemId, name, verified: true,
      ...(enchant ? { enchantId: enchant } : {}),
      ...(suffix ? { suffixId: suffix } : {}),
      ...(quality !== undefined ? { quality } : {})
    });
    cursor = nameClose + 3;
  }

  // Pass 2: bracket-only names outside raw links.
  cursor = 0;
  while (found.length < MAX_ITEMS_PER_MESSAGE) {
    const open = text.indexOf("[", cursor);
    if (open < 0) break;
    cursor = open + 1;
    if (consumed.some(([a, b]) => open >= a && open < b)) continue;
    const close = text.indexOf("]", open + 1);
    if (close < 0) break;
    if (close - open > MAX_NAME_LENGTH + 1) continue;
    const name = cleanName(text.slice(open + 1, close));
    if (!name) continue;
    cursor = close + 1;
    add({ itemId: null, name, verified: false });
  }
  return found;
}
