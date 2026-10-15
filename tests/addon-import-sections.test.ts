import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAddonImportService, forgetAppliedSections } from "../src/services/addon-import.js";

beforeEach(() => forgetAppliedSections());

type Row = Record<string, unknown>;

// A transaction client: the models these tests look at are spies, every other model answers
// "nothing here" so the rest of apply() runs as for an empty upload.
function fakeDatabase(options: { characters?: { id: string; name: string; realm: string; memberId: string }[]; failUpdate?: () => boolean } = {}) {
  const characters = options.characters ?? [{ id: "c1", name: "Kevin", realm: "R", memberId: "m1" }];
  const imports = new Map<string, { id: string; status: string; payload: unknown; createdBy: string; pairedMemberId: string | null }>();
  const spies = {
    snapshotCreate: vi.fn(async ({ data }: { data: Row }) => ({ id: `s${Math.random()}`, ...data })),
    touch: vi.fn(async () => ({ count: 1 })),
    createMany: vi.fn(async ({ data }: { data: Row[] }) => data.map((row, i) => ({ id: `e${i}`, ...row }))),
    create: vi.fn(async ({ data }: { data: Row }) => data)
  };
  const known: Record<string, unknown> = {
    $executeRaw: async () => 0,
    guildSettings: { findUnique: async () => null },
    addonImport: {
      findFirst: async ({ where }: { where: { id: string } }) => imports.get(where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: { status: string } }) => {
        if (options.failUpdate?.()) throw new Error("database went away");
        return Object.assign(imports.get(where.id)!, data);
      }
    },
    character: {
      findMany: async () => characters.map((character) => ({ ...character, member: { id: character.memberId } })),
      findUnique: async () => ({ professionsUpdatedAt: null }),
      updateMany: spies.touch
    },
    inspectedCharacterSnapshot: { findMany: async () => [], create: spies.snapshotCreate },
    epgpTransaction: { findMany: async () => [], createManyAndReturn: spies.createMany, create: spies.create }
  };
  const fallback = () => ({
    findMany: async () => [], findFirst: async () => null, findUnique: async () => null,
    create: async ({ data }: { data: Row }) => data, upsert: async ({ create }: { create: Row }) => create,
    update: async ({ data }: { data: Row }) => data, updateMany: async () => ({ count: 0 }), deleteMany: async () => ({ count: 0 }),
    createMany: async () => ({ count: 0 }), count: async () => 0, groupBy: async () => []
  });
  const tx = new Proxy(known, { get: (target, key: string) => key in target ? target[key] : fallback() });
  const database = { $transaction: async (work: (client: unknown) => Promise<unknown>) => work(tx) };
  const add = (id: string, payload: Row, by = "officer") => imports.set(id, { id, status: "PREVIEWED", createdBy: by, pairedMemberId: null, payload: { source: "Guilded", exportedAt: "2026-10-01T00:00:00Z", ...payload } });
  return { service: createAddonImportService(database as never), spies, add, characters };
}

const digest = (inspectedAt: string) => ({ character: "Kevin", realm: "R", inspectedAt, professions: [], findings: [], items: [], consumables: [] });
const entry = (ref: string) => ({ character: "Kevin", realm: "R", epAmount: 10, gpAmount: 0, type: "EP_AWARD", reason: "Raid attendance", sourceRef: ref });

describe("addon import apply: batched writes and unchanged sections", () => {
  it("writes all new ledger entries in one insert", async () => {
    const db = fakeDatabase();
    db.add("i1", { epgpTransactions: [entry("qg:a"), entry("qg:b"), entry("qg:c")] });
    const result = await db.service.apply("g", "i1", "officer");
    expect(result.epgpTransactions).toHaveLength(3);
    expect(db.spies.createMany).toHaveBeenCalledTimes(1);
    expect(db.spies.create).not.toHaveBeenCalled();
  });

  it("skips a gear digest it applied already, and applies it again when a character is linked", async () => {
    const db = fakeDatabase();
    db.add("i1", { readiness: [digest("2026-10-01T10:00:00Z")], epgpTransactions: [entry("qg:a")] });
    db.add("i2", { readiness: [digest("2026-10-01T10:00:00Z")], epgpTransactions: [entry("qg:a"), entry("qg:b")] });
    const first = await db.service.apply("g", "i1", "officer");
    expect(first.readinessSnapshots).toHaveLength(1);
    const second = await db.service.apply("g", "i2", "officer");
    expect(second.unchangedSections).toEqual(expect.arrayContaining(["readiness", "attunements", "recipes", "characters"]));
    expect(second.readinessSnapshots).toHaveLength(0);
    expect(db.spies.touch).toHaveBeenCalledTimes(1);
    // The ledger is never skipped.
    expect(second.epgpTransactions).toHaveLength(2);

    db.characters.push({ id: "c2", name: "Alt", realm: "R", memberId: "m1" });
    db.add("i3", { readiness: [digest("2026-10-01T10:00:00Z")] });
    const third = await db.service.apply("g", "i3", "officer");
    expect(third.unchangedSections).not.toContain("readiness");
    expect(db.spies.touch).toHaveBeenCalledTimes(2);
  });

  it("does not remember a section from an import that was rolled back", async () => {
    let fail = true;
    const db = fakeDatabase({ failUpdate: () => fail });
    db.add("i1", { readiness: [digest("2026-10-01T10:00:00Z")] });
    await expect(db.service.apply("g", "i1", "officer")).rejects.toThrow("database went away");
    fail = false;
    db.add("i2", { readiness: [digest("2026-10-01T10:00:00Z")] });
    const result = await db.service.apply("g", "i2", "officer");
    expect(result.unchangedSections).not.toContain("readiness");
    expect(result.readinessSnapshots).toHaveLength(1);
  });

  it("keeps each uploader's sections apart", async () => {
    const db = fakeDatabase();
    db.add("i1", { readiness: [digest("2026-10-01T10:00:00Z")] }, "officer-a");
    db.add("i2", { readiness: [digest("2026-10-01T10:00:00Z")] }, "officer-b");
    await db.service.apply("g", "i1", "officer-a");
    const other = await db.service.apply("g", "i2", "officer-b");
    expect(other.unchangedSections).not.toContain("readiness");
  });
});
