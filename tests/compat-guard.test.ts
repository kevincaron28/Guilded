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
//   - a field an older client sends is never removed from, or made required in, these wire schemas
//     (the schema itself and, one level down, its object and array-of-object members).
// Both are checked against tests/fixtures/compat/wire-shape.json. A deliberate change edits that file's "allow" lists
// (and is a policy decision: see the document), not the test.

const FILE = new URL("./fixtures/compat/wire-shape.json", import.meta.url);

const SCHEMAS: Record<string, ZodType> = {
  addonSnapshot: addonSnapshotSchema as never,
  addonCharacter: addonCharacterSchema as never,
  dungeonRun: dungeonRunSchema as never,
  deviceUpload: deviceUploadSchema as never
};

interface Def { type: string; innerType?: ZodType; element?: ZodType; shape?: Record<string, ZodType> }
const defOf = (field: ZodType): Def => (field as unknown as { _zod: { def: Def } })._zod.def;
const WRAPPERS = ["optional", "default", "prefault", "catch", "nullable", "nonoptional", "readonly"];
function unwrap(field: ZodType): ZodType {
  let current = field;
  while (WRAPPERS.includes(defOf(current).type) && defOf(current).innerType) current = defOf(current).innerType!;
  return current;
}

/** key -> true when a missing value is accepted (optional or defaulted). */
function shapeOf(shape: Record<string, ZodType>): Record<string, boolean> {
  return Object.fromEntries(Object.entries(shape).sort(([a], [b]) => a.localeCompare(b)).map(([key, field]) => [key, field.safeParse(undefined).success]));
}

/** Each schema's own fields and, one level down, the fields of object and array-of-object members ("schema.field" / "schema.field[]"). */
function flatten(schemas: Record<string, ZodType>): Record<string, Record<string, boolean>> {
  const out: Record<string, Record<string, boolean>> = {};
  for (const [name, schema] of Object.entries(schemas)) {
    const top = defOf(unwrap(schema)).shape ?? {};
    out[name] = shapeOf(top);
    for (const [key, field] of Object.entries(top)) {
      const def = defOf(unwrap(field));
      if (def.type === "object" && def.shape) out[`${name}.${key}`] = shapeOf(def.shape);
      else if (def.type === "array" && def.element) {
        const element = defOf(unwrap(def.element));
        if (element.type === "object" && element.shape) out[`${name}.${key}[]`] = shapeOf(element.shape);
      }
    }
  }
  return out;
}

interface Allow { removedFeatures: string[]; removedFields: string[]; nowRequired: string[]; newRequired: string[] }
interface Snapshot { features: string[]; schemas: Record<string, Record<string, boolean>>; allow: Allow }

const current = (): Omit<Snapshot, "allow"> => ({ features: [...COMPANION_FEATURES].sort(), schemas: flatten(SCHEMAS) });

/** What would break an older client, minus what the allow lists name. */
function breakages(saved: Snapshot, now: Omit<Snapshot, "allow">): string[] {
  const problems: string[] = [];
  for (const feature of saved.features) {
    if (!now.features.includes(feature) && !saved.allow.removedFeatures.includes(feature)) problems.push(`feature ${feature} was removed (allow.removedFeatures)`);
  }
  for (const [name, fields] of Object.entries(saved.schemas)) {
    const live = now.schemas[name] ?? {};
    for (const [key, optional] of Object.entries(fields)) {
      const id = `${name}.${key}`;
      if (!(key in live)) { if (!saved.allow.removedFields.includes(id)) problems.push(`${id} was removed (allow.removedFields)`); continue; }
      if (optional && !live[key] && !saved.allow.nowRequired.includes(id)) problems.push(`${id} is now required, older clients omit it (allow.nowRequired)`);
    }
    for (const [key, optional] of Object.entries(live)) {
      const id = `${name}.${key}`;
      if (!(key in fields) && !optional && !saved.allow.newRequired.includes(id)) problems.push(`${id} is new and required, older clients never send it (allow.newRequired)`);
    }
  }
  return problems;
}

// COMPAT_WRITE=1 refreshes the baseline but never silently accepts a breakage: list it in "allow" first.
if (process.env["COMPAT_WRITE"] === "1") {
  const previous: Snapshot | null = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : null;
  const next = current();
  const refused = previous ? breakages(previous, next) : [];
  if (refused.length) throw new Error(`Refusing to rewrite wire-shape.json: these changes break older clients and are not in its "allow" lists:\n  ${refused.join("\n  ")}`);
  writeFileSync(FILE, JSON.stringify({ ...next, allow: previous?.allow ?? { removedFeatures: [], removedFields: [], nowRequired: [], newRequired: [] } }, null, 2) + "\n");
}

describe("compatibility guard", () => {
  const saved: Snapshot = JSON.parse(readFileSync(FILE, "utf8"));
  const now = current();

  it("never removes a feature or field, or makes one required, without an allowlist edit", () => {
    expect(breakages(saved, now), "an older addon or companion would break").toEqual([]);
  });

  it("looks one level into characters, runs and players", () => {
    expect(Object.keys(now.schemas)).toEqual(expect.arrayContaining(["addonSnapshot.characters[]", "dungeonRun.players[]", "deviceUpload.characters[]"]));
  });

  it("catches a removed, newly required and newly required-and-new field", () => {
    const base = { features: ["a"], schemas: { s: { x: true, y: true } }, allow: { removedFeatures: [], removedFields: [], nowRequired: [], newRequired: [] } };
    expect(breakages(base, { features: [], schemas: { s: { x: false, z: false } } }).length).toBe(4);
  });

  it("keeps the protocol range consistent", () => {
    expect(MIN_PROTOCOL).toBeLessThanOrEqual(PROTOCOL_VERSION);
    expect(MIN_COMPANION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
