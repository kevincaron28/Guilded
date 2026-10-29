// The main process owns selected bytes. Renderer requests never contain file paths.
function createLootHistoryConverter({ dialog, fs, readLootImportFile, previewLootHistory, createLootHistoryArchive, getWindow, T }) {
  let pending, generation = 0, busy = false;
  return {
    async preview(options) {
      if (busy) return { ok: false, message: T("A loot import dialog is already open.") };
      busy = true; pending = undefined; const token = ++generation;
      try {
        const selected = await dialog.showOpenDialog(getWindow(), { title: T("Choose loot history export"), properties: ["openFile"], filters: [{ name: "Loot history", extensions: ["csv", "json"] }] });
        if (selected.canceled || !selected.filePaths[0]) return { canceled: true };
        const input = await readLootImportFile(selected.filePaths[0]);
        const result = previewLootHistory(input, { ...options, characterMap: {} });
        pending = { input, options: { ...options }, token };
        return { ok: true, token, characters: result.unmappedCharacters, summary: result.summary, warnings: result.warnings, entries: result.entries };
      } catch (error) { return { ok: false, message: error.message }; }
      finally { busy = false; }
    },
    async save({ token, characterMap, allowUnidentified }) {
      if (busy) return { ok: false, message: T("A loot import dialog is already open.") };
      if (!pending || token !== pending.token) return { ok: false, message: T("Choose and preview the export again.") };
      busy = true;
      try {
        const { code, preview } = createLootHistoryArchive(pending.input, { ...pending.options, characterMap }, allowUnidentified);
        const response = await dialog.showMessageBox(getWindow(), { type: "info", title: T("Review loot history archive"),
          message: `${preview.scope.guild} / ${preview.scope.realm} / ${preview.scope.edition}`,
          detail: T("{0} awards; {1} duplicates omitted; {2} awards without stable IDs.", preview.summary.previewRows, preview.summary.duplicates, preview.summary.missingSourceIds) + "\n\n" + T("Save a local archive, then preview and confirm it in /guilded import history. No points or live awards change."),
          buttons: [T("Cancel"), T("Save archive")], defaultId: 0, cancelId: 0 });
        if (response.response !== 1) return { canceled: true };
        const target = await dialog.showSaveDialog(getWindow(), { title: T("Save loot history archive"), defaultPath: "Guilded-loot-history.txt", filters: [{ name: "Guilded loot history", extensions: ["txt"] }] });
        if (target.canceled || !target.filePath) return { canceled: true };
        await fs.writeFile(target.filePath, code + "\n", { flag: "wx", mode: 0o600 });
        pending = undefined;
        return { ok: true, message: T("Archive saved. Copy its code into /guilded import history, review it, then confirm in-game.") };
      } catch (error) { return { ok: false, message: error.code === "EEXIST" ? T("Choose a new filename. Existing files are never overwritten.") : error.message }; }
      finally { busy = false; }
    }
  };
}
module.exports = { createLootHistoryConverter };
