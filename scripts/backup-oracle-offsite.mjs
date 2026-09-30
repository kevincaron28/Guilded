import { randomBytes, createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { createReadStream, createWriteStream, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { pipeline } from "node:stream/promises";

const remote = process.argv[2];
if (!/^\/home\/ubuntu\/guilded-recovery\/[0-9TZ-]+$/.test(remote ?? "")) throw new Error("A verified recovery directory is required.");
const identity = join(process.env.USERPROFILE, ".ssh", "guilded_oracle");
const ssh = join(process.env.WINDIR, "System32", "OpenSSH", "ssh.exe");
const stamp = remote.split("/").at(-1);
const directory = join(process.env.LOCALAPPDATA, "Guilded Recovery", stamp);
const keyPath = join(process.env.LOCALAPPDATA, "Guilded Recovery Keys", `${stamp}.key`);
if (process.platform !== "win32") throw new Error("This helper uses the configured Windows deployment identity.");
for (const root of [join(process.env.LOCALAPPDATA, "Guilded Recovery"), join(process.env.LOCALAPPDATA, "Guilded Recovery Keys")]) {
  mkdirSync(root, { recursive: true });
  execFileSync("icacls", [root, "/inheritance:r", "/grant:r", `${process.env.USERDOMAIN}\\${process.env.USERNAME}:(OI)(CI)F`], { stdio: "ignore" });
}
mkdirSync(directory, { recursive: true });
const key = randomBytes(32);
writeFileSync(keyPath, key, { flag: "wx" });
const files = [];
for (const name of ["database.dump", "application.tar.gz"]) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const child = spawn(ssh, ["-i", identity, "ubuntu@168.138.70.194", "sudo", "cat", `${remote}/${name}`], { stdio: ["ignore", "pipe", "pipe"] });
  const exited = new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", code => code === 0 ? resolve() : reject(new Error("Recovery transfer failed"))); });
  child.stderr.resume();
  const path = join(directory, `${name}.aes`);
  await Promise.all([pipeline(child.stdout, cipher, createWriteStream(path, { flags: "wx" })), exited]);
  const tag = cipher.getAuthTag();
  // Verify authenticated decryption and byte equality without writing plaintext.
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), decipher, hash);
  const localHash = hash.digest("hex");
  const remoteHash = execFileSync(ssh, ["-i", identity, "ubuntu@168.138.70.194", "sudo", "sha256sum", `${remote}/${name}`], { encoding: "utf8" }).split(/\s+/)[0];
  if (remoteHash !== localHash) throw new Error("Recovery checksum mismatch");
  files.push({ name, nonce: nonce.toString("hex"), tag: tag.toString("hex"), sha256: localHash });
}
const metadata = { source: remote, algorithm: "aes-256-gcm", keyPath, createdAt: new Date().toISOString(), files };
writeFileSync(join(directory, "recovery.json"), JSON.stringify(metadata, null, 2));
if (readFileSync(keyPath).length !== 32) throw new Error("Recovery key verification failed");
console.log(JSON.stringify({ encryptedRecovery: directory, separatelyStoredKey: keyPath, verifiedFiles: files.map(file => file.name), authenticatedDecryptionAndChecksums: true }));
