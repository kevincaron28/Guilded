import type { PrismaClient } from "../src/generated/prisma/client.js";
import { describe, expect, it, vi } from "vitest";
import { loadInbox, renderInbox, resolveReports } from "../src/services/bug-inbox.js";
import { reportRef } from "../src/services/error-report.js";
import { encodeReportOrigin } from "../src/services/report-context.js";

const at = (minute: number) => new Date(Date.UTC(2026, 9, 16, 12, minute));
const row = (id: string, source: string, message: string, minute: number, extra: Record<string, unknown> = {}) =>
  ({ id, source, guildId: "111", userId: "222", message, stack: null, context: null, version: "6.2.1", createdAt: at(minute), ...extra });

function fakeDatabase(rows: ReturnType<typeof row>[]) {
  return {
    errorReport: {
      findMany: vi.fn(async ({ where, take }: { where: { source: string | { not: string } }; take: number }) =>
        rows.filter((r) => typeof where.source === "string" ? r.source === where.source : r.source !== where.source.not)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id)).slice(0, take)),
      findFirst: vi.fn(async ({ where }: { where: { id: { endsWith: string } } }) => rows.find((r) => r.id.endsWith(where.id.endsWith)) ?? null),
      updateMany: vi.fn(async () => ({ count: 2 }))
    },
    guild: { findMany: vi.fn(async () => [{ discordId: "111", name: "Quebec Gold" }]) }
  } as unknown as PrismaClient;
}

describe("bug inbox", () => {
  it("gives every report a short reference", () => {
    expect(reportRef("cm2abcdefgh12345678")).toBe("12345678");
  });

  it("lists member reports and groups repeated bot errors by cause, most frequent first", async () => {
    const database = fakeDatabase([
      row("cxxxxxxxbugaaaa1", "bug-report", "Signup button does nothing", 50, { context: "https://cdn.example/shot.png" }),
      row("cxxxxxxxerrbbbb2", "job:roster", "Missing Access", 40, { stack: "Error: Missing Access\n at sync" }),
      row("cxxxxxxxerrbbbb3", "job:roster", "Missing Access", 30, { version: "6.2.0", guildId: "999" }),
      row("cxxxxxxxerrcccc4", "command:raid", "Unknown raid", 20)
    ]);
    const inbox = await loadInbox(database, { now: at(59) });
    expect(inbox.bugs).toMatchObject([{ ref: "BUGAAAA1", guild: "Quebec Gold (111)", screenshot: "https://cdn.example/shot.png" }]);
    expect(inbox.errors.map((e) => [e.source, e.count])).toEqual([["job:roster", 2], ["command:raid", 1]]);
    expect(inbox.errors[0]).toMatchObject({ ref: "ERRBBBB2", versions: ["6.2.1", "6.2.0"], guilds: ["Quebec Gold (111)", "unknown server (999)"], first: at(30), last: at(40) });
    const markdown = renderInbox(inbox);
    expect(markdown).toContain("### BUGAAAA1");
    expect(markdown).toContain("> Signup button does nothing");
    expect(markdown).toContain("### ERRBBBB2 · job:roster · 2×");
    expect(markdown).toContain("Error: Missing Access");
  });

  it("keeps player reports visible during an automatic-error flood and discloses incomplete counts", async () => {
    const database = fakeDatabase([
      ...Array.from({ length: 1_100 }, (_, i) => row(
        `error${String(i).padStart(8, "0")}`, "job:roster", "Repeated failure", 40)),
      row("cxxxxxxxbugaaaa1", "bug-report", "Player cannot sync", 1)
    ]);
    const inbox = await loadInbox(database, { now: at(59) });
    expect(inbox.bugs.map((bug) => bug.ref)).toEqual(["BUGAAAA1"]);
    expect(inbox.errors[0]?.count).toBe(1_000);
    expect(inbox.truncated).toEqual({ bugs: false, errors: true });
    expect(renderInbox(inbox)).toContain("displayed counts and first-seen times cover this sample only");
    expect(renderInbox(inbox)).toContain("Player cannot sync");
  });

  it("warns about omitted player reports without a false warning at the exact limit", async () => {
    const rows = Array.from({ length: 1_001 }, (_, i) => row(
      `member${String(i).padStart(8, "0")}`, "bug-report", "Player issue", 40));
    const limited = await loadInbox(fakeDatabase(rows), { now: at(59) });
    expect(limited.bugs).toHaveLength(1_000);
    expect(limited.truncated).toEqual({ bugs: true, errors: false });
    expect(renderInbox(limited)).toContain("Older member reports are omitted");
    const exact = await loadInbox(fakeDatabase(rows.slice(0, 1_000)), { now: at(59) });
    expect(exact.truncated).toEqual({ bugs: false, errors: false });
    expect(renderInbox(exact)).not.toContain("WARNING");
    const empty = await loadInbox(fakeDatabase([]), { now: at(59) });
    expect(renderInbox(empty)).toContain("None open.");
    expect(renderInbox(empty)).not.toContain("WARNING");
  });

  it("resolves a bug by reference, and an error's whole group by its cause", async () => {
    const database = fakeDatabase([row("cxxxxxxxbugaaaa1", "bug-report", "Broken", 1), row("cxxxxxxxerrbbbb2", "job:roster", "Missing Access", 2)]);
    await resolveReports(database, ["bugaaaa1"], "Fixed in 6.2.1", at(5));
    await resolveReports(database, ["ERRBBBB2"], null, at(5));
    const calls = (database.errorReport.updateMany as unknown as ReturnType<typeof vi.fn>).mock.calls as [{ where: Record<string, unknown>; data: Record<string, unknown> }][];
    expect(calls[0]![0]).toEqual({ where: { id: { endsWith: "bugaaaa1" }, resolvedAt: null }, data: { resolvedAt: at(5), resolution: "Fixed in 6.2.1" } });
    expect(calls[1]![0].where).toEqual({ source: "job:roster", message: { startsWith: "Missing Access" }, resolvedAt: null });
    await expect(resolveReports(database, ["NOPE0000"], null)).rejects.toThrow("No open report NOPE0000");
    await expect(resolveReports(database, ["x'; drop"], null)).rejects.toThrow("Not a report reference");
  });

  it("renders new origin metadata for members and automatic jobs while retaining legacy screenshots", async () => {
    const guildId = "111111111111111111", channelId = "222222222222222222";
    const context = encodeReportOrigin({ channelId, operation: "scheduled-events.reconcile", extra: "https://cdn.example/shot.png" });
    const inbox = await loadInbox(fakeDatabase([
      row("cxxxxxxxbugaaaa1", "bug-report", "Problem", 50, { guildId, context }),
      row("cxxxxxxxerrbbbb2", "Discord scheduled events", "Failure", 40, { guildId, context })
    ]), { now: at(59) });
    expect(inbox.bugs[0]).toMatchObject({ screenshot: "https://cdn.example/shot.png", sourceLink: `https://discord.com/channels/${guildId}/${channelId}` });
    expect(renderInbox(inbox)).toContain(`scheduled-events.reconcile · https://discord.com/channels/${guildId}/${channelId}`);
  });
});
