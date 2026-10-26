// Native file dialogs are the only source/destination authority. No uploads,
// account connection, watcher changes or writes to the source SavedVariables.
function createGRMConverter({ dialog, fs, convertGRM, getWindow, T }) {
  return async function convert(options = {}) {
    try {
      const { guild, realm, edition, includePrivate } = options;
      if (typeof guild !== "string" || !guild.trim() || typeof realm !== "string" || !realm.trim()) return { ok: false, message: T("Enter the source guild and realm first.") };
      const picked = await dialog.showOpenDialog(getWindow(), { title: T("Choose your GRM SavedVariables backup"), properties: ["openFile"], filters: [{ name: "GRM", extensions: ["lua"] }] });
      if (picked.canceled || !picked.filePaths[0]) return { ok: false, canceled: true };
      const input = picked.filePaths[0];
      if ((await fs.stat(input)).size > 16_000_000) throw new Error(T("GRM file exceeds 16 MB."));
      const result = convertGRM(await fs.readFile(input, "utf8"), { guild: guild.trim(), realm: realm.trim(), guildKey: `${guild.trim()}-${realm.trim().replace(/[\s-]/g, "")}`, edition, includePrivate: includePrivate === true });
      const summary = result.summary;
      const review = await dialog.showMessageBox(getWindow(), { type: "info", title: T("Review GRM conversion"),
        message: `${summary.guild} / ${summary.realm} / ${summary.edition}`,
        detail: T("{0} current members, {1} former members, {2} history entries, {3} alt groups. Private history: {4}. Omitted source fields: {5}; omitted logs: {6}.", summary.current, summary.former, summary.logs, summary.groups, T(summary.private ? "On" : "Off"), summary.omittedFields, summary.omittedLogs) + "\n\n" + T("This creates a local archive. Preview it in /guilded rosteradmin. No guild notes, ranks, points or Discord links are changed."),
        buttons: [T("Cancel"), T("Save archive")], defaultId: 0, cancelId: 0 });
      if (review.response !== 1) return { ok: false, canceled: true };
      const target = await dialog.showSaveDialog(getWindow(), { title: T("Save GRM archive"), defaultPath: "Guilded-GRM-archive.txt", filters: [{ name: "Guilded GRM", extensions: ["txt"] }] });
      if (target.canceled || !target.filePath) return { ok: false, canceled: true };
      await fs.writeFile(target.filePath, result.code + "\n", { flag: "wx", mode: 0o600 });
      return { ok: true, summary, message: T("Archive saved. Open the text file, copy its code, and preview it in /guilded rosteradmin.") };
    } catch (error) { return { ok: false, message: error.code === "EEXIST" ? T("Choose a new filename. Existing files are never overwritten.") : error.message }; }
  };
}
module.exports = { createGRMConverter };
