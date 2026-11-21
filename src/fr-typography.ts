/**
 * French typography for text the bot writes itself (20 Nov 2026 polish round): an existing space before : ; ! ? becomes non-breaking, and
 * inside « », so a line never wraps with a lone "?" or "»" at the start of the next one. Applied to French templates only
 * (never to member-supplied values), by `t()` and `tx()` in i18n.ts.
 */
const NBSP = " ";

export function frenchTypography(template: string): string {
  return template
    // an ordinary space before : ; ! ? becomes a non-breaking one (the common case: already written with a space)
    .replace(/(\S) ([:;!?])(?=\s|$|[)»*_~"'])/gu, `$1${NBSP}$2`)
    // Québec usage (owner's voice): a word glued to ! or ? ("Bravo!") stays as written; no space is added there.
    // « text »: the quotes keep their text on the same line
    .replace(/« /gu, `«${NBSP}`)
    .replace(/ »/gu, `${NBSP}»`);
}
