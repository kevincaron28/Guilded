"use strict";
// startup.log in the data folder (9.3.7). The file is the member's and the officers' record of a run, so every line the
// Activity list shows is appended for the WHOLE run, not only until the window was ready (before 9.3.7 the writer was switched
// off after start-up, so a companion that synced for hours left no trace). The size is kept in check by rotating the file to
// ".1" when it grows past the limit, at any time, not only at the next start.
const fs = require("node:fs");

const MAX_BYTES = 256 * 1024;

/** @param {string} file @param {{ maxBytes?: number, fsImpl?: typeof fs }} [options] */
function createRunLog(file, options = {}) {
  const maxBytes = options.maxBytes ?? MAX_BYTES, fsImpl = options.fsImpl ?? fs;
  let written = -1;
  function append(text) {
    try {
      if (written < 0) { try { written = fsImpl.statSync(file).size; } catch { written = 0; } }
      if (written > maxBytes) {
        try { fsImpl.rmSync(file + ".1", { force: true }); fsImpl.renameSync(file, file + ".1"); } catch { /* keep appending */ }
        written = 0;
      }
      fsImpl.appendFileSync(file, text);
      written += Buffer.byteLength(text);
    } catch { /* diagnostics only */ }
  }
  return {
    line: (time, level, message) => append(`${time} ${level} ${message}\n`),
    raw: (text) => append(text.endsWith("\n") ? text : text + "\n")
  };
}

/** The start-up line's wording for "restarted after an update", true to how this copy was installed. */
function restartedText(restarted, storeInstall) {
  if (!restarted) return "no";
  return storeInstall ? "yes (Microsoft Store update)" : "yes (the companion's own update)";
}

module.exports = { createRunLog, restartedText, MAX_BYTES };
