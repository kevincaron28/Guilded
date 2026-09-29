import { describe, expect, it } from "vitest";
import { createAddonImportService } from "../src/services/addon-import.js";

// The addon's export carries the officer's whole ledger every time, so
// applying two exports must not import the same ledger entry twice.
function fakeDatabase() {
  const epgpRows: { sourceRef: string | null; epAmount: number }[] = [];
  const imports = new Map<string, { id: string; status: string; payload: unknown }>();
  const payload = (refs: string[]) => ({
    source: "Guilded",
    exportedAt: "2026-09-24T00:00:00Z",
    epgpTransactions: refs.map((ref) => ({
      character: "Kevin", realm: "Forever", epAmount: 10, gpAmount: 0, type: "EP_AWARD", reason: "Raid attendance", sourceRef: ref
    }))
  });
  imports.set("import-1", { id: "import-1", status: "PREVIEWED", payload: payload(["qg:a"]) });
  imports.set("import-2", { id: "import-2", status: "PREVIEWED", payload: payload(["qg:a", "qg:b"]) });

  const tx = {
    $executeRaw: async () => 0,
    addonImport: {
      findFirst: async ({ where }: { where: { id: string } }) => imports.get(where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: { status: string } }) => {
        const row = imports.get(where.id)!;
        row.status = data.status;
        return row;
      }
    },
    character: {
      findMany: async () => [{ id: "char-1", name: "Kevin", realm: "Forever", memberId: "member-1" }]
    },
    dkpTransaction: { findMany: async () => [] },
    epgpTransaction: {
      findMany: async ({ where }: { where: { sourceRef: { in: string[] } } }) =>
        epgpRows.filter((row) => row.sourceRef && where.sourceRef.in.includes(row.sourceRef)),
      create: async ({ data }: { data: { sourceRef: string; epAmount: number } }) => {
        epgpRows.push({ sourceRef: data.sourceRef, epAmount: data.epAmount });
        return data;
      }
    }
  };
  const database = { $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx) };
  return { database, epgpRows };
}

describe("addon import apply", () => {
  it("skips ledger entries a previous import already applied", async () => {
    const { database, epgpRows } = fakeDatabase();
    const service = createAddonImportService(database as never);

    const first = await service.apply("guild-1", "import-1", "officer");
    expect(first.epgpTransactions).toHaveLength(1);

    const second = await service.apply("guild-1", "import-2", "officer");
    expect(second.epgpTransactions).toHaveLength(1);
    expect(second.skipped).toBe(1);

    expect(epgpRows.map((row) => row.sourceRef)).toEqual(["addon:qg:a", "addon:qg:b"]);
    expect(epgpRows.reduce((total, row) => total + row.epAmount, 0)).toBe(20);
  });
});
