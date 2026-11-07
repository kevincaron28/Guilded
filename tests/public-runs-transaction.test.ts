import { describe, expect, it } from "vitest";
import { PUBLIC_RUN_TX, prismaPublicRunStore } from "../src/services/public-runs.js";

// Saved error V2HP78CX: the upload transactions hit Prisma's 5 s default under load (P2028).
describe("public run upload transactions", () => {
  it("run with a budget well above Prisma's 5 s default, for new runs and for added reports", async () => {
    const seen: unknown[] = [];
    const database = { $transaction: async (_work: unknown, options: unknown) => { seen.push(options); return { agree: true, duplicate: false }; } };
    const store = prismaPublicRunStore(database as never);
    await store.createRun({} as never, { key: "k", reporters: [] }, "personal");
    await store.addUpload("run", { key: "k", reporters: [] }, {} as never);
    expect(seen).toEqual([PUBLIC_RUN_TX, PUBLIC_RUN_TX]);
    expect(PUBLIC_RUN_TX.timeout).toBeGreaterThanOrEqual(30_000);
    expect(PUBLIC_RUN_TX.maxWait).toBeGreaterThanOrEqual(10_000);
  });
});
