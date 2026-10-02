import { describe, expect, it, vi } from "vitest";
import { createAddonImportService } from "../src/services/addon-import.js";
import { createEpgpService } from "../src/services/epgp.js";
import { heldNotice } from "../src/services/import-followup.js";
import { RETENTION, runRetention } from "../src/services/retention.js";
import { ledgerRefsFor, shouldTellApplyFailure } from "../src/companion-api.js";
import { lootRulesForAddon } from "../src/services/loot-rules-export.js";
import { standingsToLua } from "../companion/standings-format.mjs";
import { withTransactionMock } from "./helpers/transaction.js";

// The October 2026 audit: an import no longer fails as a whole because of one row.

type Row = Record<string, unknown>;
interface EpgpRow { id: string; guildId: string; memberId: string; sourceRef: string | null; epAmount: number; gpAmount: number; coreId: string | null; type: string; reason: string }

function importDatabase(options: { coreLootOnly?: boolean; characters?: string[]; cores?: string[] } = {}) {
  const epgp: EpgpRow[] = [];
  const held: (Row & { id: string; kind: string; sourceRef: string; dismissedAt: Date | null })[] = [];
  const loot: Row[] = [];
  const characters = (options.characters ?? ["Kevin"]).map((name) => ({ id: `char-${name}`, name, realm: "R", memberId: `member-${name}` }));
  const imports = new Map<string, { id: string; status: string; payload: unknown }>();
  const inList = (value: string | null, filter: unknown) => !!value && (filter as { in: string[] }).in.includes(value);
  const tx = {
    $executeRaw: async () => 0,
    guildSettings: { findUnique: async () => ({ dataResetAt: null, coreLootOnly: options.coreLootOnly ?? false }) },
    addonImport: {
      findFirst: async ({ where }: { where: { id: string } }) => imports.get(where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: { status: string } }) => Object.assign(imports.get(where.id)!, data)
    },
    character: { findMany: async () => characters },
    raidCore: { findMany: async () => (options.cores ?? []).map((id) => ({ id })) },
    dkpTransaction: { findMany: async () => [] },
    epgpTransaction: {
      findMany: async ({ where }: { where: { sourceRef: unknown } }) => epgp.filter((row) => inList(row.sourceRef, where.sourceRef)),
      create: async ({ data }: { data: Omit<EpgpRow, "id"> }) => { const row = { ...data, id: `tx-${epgp.length + 1}` }; epgp.push(row); return row; }
    },
    lootAward: {
      findMany: async () => [],
      create: async ({ data }: { data: Row }) => { loot.push(data); return { id: `award-${loot.length}` }; }
    },
    raid: { findMany: async () => [], findFirst: async () => null },
    addonHeldEntry: {
      findMany: async () => held,
      upsert: async ({ where, create, update }: { where: { guildId_kind_sourceRef: { kind: string; sourceRef: string } }; create: Row; update: Row }) => {
        const key = where.guildId_kind_sourceRef;
        const existing = held.find((row) => row.kind === key.kind && row.sourceRef === key.sourceRef);
        if (existing) Object.assign(existing, update);
        else held.push({ id: `held-${held.length + 1}`, dismissedAt: null, ...create } as never);
      },
      deleteMany: async ({ where }: { where: { sourceRef: { in: string[] } } }) => {
        for (const ref of where.sourceRef.in) {
          const index = held.findIndex((row) => row.sourceRef === ref && !row.dismissedAt);
          if (index >= 0) held.splice(index, 1);
        }
      }
    }
  };
  const database = { $transaction: async (work: (client: typeof tx) => Promise<unknown>) => work(tx) };
  const add = (id: string, payload: Row) => imports.set(id, { id, status: "PREVIEWED", payload: { source: "Guilded", exportedAt: "2026-10-01T00:00:00Z", ...payload } });
  return { service: createAddonImportService(database as never), epgp, held, loot, characters, imports, add };
}

const entry = (ref: string, character: string, extra: Row = {}) =>
  ({ character, realm: "R", epAmount: 10, gpAmount: 0, type: "EP_AWARD", reason: "Raid attendance", sourceRef: ref, ...extra });

