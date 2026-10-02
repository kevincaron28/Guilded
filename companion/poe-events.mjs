// Shared by desktop and browser. Callers provide SHA-256 fingerprints.
/** @typedef {{ runRef: string, instanceRef?: string, character: string, league: string, mode: string, areaId: string, areaLevel: number, startedAt: string, endedAt: string, endReason: string }} PoeVisit */
export function parsePoeRecord(line, fingerprint) {
  const match = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2}) \d+ [a-f0-9]+ \[(DEBUG|INFO) Client (\d+)\] (.+)$/.exec(line);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, level, pid, message] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  if (date.getFullYear() !== Number(year) || date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day)
    || date.getHours() !== Number(hour) || date.getMinutes() !== Number(minute) || date.getSeconds() !== Number(second)) return null;
  const at = date.toISOString();
  const area = /^Generating level (\d{1,3}) area "([A-Za-z0-9_]{1,100})" with seed (\d+)$/.exec(message);
  if (level === "DEBUG" && area && Number(area[1]) >= 1 && Number(area[1]) <= 100) {
    // The seed stays in memory: callers hash it into instanceRef and never store it.
    return { kind: "area", at, pid, areaId: area[2], areaLevel: Number(area[1]), seed: area[3], fingerprint };
  }
  if (level === "INFO" && /^(?:Abnormal disconnect(?:\b)|Async connecting to .*\.login\.pathofexile2\.com:)/.test(message)) return { kind: "interrupted", at, pid };
  return null;
}
// The same area + seed is the same map instance, so portal re-entries (and
// party members in one map) share it. Callers SHA-256 this text.
export function poeInstanceKey(event) { return JSON.stringify(["poe2-instance", event.areaId, event.areaLevel, event.seed]); }
export function isPoeMap(areaId) { return /^Map(?!Worlds)[A-Za-z0-9_]{1,96}$/.test(areaId); }
export function consumePoeRecord(journal, event, profile, runRef, instanceRef = null) {
  if (!event) return;
  const active = journal.active;
  if (active && Date.parse(event.at) < Date.parse(active.startedAt)) return;
  if (active && event.fingerprint === active.fingerprint) return;
  if (active) {
    const interrupted = event.kind === "interrupted" || event.pid !== active.pid;
    const visit = { character: active.character, league: active.league, mode: active.mode, runRef: active.runRef, ...(active.instanceRef ? { instanceRef: active.instanceRef } : {}), areaId: active.areaId, areaLevel: active.areaLevel, startedAt: active.startedAt };
    journal.pending.push({ ...visit, endedAt: event.at, endReason: interrupted ? "INTERRUPTED" : "AREA_CHANGED" });
    journal.active = null;
  }
  if (event.kind === "area" && isPoeMap(event.areaId)) {
    journal.active = { ...profile, runRef, ...(instanceRef ? { instanceRef } : {}), areaId: event.areaId, areaLevel: event.areaLevel, startedAt: event.at, pid: event.pid, fingerprint: event.fingerprint };
  }
}
