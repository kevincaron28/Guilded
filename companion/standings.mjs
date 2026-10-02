import { standingsToLua } from "./standings-format.mjs";
export { standingsToLua } from "./standings-format.mjs";
import { readFile, writeFile, rename, rm } from "node:fs/promises";
import { credentialHeaders, requestJson } from "./request.mjs";
import { join, sep } from "node:path";

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

export async function writeStandings(config, signal) {
  const path = resolveStandingsPath(config);
  if (!path) throw new Error("Could not find the AddOns folder from watchFile; set standingsFile in companion.config.json.");
  const url = new URL("/api/v1/standings", config.uploadUrl);
  url.searchParams.set("guild", config.guildDiscordId);
  const { response, body } = await requestJson(url, { headers: credentialHeaders(config) }, signal);
  if (!response.ok) throw new Error(`Standings request failed (${response.status}): ${body.error}`);
  if (body.protocolVersion !== 2) throw new Error("Update the bot before using this companion (sync protocol 2 required).");
  const text = standingsToLua(body);
  // The timestamp changes every call; compare the rest so an unchanged table
  // does not rewrite the file (the game only reads it on reload anyway).
  const body2 = (value) => value.replace(/updatedAt = "[^"]*",/g, "");
  let unchanged = false;
  try { unchanged = body2(await readFile(path, "utf8")) === body2(text); } catch { unchanged = false; }
  signal?.throwIfAborted();
  if (!unchanged) {
    const temporary = `${path}.${process.pid}.tmp`;
    try { await writeFile(temporary, text, "utf8"); signal?.throwIfAborted(); await rename(temporary, path); }
    finally { await rm(temporary, { force: true }); }
  }
  return { path, count: body.standings.length, unchanged, botVersion: body.botVersion };
}
