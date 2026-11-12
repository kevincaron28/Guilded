"use strict";
// Reads a Microsoft Store companion settings folder without Electron's safeStorage (9.1.4).
// Electron protects config.secure with a key kept in that folder's "Local State" (os_crypt.encrypted_key,
// itself protected for this Windows user by DPAPI); this install has a different key, so the Store file
// has to be opened with the Store's own key. Same Windows user only. Pure Node apart from `unprotect`,
// which main.cjs backs with DPAPI (a PowerShell call), so the rest is tested without Windows.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

/**
 * @param {string} dir  a Store settings folder (config.secure + Local State)
 * @param {{ unprotect: (blob: Buffer) => Promise<Buffer>, fsImpl?: typeof fs }} options
 * @returns {Promise<Record<string, any> | null>}
 */
async function readStoreSettings(dir, { unprotect, fsImpl = fs }) {
  const localState = JSON.parse(fsImpl.readFileSync(path.join(dir, "Local State"), "utf8"));
  const wrapped = Buffer.from(String(localState?.os_crypt?.encrypted_key ?? ""), "base64");
  if (wrapped.subarray(0, 5).toString("latin1") !== "DPAPI") return null;
  const key = await unprotect(wrapped.subarray(5));
  const file = fsImpl.readFileSync(path.join(dir, "config.secure"));
  // Chromium's format: "v10", 12-byte nonce, ciphertext, 16-byte tag (AES-256-GCM).
  if (file.subarray(0, 3).toString("latin1") !== "v10" || file.length < 3 + 12 + 16) return null;
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, file.subarray(3, 15));
  decipher.setAuthTag(file.subarray(file.length - 16));
  const text = Buffer.concat([decipher.update(file.subarray(15, file.length - 16)), decipher.final()]).toString("utf8");
  const config = JSON.parse(text);
  return config && typeof config === "object" && !Array.isArray(config) ? config : null;
}

module.exports = { readStoreSettings };