describe("an addon import holds what it cannot place and imports the rest", () => {
  it("holds an unlinked character's entry, then imports it once the character is linked", async () => {
    const db = importDatabase();
    db.add("i1", { epgpTransactions: [entry("qg:a", "Kevin"), entry("qg:b", "Pug")] });
    const first = await db.service.apply("g", "i1", "officer");
    expect(first.epgpTransactions).toHaveLength(1);
    expect(first.held).toMatchObject({ fresh: 1, rows: [{ kind: "EPGP", sourceRef: "addon:qg:b", character: "Pug", reason: "UNLINKED", detail: "+10 EP - Raid attendance" }] });
    expect(db.imports.get("i1")!.status).toBe("APPLIED");
    expect(db.held).toHaveLength(1);

    // The next upload carries the whole ledger again: nothing new is reported, nothing doubles.
    db.add("i2", { epgpTransactions: [entry("qg:a", "Kevin"), entry("qg:b", "Pug")] });
    const second = await db.service.apply("g", "i2", "officer");
    expect(second).toMatchObject({ skipped: 1, held: { fresh: 0 } });
    expect(second.epgpTransactions).toHaveLength(0);

    db.characters.push({ id: "char-Pug", name: "Pug", realm: "R", memberId: "member-Pug" });
    db.add("i3", { epgpTransactions: [entry("qg:a", "Kevin"), entry("qg:b", "Pug")] });
    const third = await db.service.apply("g", "i3", "officer");
    expect(third.epgpTransactions.map((row) => row.sourceRef)).toEqual(["addon:qg:b"]);
    expect(db.held).toHaveLength(0);
    expect(db.epgp.map((row) => row.sourceRef)).toEqual(["addon:qg:a", "addon:qg:b"]);
  });

  it("holds an entry with no core in a core-only guild, and one for a deleted core, without blocking a valid one", async () => {
    const db = importDatabase({ coreLootOnly: true, cores: ["core-a"] });
    db.add("i1", { epgpTransactions: [entry("qg:a", "Kevin", { coreId: "core-a" }), entry("qg:b", "Kevin"), entry("qg:c", "Kevin", { coreId: "gone" })] });
    const result = await db.service.apply("g", "i1", "officer");
    expect(result.epgpTransactions.map((row) => row.sourceRef)).toEqual(["addon:qg:a"]);
    expect(result.held.rows.map((row) => row.reason)).toEqual(["NO_CORE", "UNKNOWN_POOL"]);
  });

  it("holds loot with no core raid in a core-only guild instead of failing", async () => {
    const db = importDatabase({ coreLootOnly: true, cores: ["core-a"] });
    db.add("i1", { epgpTransactions: [entry("qg:a", "Kevin", { coreId: "core-a" })], loot: [{ ref: "qg-loot:1", character: "Kevin", realm: "R", item: "[Helm]", gp: 30 }] });
    const result = await db.service.apply("g", "i1", "officer");
    expect(result.epgpTransactions).toHaveLength(1);
    expect(result.held.rows).toEqual([{ kind: "LOOT", sourceRef: "qg-loot:1", character: "Kevin", reason: "NO_CORE_RAID", detail: "[Helm] (30 GP)" }]);
    expect(db.loot).toHaveLength(0);
  });

  it("never imports a dismissed entry", async () => {
    const db = importDatabase();
    db.held.push({ id: "held-x", kind: "EPGP", sourceRef: "addon:qg:b", dismissedAt: new Date() });
    db.characters.push({ id: "char-Pug", name: "Pug", realm: "R", memberId: "member-Pug" });
    db.add("i1", { epgpTransactions: [entry("qg:b", "Pug")] });
    const result = await db.service.apply("g", "i1", "officer");
    expect(result).toMatchObject({ skipped: 1, held: { rows: [] } });
    expect(db.epgp).toHaveLength(0);
  });

  it("reports malformed rows and still applies the rest", async () => {
    const db = importDatabase();
    db.add("i1", { epgpTransactions: [entry("qg:a", "Kevin"), entry("qg:zero", "Kevin", { epAmount: 0 })] });
    const result = await db.service.apply("g", "i1", "officer");
    expect(result.epgpTransactions).toHaveLength(1);
    expect(result.rejected).toEqual([expect.objectContaining({ section: "epgpTransactions", label: "Kevin" })]);
  });
});

