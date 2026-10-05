import { describe, expect, it, vi } from "vitest";
import { createBrowserFolderAccess } from "../companion/browser-folders.mjs";

function fixture() {
  const rows = new Map();
  const store = { get: vi.fn(async key => rows.get(key)), set: vi.fn(async (key, value) => { if (value) rows.set(key, value); else rows.delete(key); }) };
  let content = "first export";
  const read = { name: "SavedVariables", queryPermission: vi.fn(async () => "granted"), requestPermission: vi.fn(async () => "denied"), getFileHandle: vi.fn(async (name: string) => { if (name !== "Guilded.lua") throw new Error("Unexpected input"); return { getFile: async () => ({ text: async () => content }) }; }) };
  const writer = { write: vi.fn(async () => {}), close: vi.fn(async () => {}), abort: vi.fn(async () => {}) };
  const output = { name: "Guilded", queryPermission: vi.fn(async () => "granted"), requestPermission: vi.fn(async () => "denied"), getFileHandle: vi.fn(async () => ({ createWritable: async () => writer })) };
  const env = { showDirectoryPicker: vi.fn(async () => read) };
  const api = createBrowserFolderAccess(env as never, store);
  return { api, env, store, rows, read, output, writer, replace: (next: string) => { content = next; } };
}

describe("browser folder access", () => {
  it("reopens Guilded.lua by name on every sync and restores folder choices", async () => {
    const f = fixture(); await f.api.ready; await f.api.chooseInput();
    expect(await (await f.api.readInput())?.text()).toBe("first export");
    f.replace("fresh export");
    const restored = createBrowserFolderAccess(f.env as never, f.store); await restored.ready;
    expect(await (await restored.readInput())?.text()).toBe("fresh export");
    expect(f.read.getFileHandle.mock.calls.every(call => call[0] === "Guilded.lua")).toBe(true);
  });
  it("refuses a revoked input permission without reading the file", async () => {
    const f = fixture(); await f.api.ready; await f.api.chooseInput(); f.read.getFileHandle.mockClear();
    f.read.queryPermission.mockResolvedValue("prompt");
    await expect(f.api.readInput()).rejects.toThrow("not granted");
    expect(f.read.getFileHandle).not.toHaveBeenCalled();
  });
  it("requires the two distinct intended folders and never writes SavedVariables", async () => {
    const f = fixture(); await f.api.ready;
    f.env.showDirectoryPicker.mockResolvedValue(f.output as never);
    await expect(f.api.chooseInput()).rejects.toThrow("SavedVariables");
    f.env.showDirectoryPicker.mockResolvedValue(f.read);
    await expect(f.api.saveStandings(async () => "data")).rejects.toThrow("AddOns");
    expect(f.writer.write).not.toHaveBeenCalled();
  });
  it("writes only Standings.lua after permission and a successful response", async () => {
    const f = fixture(); await f.api.ready; f.env.showDirectoryPicker.mockResolvedValue(f.output as never);
    await f.api.saveStandings(async () => "GuildedStandings = {}");
    expect(f.output.getFileHandle.mock.calls).toContainEqual(["Standings.lua", { create: true }]);
    expect(f.writer.write).toHaveBeenCalledWith("GuildedStandings = {}");
    expect(f.writer.close).toHaveBeenCalledOnce();
    f.output.getFileHandle.mockClear();
    await expect(f.api.saveStandings(async () => { throw new Error("401 revoked"); })).rejects.toThrow("401");
    expect(f.output.getFileHandle.mock.calls).not.toContainEqual(["Standings.lua", { create: true }]);
  });
  it("does not fetch or write when output permission is denied, and aborts failed writes", async () => {
    const f = fixture(); await f.api.ready; f.env.showDirectoryPicker.mockResolvedValue(f.output as never);
    f.output.queryPermission.mockResolvedValue("prompt"); const load = vi.fn(async () => "data");
    await expect(f.api.saveStandings(load)).rejects.toThrow("not granted"); expect(load).not.toHaveBeenCalled();
    f.output.queryPermission.mockResolvedValue("granted"); f.writer.write.mockRejectedValueOnce(new Error("disk full"));
    await expect(f.api.saveStandings(load)).rejects.toThrow("disk full");
    expect(f.writer.abort).toHaveBeenCalledOnce(); expect(f.writer.close).not.toHaveBeenCalled();
  });
  it("forgets persisted handles and works for this session when storage is unavailable", async () => {
    const f = fixture(); await f.api.ready; await f.api.chooseInput(); await f.api.forget();
    expect(f.rows.size).toBe(0); expect(f.api.hasInput()).toBe(false);
    f.store.set.mockRejectedValueOnce(new Error("storage disabled")); await f.api.chooseInput();
    expect(await f.api.readInput()).toBeTruthy();
  });
});
