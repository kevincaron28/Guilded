// (9.3.5) The in-game dungeon result card shows each player's level, guild, score gained this run and season total. The bot sends
// them with its run receipts as `runCards` ({ runRef: [{ n, l, g, a, t }] }, newest runs first, five players at most); this module
// cleans them and writes the GuildedDungeonCards global the addon reads. An older bot sends none and an older addon ignores the global.

export const MAX_CARD_RUNS = 30;
export const MAX_CARD_PLAYERS = 5;
const QUOTED = String.raw`"((?:[^"\\]|\\.)*)"`;
const luaString = (value) => `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/[\r\n]/g, " ")}"`;
const unquote = (text) => text.replace(/\\(["\\])/g, "$1");
const whole = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value < 1e7 ? Math.round(value) : undefined;

/** The valid part of a `runCards` answer: at most MAX_CARD_RUNS runs of MAX_CARD_PLAYERS players, anything malformed dropped. */
export function cleanRunCards(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [ref, rows] of Object.entries(raw)) {
    if (Object.keys(out).length >= MAX_CARD_RUNS) break;
    if (!ref || ref.length > 200 || !Array.isArray(rows)) continue;
    const players = rows.flatMap((row) => {
      if (!row || typeof row.n !== "string" || !row.n.trim()) return [];
      const [l, a, t] = [whole(row.l), whole(row.a), whole(row.t)];
      return [{ n: row.n.trim().slice(0, 40), ...(l !== undefined ? { l } : {}), ...(typeof row.g === "string" && row.g.trim() ? { g: row.g.trim().slice(0, 24) } : {}), ...(a !== undefined && t !== undefined ? { a, t } : {}) }];
    }).slice(0, MAX_CARD_PLAYERS);
    if (players.length) out[ref] = players;
  }
  return out;
}

const playerLua = (p) => `{ n = ${luaString(p.n)}${p.l !== undefined ? `, l = ${p.l}` : ""}${p.g ? `, g = ${luaString(p.g)}` : ""}${p.t !== undefined ? `, a = ${p.a}, t = ${p.t}` : ""} }`;
const runLua = (ref, players) => `[${luaString(ref)}] = { ${players.map(playerLua).join(", ")} },`;

/** The `GuildedDungeonCards = { ... }` block, one run per line (parseRunCards reads it back). Empty cards write an empty table. */
export function runCardsToLua(cards) {
  return ["GuildedDungeonCards = {", ...Object.entries(cleanRunCards(cards)).map(([ref, players]) => `  ${runLua(ref, players)}`), "}"];
}

/** The same cards for Guilded Dungeons' Accepted.lua: they are added to a table Guilded's own file may already have defined. */
export function runCardsToAddLua(cards) {
  return ["GuildedDungeonCards = type(GuildedDungeonCards) == \"table\" and GuildedDungeonCards or {}",
    ...Object.entries(cleanRunCards(cards)).map(([ref, players]) => `GuildedDungeonCards[${luaString(ref)}] = { ${players.map(playerLua).join(", ")} }`)];
}

/** The cards a file written by runCardsToLua holds (anything else in it is ignored). */
export function parseRunCards(text) {
  const block = new RegExp(String.raw`GuildedDungeonCards = \{([\s\S]*?)\n\}`).exec(text ?? "")?.[1] ?? "";
  const cards = {};
  const player = new RegExp(String.raw`\{ n = ${QUOTED}(?:, l = (\d+))?(?:, g = ${QUOTED})?(?:, a = (\d+), t = (\d+))? \}`, "g");
  for (const line of block.split("\n")) {
    const ref = new RegExp(String.raw`^\s*\[${QUOTED}\] = \{ (.*) \},\s*$`).exec(line);
    if (!ref) continue;
    const players = [...ref[2].matchAll(player)].map((m) => ({ n: unquote(m[1]), ...(m[2] ? { l: Number(m[2]) } : {}), ...(m[3] !== undefined ? { g: unquote(m[3]) } : {}), ...(m[4] ? { a: Number(m[4]), t: Number(m[5]) } : {}) }));
    if (players.length) cards[unquote(ref[1])] = players;
  }
  return cleanRunCards(cards);
}

/** Newest answer first; runs of earlier answers stay until MAX_CARD_RUNS is reached. */
export function mergeRunCards(previous, answer) {
  return cleanRunCards({ ...cleanRunCards(answer), ...Object.fromEntries(Object.entries(cleanRunCards(previous)).filter(([ref]) => !(ref in cleanRunCards(answer)))) });
}
