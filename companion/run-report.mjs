// What happened to the dungeon runs one upload carried (9.3.0): "Dungeon runs: 3 sent, 2 stored, 1 copied from a guildmate."
// An "Uploaded" line proved nothing about runs; this one says how many went, how many the bot holds and why a run earns nothing.
// The wording is parsed again by companion-app/i18n.cjs for the French window: keep the grammar in step with it.

/** The note the bot gives a run it counted through a guildmate's copy (src/services/companion-device.ts COPY_REASON). */
export const COPY_PREFIX = "Counted with a guildmate";

const idsOf = (runs) => (Array.isArray(runs) ? runs : []).flatMap((run) => (typeof run === "string" ? [run] : typeof run?.id === "string" ? [run.id] : []));

function classify(ids, accepted, notes, pending = {}) {
  const held = new Set(Array.isArray(accepted) ? accepted : []);
  const counts = { sent: ids.length, stored: 0, copies: 0, waiting: 0, unconfirmed: 0, notCounted: /** @type {Record<string, number>} */ ({}) };
  for (const id of ids) {
    if (held.has(id)) {
      const note = notes && typeof notes[id] === "string" ? notes[id] : "";
      if (!note) counts.stored++;
      else if (note.startsWith(COPY_PREFIX)) counts.copies++;
      else counts.notCounted[note] = (counts.notCounted[note] ?? 0) + 1;
    } else if (pending && typeof pending[id] === "string") counts.waiting++;
    else counts.unconfirmed++;
  }
  return counts;
}

/** Zero-setup (device) upload: the bot's answer lists the runs it holds (runReceipts) and those waiting for a second statement. */
export function deviceRunCounts(sentRuns, body) {
  const receipts = body?.runReceipts ?? {};
  return classify(idsOf(sentRuns), receipts.acceptedRunRefs, receipts.runNotes, receipts.pendingRunNotes);
}

/** Signed-in upload: the runs went with the guild upload; the bot's standings answer (acceptedRunRefs, runNotes, and pendingRunNotes for runs waiting for a second statement) says what it holds. */
export function signedRunCounts(sentRuns, standings) {
  return classify(idsOf(sentRuns), standings?.acceptedRunRefs, standings?.runNotes, standings?.pendingRunNotes);
}

/** Personal (public leaderboards) upload: the website's answer lists new, confirmed, already sent and refused runs. */
export function personalRunCounts(sentRuns, body) {
  const ids = idsOf(sentRuns);
  const counts = { sent: ids.length, stored: 0, copies: 0, waiting: 0, unconfirmed: 0, notCounted: /** @type {Record<string, number>} */ ({}) };
  const list = (value) => (Array.isArray(value) ? value : []);
  const held = new Set([...list(body?.accepted), ...list(body?.confirmed), ...list(body?.duplicates), ...list(body?.historyOnly)]);
  const refused = new Map(list(body?.rejected).map((row) => [row?.id, String(row?.reason ?? "refused")]));
  for (const id of ids) {
    if (held.has(id)) counts.stored++;
    else if (refused.has(id)) counts.notCounted[refused.get(id)] = (counts.notCounted[refused.get(id)] ?? 0) + 1;
    else counts.unconfirmed++;
  }
  return counts;
}

/** { level, message } for the log, or null when there is nothing to say. */
export function dungeonRunReport(counts) {
  if (!counts) return null;
  if (counts.sent === 0) return { level: "info", message: "Dungeon runs: none to send." };
  const parts = [];
  if (counts.stored) parts.push(`${counts.stored} stored`);
  if (counts.copies) parts.push(`${counts.copies} copied from a guildmate`);
  if (counts.waiting) parts.push(`${counts.waiting} waiting for a second player`);
  const refused = Object.entries(counts.notCounted ?? {});
  if (refused.length) parts.push(`${refused.reduce((total, [, count]) => total + count, 0)} not counted (${refused.map(([reason]) => reason).join("; ")})`);
  if (counts.unconfirmed) parts.push(`${counts.unconfirmed} not confirmed yet`);
  const bad = refused.length > 0 || counts.unconfirmed > 0;
  return { level: bad ? "warn" : "ok", message: `Dungeon runs: ${[`${counts.sent} sent`, ...parts].join(", ")}.` };
}

/** The line for the log (same as dungeonRunReport; callers may pass the saved-file source, which does not change the wording). */
export function runReportMessage(counts) {
  return dungeonRunReport(counts);
}
