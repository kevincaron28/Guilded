import { readFile, writeFile, rename, rm, mkdir } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { exportDungeonRuns, parseAddonExportText, readDatabase } from "./lua-export-content.mjs";
import { credentialHeaders, jsonBody, requestJson } from "./request.mjs";

// Personal mode (7.0): a companion paired with a code from guilded.kcaron.top/me/ (no guild).
// It reads GuildedDungeons.lua (or Guilded.lua) and sends the player's finished dungeon runs to
// the public leaderboards; the bot answers with the runs it holds, written to
// AddOns/GuildedDungeons/Accepted.lua so the addon marks them as sent.

const MAX_RUNS = 50;

// { character: { name, realm, class, level }, runs } from either addon's SavedVariables.
export function readPersonalRuns(text, fallbackRealm = "") {
  const clean = text.replace(/^\uFEFF/, "");
  if (/(^|\n)\s*GuildedDungeonsDB\s*=/.test(clean)) {
    const database = readDatabase(clean, "GuildedDungeonsDB");
    const character = database.character && typeof database.character.name === "string" ? database.character : null;
    const realm = String(character?.realm || fallbackRealm || "-");
    return {
      character: character ? { name: character.name, realm, ...(character.class ? { class: String(character.class) } : {}), ...(Number.isInteger(character.level) ? { level: character.level } : {}) } : null,
      runs: exportDungeonRuns(database, realm, { skipSynced: true })
    };
  }
  // A Guilded player using a personal account: the same runs, from Guilded's own file.
  const exported = parseAddonExportText(clean, fallbackRealm);
  const realm = exported.character?.realm || fallbackRealm || "-";
  const database = readDatabase(clean, "GuildedDB");
  return {
    character: exported.character ? { name: exported.character.name, realm, ...(exported.character.class ? { class: exported.character.class } : {}), ...(exported.character.level ? { level: exported.character.level } : {}) } : null,
    runs: exportDungeonRuns(database, realm, { skipSynced: true })
  };
}

export function resolveAcceptedPath(config) {
  if (config.acceptedFile) return config.acceptedFile;
  const parts = String(config.watchFile ?? "").split(/[\\/]/);
  const wtf = parts.findIndex((part) => part.toLowerCase() === "wtf");
  if (wtf < 1) return null;
  return join(parts.slice(0, wtf).join(sep) || sep, "Interface", "AddOns", "GuildedDungeons", "Accepted.lua");
}

const luaString = (value) => `"${String(value).replace(/[\\"]/g, "\\$&").replace(/[\r\n]/g, " ")}"`;
// Adds to the list instead of replacing it, so Guilded's own accepted runs survive when both
// addons are installed (they share the GuildedDungeonAccepted name).
export function acceptedToLua(refs) {
  return `-- Written by the Guilded companion: runs the public leaderboards hold.\nGuildedDungeonAccepted = GuildedDungeonAccepted or {}\nfor _, id in ipairs({ ${refs.slice(0, 500).map(luaString).join(", ")} }) do table.insert(GuildedDungeonAccepted, id) end\n`;
}

async function writeAccepted(config, refs) {
  const path = resolveAcceptedPath(config);
  if (!path) return null;
  try {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    try { await writeFile(temporary, acceptedToLua(refs), "utf8"); await rename(temporary, path); }
    finally { await rm(temporary, { force: true }); }
    return path;
  } catch { return null; }
}

export async function uploadPersonalRuns(config, signal) {
  const { character, runs } = readPersonalRuns(await readFile(config.watchFile, "utf8"), config.realm);
  if (!character) {
    const error = new Error("The saved file has no character yet. Log in once with Guilded Dungeons, then /reload or log out.");
    error.retryable = false;
    throw error;
  }
  const finished = runs.filter((run) => run.state === "COMPLETED").sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0)).slice(0, MAX_RUNS);
  if (!finished.length) return { level: "info", message: "No finished dungeon run to send yet.", sent: 0 };
  const payload = jsonBody({ character, runs: finished });
  const { response, body } = await requestJson(new URL("/api/v1/public-runs", config.uploadUrl), {
    method: "POST", headers: { ...credentialHeaders(config), ...payload.headers }, body: payload.body
  }, signal);
  if (!response.ok) {
    const error = new Error(response.status === 401
      ? "The website refused this companion. Get a new code on guilded.kcaron.top/me/ and connect again."
      : `Sending runs failed (${response.status}): ${body.error ?? "unknown error"}`);
    error.retryable = response.status === 429 || response.status >= 500;
    throw error;
  }
  const accepted = body.accepted?.length ?? 0;
  const confirmed = body.confirmed?.length ?? 0;
  const duplicates = body.duplicates?.length ?? 0;
  const rejected = body.rejected ?? [];
  if (Array.isArray(body.acceptedRunRefs)) await writeAccepted(config, body.acceptedRunRefs);
  const parts = [`${accepted} new`, `${confirmed} confirmed`, `${duplicates} already sent`];
  if (rejected.length) parts.push(`${rejected.length} refused (${rejected[0].reason})`);
  return { level: rejected.length ? "warn" : "ok", message: `Public leaderboards: ${parts.join(", ")}.`, sent: finished.length };
}
