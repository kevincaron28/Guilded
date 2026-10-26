import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve, basename } from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const { createStoreConfig } = require("../companion-app/store-config.cjs");
const folders: string[] = [];
function harness() {
  const folder = mkdtempSync(join(tmpdir(), "guilded-store-config-")); folders.push(folder);
  const key = randomBytes(32);
  const storage = {
    isAsyncEncryptionAvailable: vi.fn(async () => true),
    encryptStringAsync: vi.fn(async (text: string) => {
      const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([cipher.update(text), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
    }),
    decryptStringAsync: vi.fn(async (bytes: Buffer) => {
      const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return { result: Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString(), shouldReEncrypt: false };
    })
  };
  return { folder, file: join(folder, "config.secure"), storage, store: createStoreConfig(storage) };
}
afterEach(() => {
  for (const folder of folders.splice(0)) {
    expect(dirname(resolve(folder))).toBe(resolve(tmpdir()));
    expect(basename(folder).startsWith("guilded-store-config-")).toBe(true);
    rmSync(folder, { recursive: true, force: true });
  }
});
it("protects every profile and persists snapshots in order without plaintext temporary files", async () => {
  const h = harness(), config = { companionCredential: "secret-primary", profiles: { retail: { companionCredential: "secret-retail" } }, name: "old" };
  const first = h.store.write(h.file, config); config.name = "new";
  const second = h.store.write(h.file, config);
  await Promise.all([first, second, h.store.flush()]);
  expect(await h.store.read(h.file)).toEqual(config);
  expect(readFileSync(h.file).includes(Buffer.from("secret"))).toBe(false);
  expect(h.storage.encryptStringAsync.mock.calls[0]![0]).toContain('"name":"old"');
  expect(readdirSync(h.folder)).toEqual(["config.secure"]);
});
it("keeps prior encrypted data intact if protection fails and allows a later retry", async () => {
  const h = harness(); await h.store.write(h.file, { key: "old" });
  const before = readFileSync(h.file);
  h.storage.isAsyncEncryptionAvailable.mockResolvedValue(false);
  await expect(h.store.write(h.file, { key: "new" })).rejects.toThrow("unavailable");
  expect(readFileSync(h.file)).toEqual(before);
  h.storage.isAsyncEncryptionAvailable.mockResolvedValue(true);
  await h.store.write(h.file, { key: "retry" });
  expect(await h.store.read(h.file)).toEqual({ key: "retry" });
});
it("does not treat corrupt or undecryptable settings as first run", async () => {
  const h = harness(); expect(await h.store.read(h.file)).toBeNull();
  writeFileSync(h.file, '{"companionCredential":"plaintext-not-accepted"}');
  await expect(h.store.read(h.file)).rejects.toThrow();
  expect(readFileSync(h.file, "utf8")).toContain("plaintext-not-accepted");
});
it("rewrites decryptable settings when Windows requests key rotation", async () => {
  const h = harness(); await h.store.write(h.file, { key: "retained" });
  h.storage.decryptStringAsync.mockResolvedValueOnce({ result: '{"key":"retained"}', shouldReEncrypt: true });
  expect(await h.store.read(h.file)).toEqual({ key: "retained" });
  expect(h.storage.encryptStringAsync).toHaveBeenCalledTimes(2);
});
