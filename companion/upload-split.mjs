// Split one guild export into several uploads, so the bot never refuses a whole upload for its size or row-count limits
// (docs/plans/DATA_LOSS_AUDIT_2026-11-19.md, finding 3). The first part carries the roster, ledger and everything small; the big
// lists (dungeon runs, characters, milestones, duels, recipes) follow in parts of their own. A part that is refused never blocks the others.

export const SPLIT_MAX_BYTES = 900_000;

// inline: how many rows may stay in the first part; chunk: how many rows one extra request carries. Older bots accept
// milestones up to 600 and duels up to 200 per request, so beyond that they travel apart from the roster and ledger.
export const SECTIONS = [
  { key: "characters", inline: 400, chunk: 400 },
  { key: "recipes", inline: 400, chunk: 400 },
  { key: "duelResults", inline: 200, chunk: 5000 },
  { key: "milestones", inline: 600, chunk: 5000 },
  { key: "dungeonRuns", inline: 400, chunk: 400 }
];

const ENVELOPE = ["gameEdition", "interface", "source", "exportedAt", "wowGuild", "character", "alts", "addonVersion"];
const size = (value) => JSON.stringify(value).length;

// Greedy chunks of rows: at most `cap` rows and `budget` serialized bytes each (a single row bigger than the budget goes alone).
export function chunkRows(rows, cap, budget) {
  const chunks = [];
  let current = [];
  let used = 0;
  for (const row of rows) {
    const bytes = size(row) + 1;
    if (current.length && (current.length >= cap || used + bytes > budget)) { chunks.push(current); current = []; used = 0; }
    current.push(row);
    used += bytes;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

const part = (label, body, counts) => ({ label, export: body, counts });

/** Parts to send, in order. One part (the export itself) when it is within every limit. */
export function splitExport(exported, options = {}) {
  const maxBytes = options.maxBytes ?? SPLIT_MAX_BYTES;
  const arrays = SECTIONS.filter((section) => Array.isArray(exported?.[section.key]));
  const overCount = arrays.some((section) => exported[section.key].length > section.inline);
  if (!overCount && size(exported) <= maxBytes) return [part("upload", exported, null)];

  const envelope = Object.fromEntries(ENVELOPE.filter((key) => exported[key] !== undefined).map((key) => [key, exported[key]]));
  const envelopeBytes = size(envelope) + 200;
  // The roster and ledger part: everything except the big lists, which are sent apart. A small list stays with it.
  const main = { ...exported };
  const extras = [];
  for (const section of arrays) {
    const rows = exported[section.key];
    if (section.key === "characters") {
      main.characters = rows.slice(0, section.inline);
      if (rows.length > section.inline) extras.push({ key: "characters", rows: rows.slice(section.inline), cap: section.chunk });
    } else if (rows.length > section.inline || size(rows) > 100_000) {
      delete main[section.key];
      if (section.key === "recipes") delete main.recipeNames;
      if (rows.length) extras.push({ key: section.key, rows, cap: section.chunk });
    }
  }
  const parts = [part("roster and ledger", main, { characters: main.characters?.length ?? 0 })];
  for (const extra of extras) {
    const chunks = chunkRows(extra.rows, extra.cap, Math.max(50_000, maxBytes - envelopeBytes - (extra.key === "recipes" ? 100_000 : 0)));
    chunks.forEach((rows, index) => {
      const body = { ...envelope, [extra.key]: rows };
      if (extra.key === "recipes" && exported.recipeNames) {
        const used = new Set(rows.flatMap((set) => Array.isArray(set.keys) ? set.keys.map(String) : []));
        body.recipeNames = Object.fromEntries(Object.entries(exported.recipeNames).filter(([key]) => used.has(String(key))));
      }
      parts.push(part(`${extra.key} ${index + 1}/${chunks.length}`, body, { [extra.key]: rows.length }));
    });
  }
  return parts;
}

/** "400 dungeonRuns, 12 milestones" for a log line. */
export const describeCounts = (counts) => counts ? Object.entries(counts).map(([key, count]) => `${count} ${key}`).join(", ") : "";
