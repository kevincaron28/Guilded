/**
 * Who a card names (20 Nov 2026). Server nicknames read "Discord name (Main character)": that form is kept as the one name line.
 * The acting character gets a line of its own only when it is not already visible in that name, so a card never says the same
 * character twice (title, subtitle, caption).
 */
const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** The "(Main)" part of a "Discord (Main)" name, or "". */
export function mainOf(display: string): string {
  return /\(([^()]+)\)\s*$/.exec(display.trim())?.[1]?.trim() ?? "";
}

/** `name` is the line to show; `character` is set only when it adds something the name does not already contain. */
export function cardIdentity(display: string, character: string): { name: string; character?: string } {
  const name = display.trim(), ch = character.trim();
  if (!name) return { name: ch };
  if (!ch) return { name };
  const p = plain(ch), n = plain(name);
  return n.includes(p) || p === plain(mainOf(name)) ? { name } : { name, character: ch };
}
