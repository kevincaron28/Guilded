// Reconstructs files locally only; never restores over a database or deployed app.
import { createDecipheriv, createHash } from "node:crypto";
import { createReadStream, createWriteStream, readFileSync, mkdirSync, renameSync, rmSync, existsSync } from "node:fs";
import { resolve, join, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";

const root = resolve(process.env.LOCALAPPDATA, "Guilded Recovery");
const directory = resolve(process.argv[2] ?? "");
if (!directory.startsWith(root + sep)) throw new Error("Use a local private Guilded Recovery directory.");
const metadata = JSON.parse(readFileSync(join(directory, "recovery.json"), "utf8"));
const keyRoot = resolve(process.env.LOCALAPPDATA, "Guilded Recovery Keys");
const keyPath = resolve(metadata.keyPath);
if (!keyPath.startsWith(keyRoot + sep)) throw new Error("Unexpected recovery key path.");
const key = readFileSync(keyPath);
const target = join(directory, "restored");
mkdirSync(target, { recursive: true });
for (const file of metadata.files) {
  if (!["database.dump", "application.tar.gz"].includes(file.name)) throw new Error("Unexpected recovery filename.");
  if (existsSync(join(target, file.name))) throw new Error("Recovered file already exists; it was not overwritten.");
  const temporary = join(target, `${file.name}.partial`);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(file.nonce, "hex"));
  decipher.setAuthTag(Buffer.from(file.tag, "hex"));
  const hash = createHash("sha256");
  const check = new Transform({ transform(chunk, _encoding, done) { hash.update(chunk); done(null, chunk); } });
  try {
    await pipeline(createReadStream(join(directory, `${file.name}.aes`)), decipher, check, createWriteStream(temporary, { flags: "wx" }));
    if (hash.digest("hex") !== file.sha256) throw new Error("Recovery checksum mismatch.");
    renameSync(temporary, join(target, file.name));
  } finally { rmSync(temporary, { force: true }); }
}
console.log(`Authenticated recovery files reconstructed privately: ${target}. No live data was changed.`);
