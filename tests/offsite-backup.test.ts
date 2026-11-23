import { createServer } from "node:http";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ObjectStore, dailyKey, decryptFile, encryptFile, keyId, manifestKeyFor, monthlyKey, readHeader, retentionDeletes, signRequest } from "../scripts/offsite-backup-lib.mjs";
import { COUNTED_TABLES, compareCounts, pgEnvFromUrl } from "../scripts/offsite-backup.mjs";

const pair = () => generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
const scratch = () => mkdtempSync(join(tmpdir(), "offsite-test-"));

describe("off-site backup encryption", () => {
  it("round-trips for each recipient and refuses a stranger's key", async () => {
    const dir = scratch();
    try {
      const recovery = pair(), restoreTest = pair(), stranger = pair();
      const plain = Buffer.concat([Buffer.from("PGDMP-pretend-dump"), Buffer.alloc(300_000, 7)]);
      writeFileSync(join(dir, "in"), plain);
      const sealed = await encryptFile(join(dir, "in"), join(dir, "enc"), [{ pem: recovery.publicKey }, { pem: restoreTest.publicKey }]);
      expect(sealed.keyIds).toEqual([keyId(recovery.publicKey), keyId(restoreTest.publicKey)]);
      expect(readFileSync(join(dir, "enc")).includes(Buffer.from("PGDMP"))).toBe(false);
      expect((await readHeader(join(dir, "enc"))).header.wraps).toHaveLength(2);
      await decryptFile(join(dir, "enc"), join(dir, "out1"), recovery.privateKey);
      await decryptFile(join(dir, "enc"), join(dir, "out2"), restoreTest.privateKey);
      expect(readFileSync(join(dir, "out1")).equals(plain)).toBe(true);
      expect(readFileSync(join(dir, "out2")).equals(plain)).toBe(true);
      await expect(decryptFile(join(dir, "enc"), join(dir, "out3"), stranger.privateKey)).rejects.toThrow(/not a recipient/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("detects a flipped byte (the GCM tag fails) and needs a recipient", async () => {
    const dir = scratch();
    try {
      const keys = pair();
      writeFileSync(join(dir, "in"), Buffer.alloc(5000, 1));
      await encryptFile(join(dir, "in"), join(dir, "enc"), [{ pem: keys.publicKey }]);
      const bytes = readFileSync(join(dir, "enc"));
      bytes[bytes.length - 100] = bytes[bytes.length - 100]! ^ 0xff;
      writeFileSync(join(dir, "bad"), bytes);
      await expect(decryptFile(join(dir, "bad"), join(dir, "out"), keys.privateKey)).rejects.toThrow();
      await expect(encryptFile(join(dir, "in"), join(dir, "none"), [])).rejects.toThrow(/recipient/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("retention", () => {
  const days = (n: number) => Array.from({ length: n }, (_, i) => dailyKey(`2026-10-${String(i + 1).padStart(2, "0")}`));
  it("keeps the newest 14 dailies and 6 monthlies, and removes a pruned dump's manifest with it", () => {
    const daily = days(20), monthly = Array.from({ length: 8 }, (_, i) => monthlyKey(`2026-0${i + 1}`));
    const all = [...daily, ...monthly, ...[...daily, ...monthly].map(manifestKeyFor)];
    const doomed = retentionDeletes(all);
    expect(doomed.filter((key) => key.startsWith("daily/") && key.endsWith(".dump.enc"))).toEqual(daily.slice(0, 6).reverse());
    expect(doomed).toContain(manifestKeyFor(daily[0]));
    expect(doomed.filter((key) => key.startsWith("monthly/") && key.endsWith(".dump.enc"))).toEqual([monthlyKey("2026-02"), monthlyKey("2026-01")]);
    expect(doomed).not.toContain(daily[19]);
    expect(retentionDeletes(days(10))).toEqual([]);
  });
});

describe("restore-test comparison and database settings", () => {
  const counts = Object.fromEntries(COUNTED_TABLES.map((t: string) => [t, 1000]));
  it("allows the small drift of a live database and flags a missing or short table", () => {
    const manifest = { countsBefore: counts, countsAfter: { ...counts, Member: 1004 } };
    expect(compareCounts(manifest, { ...counts, Member: 1002 })).toEqual([]);
    expect(compareCounts(manifest, { ...counts, DungeonRun: 400 })[0]).toMatch(/DungeonRun: restored 400/);
    const rest: Record<string, number> = { ...counts };
    delete rest["Guild"];
    expect(compareCounts(manifest, rest)[0]).toMatch(/Guild: missing/);
  });

  it("turns a Prisma URL into libpq variables without leaking the password into arguments or keeping Prisma-only parameters", () => {
    expect(pgEnvFromUrl("postgresql://bot:s%40crt@10.0.0.5:5432/guilded?connection_limit=5&sslmode=require")).toEqual({
      PGHOST: "10.0.0.5", PGPORT: "5432", PGUSER: "bot", PGPASSWORD: "s@crt", PGDATABASE: "guilded", PGSSLMODE: "require"
    });
  });
});

describe("the R2 client", () => {
  it("signs the same request the same way and changes the signature with the secret", () => {
    const base = { method: "GET", host: "example.r2.cloudflarestorage.com", canonicalPath: "/bucket/daily/a.enc", payloadHash: "UNSIGNED-PAYLOAD", accessKeyId: "AK", now: new Date("2026-11-23T03:00:00Z") };
    const one = signRequest({ ...base, secretAccessKey: "one" }), again = signRequest({ ...base, secretAccessKey: "one" }), two = signRequest({ ...base, secretAccessKey: "two" });
    expect(one.authorization).toBe(again.authorization);
    expect(one.authorization).not.toBe(two.authorization);
    expect(one.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AK\/20261123\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
  });

  it("uploads, lists, copies, downloads and deletes against an S3-style server", async () => {
    const objects = new Map<string, Buffer>();
    const server = createServer((req, res) => {
      expect(req.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 /);
      const url = new URL(req.url!, "http://x");
      const key = decodeURIComponent(url.pathname.replace(/^\/bucket\/?/, ""));
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        if (req.method === "PUT" && req.headers["x-amz-copy-source"]) { objects.set(key, objects.get(decodeURIComponent(String(req.headers["x-amz-copy-source"]).replace(/^\/bucket\//, "")))!); res.end(); }
        else if (req.method === "PUT") { objects.set(key, Buffer.concat(chunks)); res.end(); }
        else if (req.method === "DELETE") { objects.delete(key); res.statusCode = 204; res.end(); }
        else if (req.method === "HEAD") { res.statusCode = objects.has(key) ? 200 : 404; res.end(); }
        else if (!key) { const prefix = url.searchParams.get("prefix") ?? ""; res.end(`<ListBucketResult><IsTruncated>false</IsTruncated>${[...objects.keys()].filter((k) => k.startsWith(prefix)).map((k) => `<Contents><Key>${k}</Key></Contents>`).join("")}</ListBucketResult>`); }
        else if (objects.has(key)) res.end(objects.get(key));
        else { res.statusCode = 404; res.end("NoSuchKey"); }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const dir = scratch();
    try {
      const { port } = server.address() as { port: number };
      const r2 = new ObjectStore({ endpoint: `http://127.0.0.1:${port}`, bucket: "bucket", accessKeyId: "AK", secretAccessKey: "SK" });
      writeFileSync(join(dir, "up"), "encrypted bytes");
      await r2.putFile("daily/guilded-2026-11-23.dump.enc", join(dir, "up"));
      await r2.putText("daily/guilded-2026-11-23.manifest.json", "{}");
      await r2.copy("daily/guilded-2026-11-23.dump.enc", "monthly/guilded-2026-11.dump.enc");
      expect(await r2.list("")).toEqual(["daily/guilded-2026-11-23.dump.enc", "daily/guilded-2026-11-23.manifest.json", "monthly/guilded-2026-11.dump.enc"]);
      expect(await r2.exists("monthly/guilded-2026-11.dump.enc")).toBe(true);
      expect(await r2.exists("monthly/guilded-2026-12.dump.enc")).toBe(false);
      await r2.getFile("monthly/guilded-2026-11.dump.enc", join(dir, "down"));
      expect(readFileSync(join(dir, "down"), "utf8")).toBe("encrypted bytes");
      await r2.delete("daily/guilded-2026-11-23.manifest.json");
      expect(await r2.list("daily/")).toEqual(["daily/guilded-2026-11-23.dump.enc"]);
      await expect(r2.getText("missing")).rejects.toThrow(/HTTP 404/);
      expect(() => new ObjectStore({ endpoint: "", bucket: "b", accessKeyId: "a", secretAccessKey: "s" })).toThrow();
    } finally { server.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
