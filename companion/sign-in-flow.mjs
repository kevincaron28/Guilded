// Sign in with Discord, as the window shows it (8.5 fresh-PC test). Pure helpers, bundled into the
// window by companion-app/renderer/ui-entry.js. Every text is an English key the window translates.
// - the waiting box counts down to the moment the bot forgets the request;
// - every finished sign-in says something (a greyed button that comes back silently looked broken);
// - a short bot outage (a restart during a deploy) reads as one, with the seconds until the retry.

export const SIGN_IN_DONE = "Discord account connected.";
export const SIGN_IN_UNFINISHED = "The sign-in did not finish. Press Sign in with Discord to try again.";
export const SERVER_RESTARTING = "The Guilded server is restarting or unreachable; retrying in {0} s.";

/** Whole seconds until `expiresAt` (never below 0), or null when it is unknown. */
export function secondsLeft(expiresAt, now = Date.now()) {
  const at = typeof expiresAt === "string" ? Date.parse(expiresAt) : NaN;
  if (!Number.isFinite(at)) return null;
  return Math.max(0, Math.ceil((at - now) / 1000));
}

/** "14:05" for 845 seconds. */
export function formatSeconds(seconds) {
  const whole = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** The waiting box's time line: [key, ...values], or null when nothing should show. */
export function timeLeftLine(expiresAt, now = Date.now()) {
  const left = secondsLeft(expiresAt, now);
  if (left === null) return null;
  if (left === 0) return ["Time is up. The companion is opening a new sign-in page."];
  return ["Time left: {0}. If it runs out, the companion opens a new page by itself.", formatSeconds(left)];
}

/** What to say when a sign-in ends, whatever the answer was: { ok, message } with a message always set. */
export function signInOutcome(result) {
  if (!result || typeof result !== "object") return { ok: false, message: SIGN_IN_UNFINISHED };
  const message = typeof result.message === "string" && result.message.trim() ? result.message : null;
  if (result.ok === true) return { ok: true, message: message ?? SIGN_IN_DONE };
  return { ok: false, message: message ?? SIGN_IN_UNFINISHED };
}

const UNREACHABLE = /Could not reach the bot|took too long to answer|temporarily unavailable|fetch failed|ECONNREFUSED|ETIMEDOUT|\((?:502|503|504|52\d|530)\)/i;
/** True for an error that means the bot is down or restarting, not a refusal. */
export function isUnreachable(error) {
  return typeof error === "string" && UNREACHABLE.test(error);
}

// Retries after an outage: 15 s, 30 s, then every 60 s.
export function retryDelaySeconds(attempt) {
  return attempt <= 0 ? 15 : attempt === 1 ? 30 : 60;
}
