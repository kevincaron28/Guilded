/**
 * French typography for text the bot writes itself (20 Nov 2026 polish round): a non-breaking space before : ; ! ? and
 * inside « », so a line never wraps with a lone "?" or "»" at the start of the next one. Applied to French templates only
 * (never to member-supplied values), by `t()` and `tx()` in i18n.ts.
 */
const NBSP = " ";

export function frenchTypography(template: string): string {
  return template
    // an ordinary space before : ; ! ? becomes a non-breaking one (the common case: already written with a space)
    .replace(/(\S) ([:;!?])(?=\s|$|[)»*_~"'])/gu, `$1${NBSP}$2`)
    // "ça marche!" -> "ça marche !": a letter, digit or closing mark glued to ! or ? at the end of a word (URLs, code and "?x=" stay as written)
    .replace(/([\p{L}\p{N})\]*_~])([!?])(?=\s|$|[)»*_~"'])/gu, `$1${NBSP}$2`)
    // « text »: the quotes keep their text on the same line
    .replace(/« /gu, `«${NBSP}`)
    .replace(/ »/gu, `${NBSP}»`);
}
