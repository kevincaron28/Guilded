import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { previewLootHistory, createLootHistoryArchive } from "../companion/loot-history-import.mjs";
const require = createRequire(import.meta.url);
const { createLootHistoryConverter } = require("../companion-app/loot-history-import.cjs");
const { validateIpc } = require("../companion-app/ipc-security.cjs");
const source = JSON.stringify([{ player: "Amy-Realm", date: "2026/10/29", time: "20:10", id: "a-1", itemID: 19364 }]);
const options = { source: "rclootcouncil", guild: "Guild", realm: "Realm", edition: "classic-era" };
function setup() {
  const fs = { writeFile: vi.fn().mockResolvedValue(undefined) };
  const readLootImportFile = vi.fn().mockResolvedValue(source);
  const dialog = { showOpenDialog: vi.fn().mockResolvedValue({ canceled: false, filePaths: ["selected.json"] }),
    showMessageBox: vi.fn().mockResolvedValue({ response: 1 }), showSaveDialog: vi.fn().mockResolvedValue({ canceled: false, filePath: "archive.txt" }) };
  const converter = createLootHistoryConverter({ dialog, fs, readLootImportFile, previewLootHistory, createLootHistoryArchive,
    getWindow: () => null, T: (key: string, ...values: unknown[]) => key.replace(/\{(\d+)\}/g, (_, i) => String(values[Number(i)])) });
  return { converter, fs, readLootImportFile, dialog };
}
const mapping = { "Amy-Realm": "Amy-Realm" };
describe("desktop loot import", () => {
  it("binds the file and scope to a preview, reviews mappings, saves a new archive, then consumes the preview", async () => {
    const { converter, fs, dialog } = setup();
    const result = await converter.preview(options);
    expect(result).toMatchObject({ ok: true, characters: ["Amy-Realm"], summary: { previewRows: 1 } });
    expect(fs.writeFile).not.toHaveBeenCalled();
    const save = { token: result.token, characterMap: mapping, allowUnidentified: false };
    expect(await converter.save(save)).toMatchObject({ ok: true });
    expect(dialog.showMessageBox).toHaveBeenCalledWith(null, expect.objectContaining({ message: "Guild / Realm / classic-era", defaultId: 0 }));
    expect(fs.writeFile).toHaveBeenCalledWith("archive.txt", expect.stringMatching(/^GLH1:/), { flag: "wx", mode: 0o600 });
    expect(await converter.save(save)).toMatchObject({ ok: false });
    expect(fs.writeFile).toHaveBeenCalledTimes(1);
  });
  it.each(["file", "review", "destination"])("never writes after %s cancellation", async stage => {
    const { converter, fs, dialog } = setup();
    if (stage === "file") dialog.showOpenDialog.mockResolvedValue({ canceled: true });
    if (stage === "review") dialog.showMessageBox.mockResolvedValue({ response: 0 });
    if (stage === "destination") dialog.showSaveDialog.mockResolvedValue({ canceled: true });
    const preview = await converter.preview(options);
    const result = stage === "file" ? preview : await converter.save({ token: preview.token, characterMap: mapping, allowUnidentified: false });
    expect(result.canceled).toBe(true); expect(fs.writeFile).not.toHaveBeenCalled();
  });
  it("rejects incomplete mappings, stale previews, overlapping dialogs and oversized files", async () => {
    const { converter, fs, dialog, readLootImportFile } = setup();
    const first = await converter.preview(options);
    expect(await converter.save({ token: first.token, characterMap: {}, allowUnidentified: false })).toMatchObject({ ok: false });
    await converter.preview({ ...options, guild: "Other" });
    expect(await converter.save({ token: first.token, characterMap: mapping, allowUnidentified: false })).toMatchObject({ ok: false });
    let release!: (value: unknown) => void;
    dialog.showOpenDialog.mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const pending = converter.preview(options);
    expect(await converter.preview(options)).toMatchObject({ ok: false });
    release({ canceled: true }); await pending;
    dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ["too-large.json"] });
    readLootImportFile.mockRejectedValue(new Error("Input file exceeds size limit."));
    expect(await converter.preview(options)).toMatchObject({ ok: false });
    expect(fs.writeFile).not.toHaveBeenCalled();
  });
  it("preserves the source and existing output on filename conflicts", async () => {
    const { converter, fs } = setup();
    const result = await converter.preview(options);
    fs.writeFile.mockRejectedValue(Object.assign(new Error("exists"), { code: "EEXIST" }));
    expect(await converter.save({ token: result.token, characterMap: mapping, allowUnidentified: false })).toMatchObject({ ok: false, message: expect.stringContaining("never overwritten") });
  });
  it("bounds IPC and rejects path/scope injection into the save step", () => {
    expect(() => validateIpc("loot-history-preview", [options])).not.toThrow();
    expect(() => validateIpc("loot-history-save", [{ token: 1, characterMap: mapping, allowUnidentified: false }])).not.toThrow();
    for (const extra of [{ path: "private" }, { input: "other" }, { guild: "Other" }, { edition: "retail" }]) {
      expect(() => validateIpc("loot-history-save", [{ token: 1, characterMap: mapping, allowUnidentified: false, ...extra }])).toThrow();
    }
    expect(() => validateIpc("loot-history-preview", [{ ...options, path: "private" }])).toThrow();
    expect(() => validateIpc("loot-history-save", [{ token: -1, characterMap: [], allowUnidentified: "true" }])).toThrow();
  });
});
