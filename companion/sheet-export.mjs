import { readDatabase } from "./lua-export-content.mjs";

// "Export to spreadsheet": CSV files from the addon's SavedVariables (Guilded.lua), the same
// five tables as /guilded sheet in game (Core.lua's sheetBuilders), one file per table.
// UTF-8 with a byte-order mark so Excel shows accents; values quoted as RFC 4180 says
// (commas, quotes and line breaks inside quotes, quotes doubled) and rows end with CRLF.

export const SHEET_TABLES = ["standings", "loot", "attendance", "raids", "dungeons"];
const BOM = "\uFEFF";
// The addon's limit for other officers' awards heard in game (Core.lua PEER_LEDGER_SECONDS).
const PEER_LEDGER_SECONDS = 12 * 60 * 60;

// A cell that starts with = + - @ is prefixed with ' so a spreadsheet never runs player-typed
// text as a formula (negative numbers stay numbers).
export function csvCell(value) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text) && Number.isNaN(Number(text))) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Rows (header first) as CSV text, with the byte-order mark. */
export function toCsv(rows) {
  return BOM + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

// Character names as the addon keys them: first word only, capitalized (Core.lua normalizeName).
function normalizeName(name) {
  if (typeof name !== "string") return null;
  const word = name.trim().match(/^[^\-\s]+/)?.[0] ?? "";
  return word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : null;
}

// "2026-10-18 20:15:00" from the addon's ISO stamps (or epoch seconds), like sheetTime in game.
function sheetTime(stamp) {
  if (stamp === null || stamp === undefined || stamp === "") return "";
  const text = typeof stamp === "number" ? new Date(stamp * 1000).toISOString().replace(/\.\d{3}Z$/, "Z") : String(stamp);
  return text.replace("T", " ").replace(/Z$/, "");
}

// A shift-clicked item link ("|cffa335ee|Hitem:19019::|h[Thunderfury]|h|r") as its plain name
// (Thunderfury).
const itemText = (value) => String(value ?? "").replace(/\|H[^|]*\|h\[?(.*?)\]?\|h/g, "$1").replace(/\|c[0-9a-fA-F]{8}|\|r/g, "");

const list = (value) => Array.isArray(value) ? value : value && typeof value === "object" ? Object.values(value) : [];
const table = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const num = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

// The guild pool's EP and GP for one character: the last standings the addon saved plus what
// Discord has not counted yet. A port of ns.effectiveStanding (Core.lua) without a core.
function effectiveStanding(db, name, now) {
  const s = db.standings && typeof db.standings === "object" ? db.standings : null;
  const players = table(s?.players);
  const baseGp = num(s?.baseGp);
  const baseline = players[name];
  let ep = num(baseline?.ep), gp = num(baseline?.gp);
  const accepted = table(db.acceptedLedgerRefs);
  const published = table(db.localPublishedRefs);
  for (const [character, account] of Object.entries(table(db.epgp))) {
    const other = players[character];
    const sameAccount = character === name || (baseline?.account && other && other.account === baseline.account);
    if (!sameAccount) continue;
    const ledger = list(account?.ledger);
    for (const entry of ledger) {
      if (entry.coreId) continue;
      const ref = `addon:qg:${entry.id}`;
      const inLocalPublish = s?.localPublish === true && published[entry.id];
      if (entry.voided) {
        const counted = entry.wasCounted || accepted[ref] || inLocalPublish;
        if (baseline && counted && !entry.voidAcked && !accepted[`void:${ref}`]) { ep -= num(entry.epAmount); gp -= num(entry.gpAmount); }
      } else if (!baseline || (entry.pending && !accepted[ref] && !inLocalPublish)) {
        ep += num(entry.epAmount); gp += num(entry.gpAmount);
      }
    }
    // Old standalone data can hold balances without a ledger.
    if (!baseline && ledger.length === 0) { ep += num(account?.ep); gp += num(account?.gp); }
  }
  for (const [id, peer] of Object.entries(table(db.peerLedger))) {
    if (peer.coreId || accepted[`addon:qg:${id}`] || now - num(peer.at) >= PEER_LEDGER_SECONDS) continue;
    const other = players[peer.name];
    if (peer.name === name || (baseline?.account && other && other.account === baseline.account)) { ep += num(peer.ep); gp += num(peer.gp); }
  }
  const denominator = gp + Math.max(0, baseGp);
  return { ep, gp, pr: denominator > 0 ? ep / denominator : 0 };
}

const builders = {
  standings(db, now) {
    const names = new Set([...Object.keys(table(db.standings?.players)), ...Object.keys(table(db.epgp))]);
    const rows = [...names].map((name) => ({ name, ...effectiveStanding(db, name, now) }))
      .sort((a, b) => b.pr - a.pr || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return [["Rank", "Name", "EP", "GP", "PR"], ...rows.map((row, i) => [i + 1, db.displayNames?.[row.name] || row.name, row.ep, row.gp, row.pr.toFixed(2)])];
  },
  loot(db) {
    const titles = new Map(list(db.raids).map((raid) => [raid.id, raid.title]));
    const loot = list(db.loot).slice().reverse();
    return [["Date (UTC)", "Raid", "Item", "Player", "GP", "Boss"],
      ...loot.map((row) => [sheetTime(row.at), row.raid ? titles.get(row.raid) ?? "" : "", itemText(row.item), db.displayNames?.[row.player] || row.player || "", num(row.cost), row.boss ?? ""])];
  },
  attendance(db) {
    const out = [["Raid", "Date (UTC)", "Player", "Status"]];
    for (const raid of list(db.raids).slice().reverse()) {
      const present = table(table(db.attendance)[raid.id]);
      for (const name of Object.keys(present).sort()) out.push([raid.title ?? "Raid", sheetTime(raid.startedAt), db.displayNames?.[name] || name, present[name]?.status ?? ""]);
    }
    return out;
  },
  raids(db) {
    const loot = list(db.loot);
    return [["Raid", "Started (UTC)", "Ended (UTC)", "Attended", "Bosses", "Loot"],
      ...list(db.raids).slice().reverse().map((raid) => [
        raid.title ?? "Raid", sheetTime(raid.startedAt), sheetTime(raid.endedAt),
        Object.values(table(table(db.attendance)[raid.id])).filter((row) => row?.status !== "ABSENT").length,
        list(table(db.bosses)[raid.id]).length,
        loot.filter((row) => row.raid === raid.id).length
      ])];
  },
  // The season board the companion last brought into the game (players' own profiles when the
  // bot sent them, otherwise its top rows). Past seasons are left out, like in game.
  dungeons(db) {
    const board = db.dungeonBoard;
    const rows = [];
    if (board && board.status === "ACTIVE") {
      const seen = new Set();
      const add = (entry, dungeons) => {
        const name = normalizeName(entry.name);
        const key = `${name}|${entry.bracket ?? ""}`;
        if (!name || seen.has(key) || !Number.isFinite(Number(entry.points))) return;
        seen.add(key);
        rows.push({ name, score: Number(entry.points), dungeons, bracket: entry.bracket ?? "" });
      };
      for (const profile of list(board.profiles)) add(profile, list(profile.details).length);
      if (!board.detailsAvailable) for (const row of list(board.rows)) add(row, "");
    }
    rows.sort((a, b) => b.score - a.score || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return [["Rank", "Name", "Score", "Dungeons", "Bracket"], ...rows.map((row, i) => [i + 1, db.displayNames?.[row.name] || row.name, row.score, row.dungeons, row.bracket])];
  }
};

/** Every table as rows (header first) from the GuildedDB table. */
export function sheetTables(db, now = Date.now() / 1000) {
  const source = db && typeof db === "object" ? db : {};
  return Object.fromEntries(SHEET_TABLES.map((name) => [name, builders[name](source, now)]));
}

/**
 * The CSV files for a Guilded.lua SavedVariables text: [{ name, table, rows, text }], `rows`
 * not counting the header. `date` names the files (guilded-standings-2026-10-18.csv).
 */
export function sheetFiles(savedVariablesText, options = {}) {
  const db = readDatabase(savedVariablesText);
  const now = options.now ?? Date.now() / 1000;
  const date = new Date(now * 1000).toISOString().slice(0, 10);
  const tables = sheetTables(db, now);
  return SHEET_TABLES.map((name) => ({ name: `guilded-${name}-${date}.csv`, table: name, rows: tables[name].length - 1, text: toCsv(tables[name]) }));
}
