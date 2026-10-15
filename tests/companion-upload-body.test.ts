import { describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import type { IncomingMessage } from "node:http";
import { BodyTooLargeError, readBody } from "../src/companion-api.js";

function request(body: Buffer | string, headers: Record<string, string> = {}): IncomingMessage {
  const stream = Readable.from([typeof body === "string" ? Buffer.from(body) : body]) as unknown as IncomingMessage;
  (stream as { headers: Record<string, string> }).headers = headers;
  return stream;
}

describe("companion upload bodies", () => {
  const payload = { guildDiscordId: "1", export: { source: "Guilded", rows: Array.from({ length: 2000 }, (_, i) => ({ i, reason: "Raid attendance" })) } };

  it("reads plain JSON as before", async () => {
    expect(await readBody(request(JSON.stringify(payload)))).toEqual(payload);
  });

  it("reads a gzip upload, with the header or (behind a proxy that drops it) without", async () => {
    const packed = gzipSync(JSON.stringify(payload));
    expect(packed.byteLength).toBeLessThan(JSON.stringify(payload).length / 5);
    expect(await readBody(request(packed, { "content-encoding": "gzip" }))).toEqual(payload);
    expect(await readBody(request(packed))).toEqual(payload);
  });

  it("refuses uploads over the limits, before or after unpacking", async () => {
    await expect(readBody(request("x".repeat(1_000_001)))).rejects.toBeInstanceOf(BodyTooLargeError);
    // 9 MB of spaces packs into a few kilobytes but unpacks past the 8 MB cap.
    const bomb = gzipSync(`{"a":"${" ".repeat(9_000_000)}"}`);
    expect(bomb.byteLength).toBeLessThan(1_000_000);
    await expect(readBody(request(bomb, { "content-encoding": "gzip" }))).rejects.toBeInstanceOf(BodyTooLargeError);
  });

  it("refuses unreadable compressed data and unknown encodings as bad requests", async () => {
    await expect(readBody(request(Buffer.from([0x1f, 0x8b, 1, 2, 3]), { "content-encoding": "gzip" }))).rejects.toBeInstanceOf(SyntaxError);
    await expect(readBody(request("{}", { "content-encoding": "br" }))).rejects.toBeInstanceOf(SyntaxError);
  });
});
