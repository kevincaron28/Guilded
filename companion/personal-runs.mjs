import { writeFile, rename, rm, mkdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
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
  if (config.writeStandingsEnabled === false) return null;
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

export async function uploadPersonalRuns(config, signal, onEvidence = () => {}) {
  const [chosen, ...others] = personalSavedFiles(config.watchFile);
  const stamp = async path => { try { const info = await stat(path); return { at: info.mtimeMs, size: info.size }; } catch (error) { if (error.code === "ENOENT") return null; throw error; } };
  const before = await Promise.all([chosen, ...others].map(stamp));
  const texts = [await readSavedText(chosen), ...await Promise.all(others.map(async path => {
    try { return await readSavedText(path); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  }))];
  const { character, runs: finished } = personalPayloadFrom(texts, config.realm);
  const revision = createHash("sha256").update(JSON.stringify(texts)).digest("hex");
  // A read time is not a save time. File timestamps remain unknown if unavailable.
  const after = await Promise.all([chosen, ...others].map(stamp));
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("Saved data changed during reading. Retry the latest save.");
  const savedTimes = after.map(value => value?.at ?? null);
  const savedAt = savedTimes.some(value => value !== null) ? new Date(Math.max(...savedTimes.filter(value => value !== null))).toISOString() : null;
  const evidence = { savedAt, savedRevision: revision,
    character: character?.name ? `${character.name} — ${character.realm || "?"}` : null, edition: character?.gameEdition };
  onEvidence({ ...evidence });
  if (!character) {
    const error = new Error("The saved files have no character yet. Log in once with Guilded Dungeons (or Guilded), then /reload or log out.");
    error.retryable = false;
    throw error;
  }
  // An empty upload refreshes corrections, new confirmations and season changes
  // even when every local run is already marked synced.
  const payload = jsonBody({ character, runs: finished, includeScore: true });
  const uploadedAt = new Date().toISOString();
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
  Object.assign(evidence, { uploadedAt, uploadedRevision: revision });
  if (Array.isArray(body.acceptedRunRefs) && finished.every(run => body.acceptedRunRefs.includes(run.id))) {
    Object.assign(evidence, { acceptedAt: new Date().toISOString(), acceptedRevision: revision });
  }
  onEvidence({ ...evidence });
  const saved = Array.isArray(body.acceptedRunRefs) ? await writeAccepted(config, body) : null;
  const result = personalResultMessage(body);
  if (config.writeStandingsEnabled === false) return { ...result, message: `${result.message} Select this connection to write scores to the shared addon folder.`, sent: finished.length };
  if (body.publicScore && !saved) return { level: "warn", message: `${result.message} Public scores could not be saved to GuildedDungeons/Accepted.lua. Check the addon folder and try again.`, sent: finished.length };
  return { ...result, sent: finished.length, ...(body.publicScore && saved ? { scoreSaved: true } : {}) };
}
