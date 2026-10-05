// File handles stay on this browser/device. No paths or handles go to the bot.
function localHandleStore(indexedDB) {
  let dbPromise;
  async function database() {
    if (!indexedDB) throw new Error("Folder storage unavailable");
    dbPromise ||= new Promise((resolve, reject) => {
      const request = indexedDB.open("guilded.file-access.v1", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("handles");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return dbPromise;
  }
  return {
    async get(key) {
      const db = await database(); if (!db) return null;
      return new Promise((resolve, reject) => {
        const request = db.transaction("handles").objectStore("handles").get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    },
    async set(key, value) {
      if (!indexedDB && !value) return; // No persistent handle exists to clear.
      const db = await database(); if (!db) return;
      return new Promise((resolve, reject) => {
        const tx = db.transaction("handles", "readwrite");
        if (value) tx.objectStore("handles").put(value, key);
        else tx.objectStore("handles").delete(key);
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () => reject(tx.error);
      });
    }
  };
}

export function createBrowserFolderAccess(env = globalThis, store = localHandleStore(env.indexedDB)) {
  const available = typeof env.showDirectoryPicker === "function";
  let input, output;
  const failures = new Set();
  const warning = () => failures.size ? "This browser could not remember your folders. They work in this tab, but you may need to select them again after reopening. Allow site storage or use the Windows companion." : null;
  const ready = available ? Promise.allSettled([store.get("input"), store.get("output")])
    .then(([read, write]) => {
      if (read.status === "fulfilled") input = read.value; else failures.add("input");
      if (write.status === "fulfilled") output = write.value; else failures.add("output");
    }) : Promise.resolve();
  const remember = async (key, handle) => {
    try { await store.set(key, handle); failures.delete(key); }
    catch { failures.add(key); }
  };
  async function permit(handle, mode) {
    if (await handle.queryPermission({ mode }) === "granted") return;
    if (await handle.requestPermission({ mode }) !== "granted") throw new Error("Folder access was not granted. Choose the folder again or allow access to continue.");
  }
  return {
    available, ready,
    hasInput: () => !!input,
    hasOutput: () => !!output,
    storageWarning: warning,
    async chooseInput() {
      // Called directly from a click, before any network request.
      const selected = await env.showDirectoryPicker({ id: "guilded-saved-data", mode: "read", ...(input ? { startIn: input } : {}) });
      if (selected.name !== "SavedVariables") throw new Error("Choose your account's SavedVariables folder containing Guilded.lua.");
      await selected.getFileHandle("Guilded.lua");
      input = selected; await remember("input", input);
      return "SavedVariables / Guilded.lua";
    },
    async readInput() {
      await ready;
      if (!input) return null;
      await permit(input, "read");
      // Re-resolve by name: WoW may replace the file on /reload or logout.
      return (await input.getFileHandle("Guilded.lua")).getFile();
    },
    async saveStandings(loadText, { requestAccess = true } = {}) {
      // ready is already awaited by getAll before controls become usable.
      if (!output) {
        if (!requestAccess) throw new Error("Choose your Guilded addon folder with Save standings to addon first.");
        const selected = await env.showDirectoryPicker({ id: "guilded-addon", mode: "readwrite" });
        if (selected.name !== "Guilded") throw new Error("Choose Interface / AddOns / Guilded, not SavedVariables.");
        await selected.getFileHandle("Guilded.toc");
        output = selected; await remember("output", output);
      }
      if (requestAccess) await permit(output, "readwrite");
      else if (await output.queryPermission({ mode: "readwrite" }) !== "granted") {
        throw new Error("Allow folder access with Save standings to addon, then Sync now will update standings too.");
      }
      // Validate again if the folder was removed or repurposed since selection.
      await output.getFileHandle("Guilded.toc");
      const text = await loadText();
      const handle = await output.getFileHandle("Standings.lua", { create: true });
      const writer = await handle.createWritable();
      try { await writer.write(text); await writer.close(); }
      catch (error) { try { await writer.abort(); } catch { /* already closed */ } throw error; }
    },
    async forget() {
      await ready; input = undefined; output = undefined;
      // A storage failure must not falsely claim persisted access was forgotten.
      await Promise.all([store.set("input", null), store.set("output", null)]);
      failures.clear();
    }
  };
}
