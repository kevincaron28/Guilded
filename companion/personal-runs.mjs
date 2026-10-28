import { writeFile, rename, rm, mkdir } from "node:fs/promises";
import { readSavedText } from "./saved-file.mjs";
import { basename, dirname, join, sep } from "node:path";
import { personalResponseToLua, PERSONAL_SAVED_FILES, personalPayloadFrom, personalResultMessage } from "./personal-runs-content.mjs";
import { credentialHeaders, jsonBody, requestJson } from "./request.mjs";
export { acceptedToLua, personalPayload, personalPayloadFrom, personalResultMessage, readPersonalRuns } from "./personal-runs-content.mjs";

// Personal mode (7.0): a companion linked to a website account ("Public dungeon leaderboards
// only" in Sign in with Discord, or a code from guilded.kcaron.top/me/), no guild. It reads
// GuildedDungeons.lua and Guilded.lua from the same SavedVariables folder (whichever addon the
// player uses, or both) and sends the player's finished dungeon runs to the public leaderboards;
// the bot answers with the runs it holds, written to AddOns/GuildedDungeons/Accepted.lua so the
// addon marks them as sent.

// The chosen saved file and its neighbour from the other addon, when that one exists too.
export function personalSavedFiles(watchFile) {
  const chosen = basename(String(watchFile ?? ""));
  const other = PERSONAL_SAVED_FILES.find((name) => name.toLowerCase() !== chosen.toLowerCase());
  return PERSONAL_SAVED_FILES.some((name) => name.toLowerCase() === chosen.toLowerCase()) && other
    ? [watchFile, join(dirname(watchFile), other)]
    : [watchFile];
}

export function resolveAcceptedPath(config) {
  if (config.acceptedFile) return config.acceptedFile;
  const parts = String(config.watchFile ?? "").split(/[\\/]/);
  const wtf = parts.findIndex((part) => part.toLowerCase() === "wtf");
  if (wtf < 1) return null;
  return join(parts.slice(0, wtf).join(sep) || sep, "Interface", "AddOns", "GuildedDungeons", "Accepted.lua");
}

async function writeAccepted(config, body) {
  const path = resolveAcceptedPath(config);
  if (!path) return null;
  try {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    try { await writeFile(temporary, personalResponseToLua(body), "utf8"); await rename(temporary, path); }
    finally { await rm(temporary, { force: true }); }
    return path;
  } catch { return null; }
}

export async function uploadPersonalRuns(config, signal) {
  const [chosen, ...others] = personalSavedFiles(config.watchFile);
  const texts = [await readSavedText(chosen), ...await Promise.all(others.map(async path => {
    try { return await readSavedText(path); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  }))];
  const { character, runs: finished } = personalPayloadFrom(texts, config.realm);
  if (!character) {
    const error = new Error("The saved files have no character yet. Log in once with Guilded Dungeons (or Guilded), then /reload or log out.");
    error.retryable = false;
    throw error;
  }
  // An empty upload refreshes corrections, new confirmations and season changes
  // even when every local run is already marked synced.
  const payload = jsonBody({ character, runs: finished, includeScore: true });
  const { response, body } = await requestJson(new URL("/api/v1/public-runs", config.uploadUrl), {
    method: "POST", headers: { ...credentialHeaders(config), ...payload.headers }, body: payload.body
  }, signal);
  if (!response.ok) {
    const error = new Error(response.status === 401
      ? "The website refused this companion. Choose Sign in with Discord again in Connection & setup."
      : `Sending runs failed (${response.status}): ${body.error ?? "unknown error"}`);
    error.retryable = response.status === 429 || response.status >= 500;
    throw error;
  }
  const saved = Array.isArray(body.acceptedRunRefs) ? await writeAccepted(config, body) : null;
  const result = personalResultMessage(body);
  if (body.publicScore && !saved) return { level: "warn", message: `${result.message} Public scores could not be saved to GuildedDungeons/Accepted.lua. Check the addon folder and try again.`, sent: finished.length };
  return { ...result, sent: finished.length, ...(body.publicScore && saved ? { scoreSaved: true } : {}) };
}
