import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { ZodType } from "zod";
import { addonCharacterSchema, addonSnapshotSchema } from "../src/integrations/addon.js";
import { dungeonRunSchema } from "../src/services/dungeon-rules.js";
import { deviceUploadSchema } from "../src/services/companion-device.js";
import { COMPANION_FEATURES } from "../src/services/standings-feed.js";
import { MIN_COMPANION, MIN_PROTOCOL, PROTOCOL_VERSION } from "../src/compat.js";

// The compatibility guard (docs/COMPAT_POLICY.md). Older addons and companions keep sending what they always sent, so:
//   - a COMPANION_FEATURES entry is never removed (a newer companion may still ask for it),
//   - a field an older client sends is never removed from, or made required in, these wire schemas.
// Both are checked against tests/fixtures/compat/wire-shape.json. A deliberate change edits that file's "allow" lists
// (and is a policy decision: see the document), not the test.

const FILE = new URL("./fixtures/compat/wire-shape.json", import.meta.url);

const SCHEMAS: Record<string, { shape: Record<string, ZodType> }> = {
  addonSnapshot: addonSnapshotSchema as never,
  addonCharacter: addonCharacterSchema as never,
  dungeonRun: dungeonRunSchema as never,
  deviceUpload: deviceUploadSchema as never
};

/** key -> true when a missing value is accepted (optional or defaulted). */
function shapeOf(schema: { shape: Record<string, ZodType> }): Record<string, boolean> {
  return Object.fromEntries(Object.entries(schema.shape).sort(([a], [b]) => a.localeCompare(b)).map(([key, field]) => [key, field.safeParse(undefined).success]));
}

interface Snapshot { features: string[]; schemas: Record<string, Record<string, boolean>>; allow: { removedFeatures: string[]; removedFields: string[]; nowRequired: string[]; newRequired: string[] } }

const current = (): Omit<Snapshot, "allow"> => ({ features: [...COMPANION_FEATURES].sort(), schemas: Object.fromEntries(Object.entries(SCHEMAS).map(([name, schema]) => [name, shapeOf(schema)])) });

if (process.env["COMPAT_WRITE"] === "1") {
  const previous: Snapshot | null = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : null;
  writeFileSync(FILE, JSON.stringify({ ...current(), allow: previous?.allow ?? { removedFeatures: [], removedFields: [], nowRequired: [], newRequired: [] } }, null, 2) + "\n");
}

describe("compatibility guard", () => {
  const saved: Snapshot = JSON.parse(readFileSync(FILE, "utf8"));
  const now = current();

  it("never removes a COMPANION_FEATURES entry without an allowlist edit", () => {
    const removed = saved.features.filter((feature) => !now.features.includes(feature) && !saved.allow.removedFeatures.includes(feature));
    expect(removed, "a feature a deployed companion may still ask for was removed").toEqual([]);
  });

  it("never removes a field or makes one required in the addon and run schemas without an allowlist edit", () => {
    const problems: string[] = [];
    for (const [name, fields] of Object.entries(saved.schemas)) {
      const live = now.schemas[name] ?? {};
      for (const [key, optional] of Object.entries(fields)) {
        const id = `${name}.${key}`;
        if (!(key in live)) { if (!saved.allow.removedFields.includes(id)) problems.push(`${id} was removed`); continue; }
        if (optional && !live[key] && !saved.allow.nowRequired.includes(id)) problems.push(`${id} is now required (older clients omit it)`);
      }
      for (const [key, optional] of Object.entries(live)) {
        const id = `${name}.${key}`;
        if (!(key in fields) && !optional && !saved.allow.newRequired.includes(id)) problems.push(`${id} is new and required (older clients never send it)`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("keeps the protocol range consistent", () => {
    expect(MIN_PROTOCOL).toBeLessThanOrEqual(PROTOCOL_VERSION);
    expect(MIN_COMPANION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
