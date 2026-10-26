const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

// Store profiles are separate from NSIS profiles. Never silently fall back to
// plaintext or overwrite an unreadable encrypted configuration with defaults.
function createStoreConfig(safeStorage) {
  let pending = Promise.resolve();
  async function available() {
    if (!safeStorage || !await safeStorage.isAsyncEncryptionAvailable()) throw new Error("Windows protected storage is unavailable. Your settings were not saved.");
  }
  function write(file, config) {
    const snapshot = JSON.stringify(config);
    const save = pending.catch(() => {}).then(async () => {
      await available();
      const encrypted = await safeStorage.encryptStringAsync(snapshot);
      if (!Buffer.isBuffer(encrypted) || !encrypted.length) throw new Error("Windows did not protect the settings.");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        fs.writeFileSync(temporary, encrypted, { flag: "wx", mode: 0o600 });
        fs.renameSync(temporary, file);
      } finally { fs.rmSync(temporary, { force: true }); }
    });
    pending = save;
    return save;
  }
  return {
    write,
    flush: () => pending,
    async read(file) {
      let encrypted;
      try { encrypted = fs.readFileSync(file); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
      await available();
      const decrypted = await safeStorage.decryptStringAsync(encrypted);
      const config = JSON.parse(decrypted.result);
      if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("Protected settings are invalid.");
      if (decrypted.shouldReEncrypt) await write(file, config);
      return config;
    }
  };
}
module.exports = { createStoreConfig };
