import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { createErrorReportService, resetErrorNotifications } from "../src/services/error-report.js";

describe("database outage reports", () => {
  it("saves one report for a burst of connection failures from different jobs", async () => {
    resetErrorNotifications();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const save = vi.fn(async () => ({ id: "abcdefgh12345678" }));
    const service = createErrorReportService({ errorReport: { create: save } } as unknown as PrismaClient);
    const outage = () => new Error("timeout exceeded when trying to connect");
    expect(await service.report(null, outage(), { source: "PUG board sweep" })).not.toBeNull();
    expect(await service.report(null, outage(), { source: "Poll expiry" })).toBeNull();
    expect(await service.report(null, outage(), { source: "Answer channel" })).toBeNull();
    expect(save).toHaveBeenCalledTimes(1);
    // A real bug is still saved.
    expect(await service.report(null, new TypeError("x".repeat(300)), { source: "Poll expiry" })).not.toBeNull();
    expect(save).toHaveBeenCalledTimes(2);
  });
});
