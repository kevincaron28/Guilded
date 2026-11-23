// Off-tenancy database backups: encryption, a tiny S3 (Cloudflare R2) client and the retention rule.
// No dependencies beyond Node. Used by scripts/offsite-backup.mjs (docs/OFFSITE_BACKUPS.md).
//
// Encryption: every dump gets its own random AES-256-GCM key. That key is wrapped (RSA-OAEP, SHA-256) once for each
// recipient public key. The server holds only PUBLIC keys, so a stolen server or a leaked R2 credential cannot read the
// dumps. The recovery private key stays with the owner, never on the server and never in git. An optional second
// "restore-test" recipient lets the monthly restore test decrypt on the server; see the runbook for that trade-off.

import { createCipheriv, createDecipheriv, createHash, createHmac, createPublicKey, createPrivateKey, publicEncrypt, privateDecrypt, constants, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, statSync } from "node:fs";
import { open } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { request } from "node:https";
import { request as httpRequest } from "node:http";

export const MAGIC = Buffer.from("GBK1");
const TAG_LENGTH = 16;

/** Short id of a public key, stored beside each wrapped key so a decryptor can pick its own. */
export function keyId(publicPem) {
  const der = createPublicKey(publicPem).export({ type: "spki", format: "der" });
  return createHash("sha256").update(der).digest("hex").slice(0, 16);
}

/** Encrypts `inputPath` into `outputPath` for every PEM public key in `recipients` ([{ id?, pem }]). Returns the plain size and the ciphertext sha256. */
export async function encryptFile(inputPath, outputPath, recipients) {
  if (!recipients.length) throw new Error("At least one recipient public key is required.");
  const key = randomBytes(32), iv = randomBytes(12);
  const wraps = recipients.map(({ pem }) => ({
    kid: keyId(pem),
    wrapped: publicEncrypt({ key: pem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, key).toString("base64")
  }));
  const header = Buffer.from(JSON.stringify({ alg: "aes-256-gcm+rsa-oaep-sha256", iv: iv.toString("base64"), wraps, createdAt: new Date().toISOString() }));
  const prefix = Buffer.alloc(8);
  MAGIC.copy(prefix, 0);
  prefix.writeUInt32BE(header.length, 4);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const out = createWriteStream(outputPath, { flags: "wx", mode: 0o600 });
  const hash = createHash("sha256");
  const write = (chunk) => new Promise((resolve, reject) => { hash.update(chunk); out.write(chunk, (error) => error ? reject(error) : resolve()); });
  await write(prefix); await write(header);
  const input = createReadStream(inputPath);
  for await (const chunk of input) await write(cipher.update(chunk));
  await write(cipher.final());
  await write(cipher.getAuthTag());
  await new Promise((resolve, reject) => out.end((error) => error ? reject(error) : resolve()));
  return { plainBytes: statSync(inputPath).size, sha256: hash.digest("hex"), keyIds: wraps.map((w) => w.kid) };
}

/** Reads the header of an encrypted file without decrypting. */
export async function readHeader(path) {
  const handle = await open(path, "r");
  try {
    const prefix = Buffer.alloc(8);
    await handle.read(prefix, 0, 8, 0);
    if (!prefix.subarray(0, 4).equals(MAGIC)) throw new Error("Not a Guilded backup file.");
    const length = prefix.readUInt32BE(4);
    if (length > 1_000_000) throw new Error("Backup header is too large.");
    const header = Buffer.alloc(length);
    await handle.read(header, 0, length, 8);
    return { header: JSON.parse(header.toString("utf8")), dataStart: 8 + length };
  } finally { await handle.close(); }
}

/** Decrypts with a PEM private key (the recipient whose key id matches one of the wraps). Verifies the GCM tag before reporting success. */
export async function decryptFile(inputPath, outputPath, privatePem) {
  const { header, dataStart } = await readHeader(inputPath);
  const privateKey = createPrivateKey(privatePem);
  const publicPem = createPublicKey(privateKey).export({ type: "spki", format: "pem" });
  const mine = header.wraps.find((wrap) => wrap.kid === keyId(publicPem));
  if (!mine) throw new Error("This private key is not a recipient of the backup.");
  const key = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, Buffer.from(mine.wrapped, "base64"));
  const size = statSync(inputPath).size;
  const handle = await open(inputPath, "r");
  const tag = Buffer.alloc(TAG_LENGTH);
  await handle.read(tag, 0, TAG_LENGTH, size - TAG_LENGTH);
  await handle.close();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(header.iv, "base64"));
  decipher.setAuthTag(tag);
  await pipeline(createReadStream(inputPath, { start: dataStart, end: size - TAG_LENGTH - 1 }), decipher, createWriteStream(outputPath, { flags: "wx", mode: 0o600 }));
}

export async function sha256File(file) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}

// ---------------------------------------------------------------- retention

/** Keys under daily/ and monthly/ look like daily/guilded-YYYY-MM-DD.dump.enc and monthly/guilded-YYYY-MM.dump.enc. */
export const dailyKey = (day) => `daily/guilded-${day}.dump.enc`;
export const monthlyKey = (month) => `monthly/guilded-${month}.dump.enc`;
export const manifestKeyFor = (key) => key.replace(/\.dump\.enc$/, ".manifest.json");

