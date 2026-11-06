"use strict";
// Effortless linking (8.5 Track L), the parts the desktop process decides. Pure functions, tested in
// tests/companion-link-identity.test.ts.

// The in-game guild the addon saved: GuildedDB.guildKey is "<guild name>-<home realm>" (Core.lua
// currentGuildKey). WoW guild names hold no hyphen, so the first one splits name and realm.
function guildFromSavedText(text) {
  const match = /\["guildKey"\]\s*=\s*"((?:[^"\\]|\\.){3,200})"/.exec(String(text ?? ""));
  if (!match) return null;
  const value = match[1].replace(/\\(.)/g, "$1");
  const cut = value.indexOf("-");
  if (cut < 1 || cut >= value.length - 1) return null;
  return { name: value.slice(0, cut).trim(), realm: value.slice(cut + 1).trim() };
}

// A problem on Guilded's side (the bot restarting during a deploy, a 5xx, a rate limit) is not the
// member's to fix: amber "waiting", never the red "needs attention". Uploads that went through while
// only the rankings could not be fetched read as a partial success.
const SERVER_SIDE = /Could not reach the bot|took too long to answer|temporarily unavailable|fetch failed|ECONNREFUSED|ETIMEDOUT|Too many|\((?:429|5\d\d)\)|failed \((?:429|5\d\d)\)/i;
function isServerSide(text) {
  return typeof text === "string" && SERVER_SIDE.test(text);
}
const SERVER_WAIT = "Guilded's server is restarting or busy. Your data is safe and is sent automatically.";
const RANKINGS_DELAYED = "Upload OK · rankings delayed. They refresh by themselves.";

/** The status level and text for the window, tray and banner. */
function companionHealth({ setupProblems = 0, state = {} } = {}) {
  if (setupProblems > 0) return { level: "setup", text: "Setup needed" };
  if (!state.running) return { level: "error", text: "Not running" };
  const upload = state.uploadError, standings = state.standingsError;
  if (upload || standings) {
    const member = [upload, standings].filter((text) => text && !isServerSide(text));
    if (member.length) return { level: "error", text: member[0] };
    if (!upload && standings) return { level: "ok", partial: true, text: RANKINGS_DELAYED };
    return { level: "setup", serverSide: true, text: SERVER_WAIT };
  }
  if (state.poe?.error) return { level: isServerSide(state.poe.error) ? "setup" : "error", text: state.poe.error };
  if (state.poe?.pending) return { level: "setup", text: `PoE2: ${state.poe.pending} visit(s) waiting to sync` };
  if (state.pendingUpload) return { level: "setup", text: state.retryAt ? `Upload pending; retry at ${state.retryAt}` : "Uploading saved data..." };
  return { level: "ok", text: "Running: watching for changes" };
}

// The red "!" on the tray and taskbar is for problems the member can fix. Guilded's own outages
// stay in the Problems list, without turning the badge red.
const SERVER_PROBLEMS = new Set(["bot-unreachable"]);
function memberProblems(problems = []) {
  return problems.filter((problem) => !SERVER_PROBLEMS.has(problem?.id));
}

module.exports = { guildFromSavedText, isServerSide, companionHealth, memberProblems, SERVER_WAIT, RANKINGS_DELAYED };
