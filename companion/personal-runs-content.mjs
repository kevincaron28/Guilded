import { exportDungeonRuns, parseAddonExportText, readDatabase } from "./lua-export-content.mjs";

// The browser-safe half of personal mode (no file system): shared by personal-runs.mjs (desktop
// and command line) and browser-client.mjs (the website companion).

export const MAX_PERSONAL_RUNS = 50;

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

const luaString = (value) => `"${String(value).replace(/[\\"]/g, "\\$&").replace(/[\r\n]/g, " ")}"`;
// Adds to the list instead of replacing it, so Guilded's own accepted runs survive when both
// addons are installed (they share the GuildedDungeonAccepted name).
export function acceptedToLua(refs) {
  return `-- Written by the Guilded companion: runs the public leaderboards hold.\nGuildedDungeonAccepted = GuildedDungeonAccepted or {}\nfor _, id in ipairs({ ${refs.slice(0, 500).map(luaString).join(", ")} }) do table.insert(GuildedDungeonAccepted, id) end\n`;
}

// The finished runs to send, newest first.
export function personalPayload(text, fallbackRealm = "") {
  const { character, runs } = readPersonalRuns(text, fallbackRealm);
  return { character, runs: runs.filter((run) => run.state === "COMPLETED").sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0)).slice(0, MAX_PERSONAL_RUNS) };
}

// What the bot's answer means, in one line.
export function personalResultMessage(body) {
  const rejected = body.rejected ?? [];
  const parts = [`${body.accepted?.length ?? 0} new`, `${body.confirmed?.length ?? 0} confirmed`, `${body.duplicates?.length ?? 0} already sent`];
  if (rejected.length) parts.push(`${rejected.length} refused (${rejected[0].reason})`);
  return { level: rejected.length ? "warn" : "ok", message: `Public leaderboards: ${parts.join(", ")}.` };
}