/** Pure: which stored keys to delete so that the newest `dailies` daily and `monthlies` monthly dumps remain. Manifests follow their dump. */
export function retentionDeletes(keys, { dailies = 14, monthlies = 6 } = {}) {
  const sorted = (prefix) => keys.filter((key) => key.startsWith(prefix) && key.endsWith(".dump.enc")).sort().reverse();
  const doomed = [...sorted("daily/").slice(dailies), ...sorted("monthly/").slice(monthlies)];
  const manifests = new Set(keys.filter((key) => key.endsWith(".manifest.json")));
  return doomed.flatMap((key) => [key, ...(manifests.has(manifestKeyFor(key)) ? [manifestKeyFor(key)] : [])]);
}

// ---------------------------------------------------------------- S3 / R2 (Signature Version 4)

const hmac = (key, data) => createHmac("sha256", key).update(data).digest();
const hex = (data) => createHash("sha256").update(data).digest("hex");
const encodeKey = (key) => key.split("/").map((part) => encodeURIComponent(part)).join("/");

/** Pure: the SigV4 headers for one request. Exported for the test. */
export function signRequest({ method, host, canonicalPath, query = {}, headers = {}, payloadHash, accessKeyId, secretAccessKey, region = "auto", service = "s3", now = new Date() }) {
  const amz = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = amz.slice(0, 8);
  const all = { ...headers, host, "x-amz-content-sha256": payloadHash, "x-amz-date": amz };
  const names = Object.keys(all).map((name) => name.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(all).map(([name, value]) => [name.toLowerCase(), String(value).trim()]));
  const canonicalQuery = Object.keys(query).sort().map((name) => `${encodeURIComponent(name)}=${encodeURIComponent(query[name])}`).join("&");
  const canonical = [method, canonicalPath, canonicalQuery, names.map((name) => `${name}:${lower[name]}\n`).join(""), names.join(";"), payloadHash].join("\n");
  const scope = `${date}/${region}/${service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amz, scope, hex(canonical)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, date), region), service), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  return { ...lower, authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}` };
}

export class ObjectStore {
  /** `endpoint` like https://<account>.r2.cloudflarestorage.com (tests pass an http://127.0.0.1 server). Credentials are never logged. */
  constructor({ endpoint, bucket, accessKeyId, secretAccessKey }) {
    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) throw new Error("The R2 endpoint, bucket and credentials must all be set.");
    this.url = new URL(endpoint); this.bucket = bucket; this.accessKeyId = accessKeyId; this.secretAccessKey = secretAccessKey;
  }

  async #send(method, key, { query = {}, headers = {}, body, file, sink } = {}) {
    const canonicalPath = `/${this.bucket}${key ? `/${encodeKey(key)}` : ""}`;
    const bodyBuffer = body === undefined ? undefined : Buffer.from(body);
    const length = file ? statSync(file).size : bodyBuffer?.length;
    const payloadHash = file ? "UNSIGNED-PAYLOAD" : hex(bodyBuffer ?? "");
    const signed = signRequest({
      method, host: this.url.host, canonicalPath, query, payloadHash, accessKeyId: this.accessKeyId, secretAccessKey: this.secretAccessKey,
      headers: { ...headers, ...(length !== undefined && (method === "PUT") ? { "content-length": String(length) } : {}) }
    });
    delete signed.host;
    const search = Object.keys(query).sort().map((name) => `${encodeURIComponent(name)}=${encodeURIComponent(query[name])}`).join("&");
    const send = this.url.protocol === "http:" ? httpRequest : request;
    return new Promise((resolve, reject) => {
      const req = send({ protocol: this.url.protocol, hostname: this.url.hostname, port: this.url.port || undefined, method, path: canonicalPath + (search ? `?${search}` : ""), headers: signed, timeout: 600_000 }, (response) => {
        const done = (text) => response.statusCode >= 200 && response.statusCode < 300 ? resolve({ status: response.statusCode, text, headers: response.headers }) : reject(new Error(`R2 ${method} ${key || "(list)"} failed: HTTP ${response.statusCode} ${text.slice(0, 300)}`));
        if (sink && response.statusCode >= 200 && response.statusCode < 300) { pipeline(response, createWriteStream(sink, { flags: "wx", mode: 0o600 })).then(() => done(""), reject); return; }
        const chunks = []; response.on("data", (chunk) => chunks.push(chunk)); response.on("end", () => done(Buffer.concat(chunks).toString("utf8")));
      });
      req.on("error", reject); req.on("timeout", () => req.destroy(new Error("R2 request timed out")));
      if (file) pipeline(createReadStream(file), req).catch(reject); else req.end(bodyBuffer);
    });
  }

  async putFile(key, file) { await this.#send("PUT", key, { file, headers: { "content-type": "application/octet-stream" } }); }
  async putText(key, text) { await this.#send("PUT", key, { body: text, headers: { "content-type": "application/json" } }); }
  async getText(key) { return (await this.#send("GET", key)).text; }
  async getFile(key, sink) { await this.#send("GET", key, { sink }); }
  async delete(key) { await this.#send("DELETE", key); }
  async copy(from, to) { await this.#send("PUT", to, { headers: { "x-amz-copy-source": `/${this.bucket}/${encodeKey(from)}` }, body: "" }); }
  async exists(key) { try { await this.#send("HEAD", key); return true; } catch { return false; } }
  async list(prefix = "") {
    const keys = []; let token;
    do {
      const { text } = await this.#send("GET", "", { query: { "list-type": "2", prefix, ...(token ? { "continuation-token": token } : {}) } });
      for (const match of text.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(match[1].replace(/&amp;/g, "&"));
      token = /<IsTruncated>true<\/IsTruncated>/.test(text) ? /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(text)?.[1] : undefined;
    } while (token);
    return keys;
  }
}
