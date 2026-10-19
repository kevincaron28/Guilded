import { readFile, writeFile, rename, rm, mkdir } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { acceptedToLua, personalPayload, personalResultMessage } from "./personal-runs-content.mjs";
import { credentialHeaders, jsonBody, requestJson } from "./request.mjs";
export { acceptedToLua, personalPayload, personalResultMessage, readPersonalRuns } from "./personal-runs-content.mjs";

// Personal mode (7.0): a companion paired with a code from guilded.kcaron.top/me/ (no guild).
// It reads GuildedDungeons.lua (or Guilded.lua) and sends the player's finished dungeon runs to
// the public leaderboards; the bot answers with the runs it holds, written to
// AddOns/GuildedDungeons/Accepted.lua so the addon marks them as sent.

export function resolveAcceptedPath(config) {
  if (config.acceptedFile) return config.acceptedFile;
  const parts = String(config.watchFile ?? "").split(/[\\/]/);
  const wtf = parts.findIndex((part) => part.toLowerCase() === "wtf");
  if (wtf < 1) return null;
  return join(parts.slice(0, wtf).join(sep) || sep, "Interface", "AddOns", "GuildedDungeons", "Accepted.lua");
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
  const { character, runs: finished } = personalPayload(await readFile(config.watchFile, "utf8"), config.realm);
  if (!character) {
    const error = new Error("The saved file has no character yet. Log in once with Guilded Dungeons, then /reload or log out.");
    error.retryable = false;
    throw error;
  }
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
  if (Array.isArray(body.acceptedRunRefs)) await writeAccepted(config, body.acceptedRunRefs);
  return { ...personalResultMessage(body), sent: finished.length };
}