describe("entries voided in game", () => {
  it("never imports one Discord did not have, and reverses one it had, once", async () => {
    const db = importDatabase();
    db.add("i1", { epgpTransactions: [entry("qg:a", "Kevin", { gpAmount: 30, epAmount: 0, type: "GP_AWARD", reason: "Wrong player" })] });
    await db.service.apply("g", "i1", "officer");
    db.add("i2", { epgpTransactions: [
      entry("qg:a", "Kevin", { gpAmount: 30, epAmount: 0, type: "GP_AWARD", reason: "Wrong player", voided: true }),
      entry("qg:never", "Kevin", { voided: true })
    ] });
    const second = await db.service.apply("g", "i2", "officer");
    expect(second).toMatchObject({ voided: 1, held: { rows: [] } });
    expect(db.epgp.map((row) => [row.sourceRef, row.gpAmount, row.type])).toEqual([["addon:qg:a", 30, "GP_AWARD"], ["reversal:tx-1", -30, "REVERSAL"]]);
    db.add("i3", { exportedAt: "2026-10-02T00:00:00Z", epgpTransactions: [entry("qg:a", "Kevin", { gpAmount: 30, epAmount: 0, type: "GP_AWARD", reason: "Wrong player", voided: true })] });
    expect((await db.service.apply("g", "i3", "officer")).voided).toBe(0);
    expect(db.epgp).toHaveLength(2);
  });
});

describe("the officer notice for held entries", () => {
  const rows = [
    { kind: "EPGP" as const, sourceRef: "a", character: "Pug", reason: "UNLINKED" as const, detail: "" },
    { kind: "EPGP" as const, sourceRef: "b", character: "Kevin", reason: "NO_CORE" as const, detail: "" },
    { kind: "LOOT" as const, sourceRef: "c", character: "Kevin", reason: "NO_CORE_RAID" as const, detail: "" }
  ];
  it("says how many, why, and what to do, in both languages", () => {
    const en = heldNotice(rows, "en");
    expect(en).toContain("Addon entries on hold** (3)");
    expect(en).toContain("1 for a character nobody linked (Pug)");
    expect(en).toContain("/guilded void");
    expect(en).toContain("/import held");
    expect(heldNotice(rows, "fr")).toContain("Entrées de l'addon en attente** (3)");
  });
  it("tells officers about the same failed import once an hour, not on every upload", () => {
    expect(shouldTellApplyFailure("g:boom", 1_000)).toBe(true);
    expect(shouldTellApplyFailure("g:boom", 60_000)).toBe(false);
    expect(shouldTellApplyFailure("g:other", 60_000)).toBe(true);
    expect(shouldTellApplyFailure("g:boom", 1_000 + 61 * 60_000)).toBe(true);
  });
});

describe("decay", () => {
  function decayDatabase(sums: { memberId: string; ep: number; gp: number }[], failOnCreate = false) {
    const created: Row[] = [];
    const database = withTransactionMock({
      guildSettings: { findUnique: async () => null },
      raidCore: { findFirst: async () => null },
      member: { findMany: async () => [{ id: "m1" }, { id: "m2" }, { id: "m3" }] },
      epgpTransaction: {
        groupBy: async () => sums.map((row) => ({ memberId: row.memberId, _sum: { epAmount: row.ep, gpAmount: row.gp } })),
        createManyAndReturn: vi.fn(async ({ data }: { data: Row[] }) => { if (failOnCreate) throw new Error("database down"); created.push(...data); return data; })
      }
    });
    return { database, created };
  }

  it("writes every member's decay in one statement, with a clean percent in the reason", async () => {
    const { database, created } = decayDatabase([{ memberId: "m1", ep: 1000, gp: 100 }, { memberId: "m2", ep: 5, gp: 0 }]);
    const rows = await createEpgpService(database as never).applyDecay("g", 0.07, "officer");
    expect(rows).toHaveLength(1); // m2: 7% of 5 rounds to nothing, m3 has no points
    expect(created).toEqual([expect.objectContaining({ memberId: "m1", epAmount: -70, gpAmount: -7, reason: "EPGP decay (7%)", sourceRef: null, coreId: null })]);
    expect(database.epgpTransaction.createManyAndReturn).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
  });

  it("gives the automatic decay a reference per member and week, so a retry cannot decay twice", async () => {
    const { database, created } = decayDatabase([{ memberId: "m1", ep: 100, gp: 10 }]);
    await createEpgpService(database as never).applyDecay("g", 0.1, "auto-decay", null, "decay:guild:2026-10-06");
    expect(created[0]).toMatchObject({ sourceRef: "decay:guild:2026-10-06:m1", epAmount: -10, gpAmount: -1 });
  });

  it("decays nobody when the write fails", async () => {
    const { database, created } = decayDatabase([{ memberId: "m1", ep: 100, gp: 10 }], true);
    await expect(createEpgpService(database as never).applyDecay("g", 0.1, "officer")).rejects.toThrow("database down");
    expect(created).toEqual([]);
  });
});

