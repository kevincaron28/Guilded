import { createHash } from "node:crypto";
import { parsePoeRecord, consumePoeRecord } from "./poe-events.mjs";
export { isPoeMap } from "./poe-events.mjs";
export function parsePoeLogLine(line) { return parsePoeRecord(line, createHash("sha256").update(line).digest("hex")); }
export function consumePoeEvent(journal, event, profile) {
  const runRef = event?.kind === "area" ? createHash("sha256").update(JSON.stringify([profile.character, profile.league, profile.mode, event.fingerprint])).digest("hex") : null;
  consumePoeRecord(journal, event, profile, runRef);
}
