import { standingsToLua } from "./standings-format.mjs";
export { standingsToLua } from "./standings-format.mjs";
import { readFile, writeFile, rename, rm } from "node:fs/promises";
import { readSavedText } from "./saved-file.mjs";
import { credentialHeaders, requestJson } from "./request.mjs";
import { writeDataAddon } from "./data-addon.mjs";
import { join, sep } from "node:path";
import { readDatabase } from "./lua-export-content.mjs";
import { assertSameEdition } from "./game-edition.mjs";

// SavedVariables live at <game>\WTF\Account\<acct>\SavedVariables\Guilded.lua,
// and the addon at <game>\Interface\AddOns\Guilded. `standingsFile` in
// companion.config.json overrides this if the layout is different.
export function resolveStandingsPath(config) {
  if (config.standingsFile) return config.standingsFile;
  const parts = config.watchFile.split(/[\\/]/);
  const wtf = parts.findIndex((part) => part.toLowerCase() === "wtf");
  if (wtf < 1) return null;
  return join(parts.slice(0, wtf).join(sep) || sep, "Interface", "AddOns", "Guilded", "Standings.lua");
}

// Older bots stamp every answer with the time of the request; compare the rest so an unchanged
// table does not rewrite the file (the game only reads it on reload anyway).
export const withoutStamps = (value) => value.replace(/updatedAt = "[^"]*",/g, "");
// Public vacancies expire after ten minutes in the addon. Keep writing their
// freshness stamp, but do not announce that heartbeat as an EP/GP change.
const withoutRefreshStamps = (value) => withoutStamps(value).replace(/fetchedAt = "[^"]*",/g, "");

// Fetches the standings and writes them for the addon.
// `options.etag`: the ETag of the answer already written. The bot then answers 304 when nothing
// changed. It goes as If-None-Match and as `since`, because the website proxy drops most headers.
// `options.waitSeconds`: the bot may hold the request until something changes (long poll).
export async function writeStandings(config, signal, options = {}) {
  const path = resolveStandingsPath(config);
  if (!path) throw new Error("Could not find the AddOns folder from watchFile; set standingsFile in companion.config.json.");
  const url = new URL("/api/v1/standings", config.uploadUrl);
  url.searchParams.set("guild", config.guildDiscordId);
  const headers = { ...credentialHeaders(config) };
  if (options.etag) {
    headers["if-none-match"] = options.etag;
    url.searchParams.set("since", options.etag);
    if (options.waitSeconds) url.searchParams.set("wait", String(options.waitSeconds));
  }
  const { response, body } = await requestJson(url, { headers }, signal, options.waitSeconds ? (options.waitSeconds + 20) * 1000 : undefined);
  const etag = response.headers?.get?.("etag") ?? null;
  if (response.status === 304) return { notModified: true, etag: etag ?? options.etag ?? null, path };
  if (!response.ok) {
    // A reverse proxy can return an empty or HTML error while the bot restarts.
    const detail = typeof body?.error === "string" && body.error.trim() ? body.error
      : response.status >= 500 ? "The guild bot is temporarily unavailable. Standings will retry automatically."
      : "The server did not provide an error message.";
    throw new Error(`Standings request failed (${response.status}): ${detail}`);
  }
  if (body.protocolVersion !== 2) throw new Error("Update the bot before using this companion (sync protocol 2 required).");
  // Check the actual saved file before replacing standings or acknowledging
  // its ledger. Missing legacy saves retain first-run repair behavior.
  let saved;
  try { saved = await readSavedText(config.watchFile); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (saved) {
    const local = config.watchFile.toLowerCase().endsWith(".lua") ? readDatabase(saved).character ?? {} : JSON.parse(saved);
    assertSameEdition(local, body);
  }
  const text = standingsToLua(body);
  let unchanged = false;
  let refreshOnly = false;
  try {
    const current = await readFile(path, "utf8");
    unchanged = withoutStamps(current) === withoutStamps(text);
    refreshOnly = !unchanged && withoutRefreshStamps(current) === withoutRefreshStamps(text);
  } catch { /* Missing file: restore it and report the repair. */ }
  signal?.throwIfAborted();
  if (!unchanged) {
    const temporary = `${path}.${process.pid}.tmp`;
    try { await writeFile(temporary, text, "utf8"); signal?.throwIfAborted(); await rename(temporary, path); }
    finally { await rm(temporary, { force: true }); }
  }
  // The copy that survives addon updates (data-addon.mjs). Best effort: Guilded's own file above
  // is what older addons and setups rely on.
  let dataPath = null;
  if (config.dataAddon !== false) {
    try { dataPath = await writeDataAddon(path, text, body.updatedAt, signal); } catch { signal?.throwIfAborted(); dataPath = null; }
  }
  return { notModified: false, etag, body, path, dataPath, text, count: body.standings.length, unchanged, refreshOnly, botVersion: body.botVersion };
}

// True when the addon's Standings.lua still holds `text` (an addon update replaces it with the
// empty file it ships, and the bot would keep answering "not modified").
export async function standingsFileHolds(path, text) {
  try { return withoutStamps(await readFile(path, "utf8")) === withoutStamps(text); } catch { return false; }
}
