import { requestJson } from "./request.mjs";

// Zero-setup companion (docs/ZERO_SETUP_COMPANION.md). Without a Discord sign-in, the companion
// syncs with a device key it gets on first start (kept in its encrypted settings). It sends only
// the characters on this PC and the in-game guild the addon saved; the bot finds the Discord server
// from that guild and keeps the characters as "reported". Signing in with Discord later claims the
// device; from then on the normal (signed-in) upload runs and confirms everything.

export const DEVICE_HEADER = "x-companion-device";
export const deviceHeaders = (config) => ({ [DEVICE_HEADER]: config.deviceSecret ?? "" });
export const hasDeviceKey = (config) => typeof config?.deviceSecret === "string" && config.deviceSecret.length >= 32;

/** GuildedDB.guildKey is "<guild name>-<home realm>"; WoW guild names hold no hyphen. */
export function splitGuildKey(value) {
  if (typeof value !== "string") return null;
  const cut = value.indexOf("-");
  if (cut < 1 || cut >= value.length - 1) return null;
  const name = value.slice(0, cut).trim(), realm = value.slice(cut + 1).trim();
  return name && realm ? { name: name.slice(0, 80), realm: realm.slice(0, 80) } : null;
}

const MAX_CHARACTERS = 12;
const MAX_RUNS = 50;
const label = (value, max) => typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;

/** What an unsigned upload sends: the guild and this PC's characters, nothing else from the saved data. */
export function deviceUploadBody(full, options = {}) {
  const seen = new Set();
  const characters = [];
  for (const entry of [full?.character, ...(Array.isArray(full?.alts) ? full.alts : [])]) {
    const name = label(entry?.name, 40);
    if (!name || name.includes("|") || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const level = Number(entry.level);
    characters.push({
      name,
      realm: label(entry.realm, 100) ?? "",
      ...(label(entry.displayName, 80) ? { displayName: label(entry.displayName, 80) } : {}),
      ...(label(entry.class, 30) ? { class: label(entry.class, 30) } : {}),
      ...(label(entry.race, 30) ? { race: label(entry.race, 30) } : {}),
      ...(Number.isInteger(level) && level >= 1 && level <= 100 ? { level } : {})
    });
    if (characters.length >= MAX_CHARACTERS) break;
  }
  // Finished dungeon runs, newest first and capped: the bot checks and scores them like any run.
  const dungeonRuns = (Array.isArray(full?.dungeonRuns) ? full.dungeonRuns : []).filter(run => run && run.state === "COMPLETED")
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0)).slice(0, MAX_RUNS);
  return { guild: splitGuildKey(full?.wowGuild), characters, ...(dungeonRuns.length ? { dungeonRuns } : {}), ...(options.server ? { server: String(options.server) } : {}) };
}

const base = (config) => config.uploadUrl;

/** A new device key from the bot (once per install). */
export async function registerDevice(config, signal) {
  const { response, body } = await requestJson(new URL("/api/v1/device/register", base(config)), { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }, signal, 15_000);
  if (response.status === 404) return { ok: false, unsupported: true, message: "This Guilded server does not support syncing without sign-in yet. Sign in with Discord instead." };
  if (!response.ok || typeof body.deviceSecret !== "string" || body.deviceSecret.length < 32) return { ok: false, message: body.error || `The bot answered ${response.status}.` };
  return { ok: true, deviceSecret: body.deviceSecret };
}

/** One unsigned upload. The answer says where the data went (or why it waits). */
export async function uploadAsDevice(config, full, signal) {
  const { response, body } = await requestJson(new URL("/api/v1/device/uploads", base(config)), {
    method: "POST",
    headers: { ...deviceHeaders(config), "content-type": "application/json" },
    body: JSON.stringify(deviceUploadBody(full, { server: config.deviceServer }))
  }, signal);
  return { response, body };
}

/** After a Discord sign-in in this companion: the device becomes the member's. Never fails the sign-in. */
export async function claimDevice(config, credential, signal) {
  if (!hasDeviceKey(config) || typeof credential !== "string") return { ok: false };
  try {
    const { response } = await requestJson(new URL("/api/v1/device/claim", base(config)), {
      method: "POST",
      headers: { ...deviceHeaders(config), "x-companion-credential": credential, "content-type": "application/json" },
      body: "{}"
    }, signal, 15_000);
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false };
  }
}

/** The status line for the window: "Syncing to <server> (from your guild <guild>)" and friends. */
export function deviceSummary(answer) {
  if (!answer || typeof answer !== "object") return null;
  const guild = answer.guild && typeof answer.guild.name === "string" ? { name: answer.guild.name.slice(0, 80), realm: String(answer.guild.realm ?? "").slice(0, 80) } : null;
  if (answer.status === "synced" && answer.server) return { status: "synced", server: String(answer.server.name ?? answer.server.discordId ?? "").slice(0, 100), serverId: String(answer.server.discordId ?? ""), guild, characters: Number(answer.characters) || 0 };
  if (answer.status === "choose" && Array.isArray(answer.servers)) return { status: "choose", guild, servers: answer.servers.slice(0, 10).map((server) => ({ discordId: String(server.discordId ?? ""), name: String(server.name ?? server.discordId ?? "").slice(0, 100) })) };
  if (answer.status === "no-guild") return { status: "no-guild", guild };
  if (answer.status === "claimed") return { status: "claimed", guild };
  return null;
}

/** The log/status message for an unsigned upload's answer (English; the app translates it). */
export function deviceMessage(summary) {
  if (!summary) return "The bot's answer was not understood.";
  if (summary.status === "synced") return summary.guild
    ? `Syncing to ${summary.server} (from your guild ${summary.guild.name}). Your characters show as reported until you sign in with Discord.`
    : `Syncing to ${summary.server}.`;
  if (summary.status === "choose") return `Several Discord servers set up your guild ${summary.guild?.name ?? ""}. Choose yours on the Sync page, under Advanced: choose server.`;
  if (summary.status === "claimed") return "This companion was confirmed with Discord: choose Sign in with Discord once more to finish.";
  return summary.guild
    ? `Your guild ${summary.guild.name}${summary.guild.realm ? ` (realm ${summary.guild.realm})` : ""} isn't set up on Discord yet. Your data waits here; ask an officer to run /setup on your guild's Discord.`
    : "Waiting for your character's guild: log in to WoW with the Guilded addon enabled.";
}
