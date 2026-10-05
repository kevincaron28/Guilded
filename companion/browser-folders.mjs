// File handles stay on this browser/device. No paths or handles go to the bot.
function localHandleStore(indexedDB) {
  let dbPromise;
  async function database() {
    if (!indexedDB) return null;
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
  const ready = available ? Promise.all([store.get("input"), store.get("output")])
    .then(([read, write]) => { input = read; output = write; })
    .catch(() => { /* Private browsing may disable persistence; session access still works. */ }) : Promise.resolve();
  const remember = (key, handle) => store.set(key, handle).catch(() => {});
  async function permit(handle, mode) {
    if (await handle.queryPermission({ mode }) === "granted") return;
    if (await handle.requestPermission({ mode }) !== "granted") throw new Error("Folder access was not granted. Choose the folder again or allow access to continue.");
  }
  return {
    available, ready,
    hasInput: () => !!input,
    async chooseInput() {
      // Called directly from a click, before any network request.
      const selected = await env.showDirectoryPicker({ id: "guilded-saved-data", mode: "read" });
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
    async saveStandings(loadText) {
      // ready is already awaited by getAll before controls become usable.
      if (!output) {
        const selected = await env.showDirectoryPicker({ id: "guilded-addon", mode: "readwrite" });
        if (selected.name !== "Guilded") throw new Error("Choose Interface / AddOns / Guilded, not SavedVariables.");
        await selected.getFileHandle("Guilded.toc");
        output = selected; await remember("output", output);
      }
      await permit(output, "readwrite");
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
    }
  };
}