describe("retention", () => {
  it("removes old uploads, repeated gear checks and old error reports only", async () => {
    const now = new Date("2026-12-01T00:00:00Z");
    const addonImport = { deleteMany: vi.fn<(query: { where: { OR: Row[] } }) => Promise<{ count: number }>>(async () => ({ count: 4 })) };
    const errorReport = { deleteMany: vi.fn(async () => ({ count: 2 })) };
    const $executeRaw = vi.fn(async () => 7);
    expect(await runRetention({ addonImport, errorReport, $executeRaw } as never, now)).toEqual({ imports: 4, snapshots: 7, errors: 2 });
    const where = addonImport.deleteMany.mock.calls[0]![0].where;
    expect(where.OR[0]).toEqual({ status: "APPLIED", createdAt: { lt: new Date(now.getTime() - RETENTION.appliedImportDays * 86_400_000) } });
    expect(where.OR[1]).toMatchObject({ status: { not: "APPLIED" } });
    // The newest gear check of a character is never deleted.
    expect(String(($executeRaw.mock.calls[0] as unknown[])[0])).toContain("newer");
  });
});

describe("ledger references sent to the addon", () => {
  it("asks only for the requester's own entries and recent ones, and marks reversed entries", async () => {
    const findMany = vi.fn()
      .mockResolvedValueOnce([{ sourceRef: "addon:qg:Kev-1-1" }, { sourceRef: "addon:qg:Ann-1-2" }])
      .mockResolvedValueOnce([{ sourceRef: "reversal:tx-9" }])
      .mockResolvedValueOnce([{ sourceRef: "addon:qg:Kev-1-1" }]);
    const database = { character: { findMany: async () => [{ name: "Kev" }] }, epgpTransaction: { findMany } };
    expect(await ledgerRefsFor(database as never, "g", "member-1", new Date("2026-10-31T00:00:00Z")))
      .toEqual(["addon:qg:Kev-1-1", "addon:qg:Ann-1-2", "void:addon:qg:Kev-1-1"]);
    const where = findMany.mock.calls[0]![0].where;
    expect(where.OR).toEqual([
      { sourceRef: { startsWith: "addon:" }, createdAt: { gte: new Date("2026-10-01T00:00:00Z") } },
      { sourceRef: { startsWith: "addon:qg:Kev-" } }
    ]);
    expect(findMany.mock.calls[0]![0].take).toBe(5000);
  });
});

describe("the core-only flag reaches the addon", () => {
  it("is exported with the loot rules and written into Standings.lua", async () => {
    const database = {
      guildSettings: { findUnique: async () => ({ coreLootOnly: true, lootMode: "EPGP", minimumBid: 10 }) },
      raidCore: { findMany: async () => [] },
      coreItemValue: { findMany: async () => [] }
    };
    const loot = await lootRulesForAddon(database as never, "g", async () => []);
    expect(loot.coreOnly).toBe(true);
    const lua = standingsToLua({ updatedAt: "2026-10-01T00:00:00Z", standings: [], loot });
    expect(lua).toContain("coreOnly = true,");
  });
});
