import { drawable, type ScoreCard } from "./score-card.js";

/** Discord allows 1,024 characters of alt text on an attachment. */
const MAX_ALT = 1000;

/**
 * A short description of a card for the image's alt text (screen readers, and anyone whose client does not show the picture):
 * what it is, its title and subtitle, the headline figures, and the first few rows. Built from the card itself, so a card
 * stored before this existed gets one too. Never throws and never returns more than MAX_ALT characters.
 */
export function cardAltText(card: ScoreCard): string {
  try {
    const parts: string[] = [];
    const add = (text: string | undefined) => { const clean = text ? drawable(text).replace(/\s+/g, " ").trim() : ""; if (clean) parts.push(clean); };
    add(card.eyebrow); add(card.title); add(card.subtitle);
    for (const stat of card.stats.slice(0, 4)) add(`${stat.label}: ${stat.value}${stat.note ? ` (${stat.note})` : ""}`);
    if (card.dungeon) for (const member of card.dungeon.party.slice(0, 6)) add(`${member.name}${member.roleLabel ? `, ${member.roleLabel}` : ""}`);
    else if (card.ladder) for (const row of card.ladder.boards.flatMap(board => board.rows).slice(0, 5)) add(`${row.rank}. ${row.name} ${row.values.filter(Boolean)[0] ?? ""}`);
    else if (card.rows) for (const row of card.rows.slice(0, 5)) add(`${row.name}${row.right ? ` ${row.right}` : ""}`);
    if (card.record) add(`${card.record.ribbon}: ${card.record.diffLabel}`);
    const text = parts.join(". ");
    return text.length > MAX_ALT ? `${text.slice(0, MAX_ALT - 1)}…` : text;
  } catch { return ""; }
}
