import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import type { IncomingMessage } from "node:http";
import { parseAddonSnapshot } from "../src/integrations/addon.js";
import { dungeonRunSchema, validateRun } from "../src/services/dungeon-rules.js";
import { deviceUploadSchema } from "../src/services/companion-device.js";
import { readBody } from "../src/companion-api.js";

// Replays what past releases sent against today's schemas (docs/COMPAT_POLICY.md "Adding a compat fixture").
// Each folder in tests/fixtures/compat/<version>/ holds the payloads an addon + companion of that release produced.
const ROOT = new URL("./fixtures/compat/", import.meta.url);
const versions = readdirSync(ROOT, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
const load = (version: string, file: string) => JSON.parse(readFileSync(new URL(`${version}/${file}`, ROOT), "utf8"));
const asRequest = (body: Buffer, headers: Record<string, string> = {}) => Object.assign(Readable.from([body]), { headers }) as unknown as IncomingMessage;
const NOW = new Date("2026-11-20T00:00:00Z");

describe("compat replay: past releases against the current bot", () => {
  it("covers at least the 9.1, 9.2 and 9.3 releases", () => {
    expect(versions).toEqual(expect.arrayContaining(["9.1.3", "9.2.0", "9.3.5"]));
  });

  for (const version of versions) {
    describe(version, () => {
      it("accepts the addon export (signed upload) with nothing lost", () => {
        const body = load(version, "addon-export.json");
        const parsed = parseAddonSnapshot(body.export);
        expect(parsed.rejected).toEqual([]);
        expect(parsed.character?.name).toBe(body.export.character.name);
        expect(parsed.characters).toHaveLength(body.export.characters.length);
        expect(parsed.alts).toHaveLength(body.export.alts.length);
        expect(parsed.transactions).toHaveLength(body.export.transactions.length);
        expect(parsed.loot.map((row) => row.ref)).toEqual(body.export.loot.map((row: { ref: string }) => row.ref));
        expect(parsed.dungeonRuns).toHaveLength(body.export.dungeonRuns.length);
        // Sections added after this release come back empty, never an error.
        for (const added of ["externalDuels", "carriedRecords", "craftOrderRequests", "pvpEvents", "inviteReports"] as const) expect(Array.isArray(parsed[added])).toBe(true);
      });

      it("accepts the dungeon run and keeps its players and timing", () => {
        const run = load(version, "dungeon-run.json");
        const parsed = dungeonRunSchema.parse(run);
        expect(validateRun(parsed, NOW)).toEqual({ ok: true });
        expect(parsed.id).toBe(run.id);
        expect(parsed.players.map((player) => player.character)).toEqual(run.players.map((player: { character: string }) => player.character));
        expect([parsed.startedAt, parsed.endedAt]).toEqual([run.startedAt, run.endedAt]);
      });

      it("accepts the unsigned (zero-setup) device upload with its runs", () => {
        const body = load(version, "device-upload.json");
        const parsed = deviceUploadSchema.parse(body);
        expect(parsed.characters).toHaveLength(body.characters.length);
        expect(parsed.dungeonRuns).toHaveLength(body.dungeonRuns.length);
        for (const run of parsed.dungeonRuns) expect(dungeonRunSchema.safeParse(run).success).toBe(true);
      });

      it("reads the gzip variant of the signed upload, with or without the header", async () => {
        const body = load(version, "addon-export.json");
        const packed = gzipSync(JSON.stringify(body));
        expect(await readBody(asRequest(packed, { "content-encoding": "gzip" }))).toEqual(body);
        expect(await readBody(asRequest(packed))).toEqual(body);
      });
    });
  }
});
