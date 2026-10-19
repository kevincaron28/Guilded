import type { Client } from "discord.js";
import { MessageFlags } from "discord.js";
import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
vi.mock("../src/config.js", () => ({ config: { ERROR_LOG_CHANNEL_ID: "private-intake" } }));
import { createErrorReportService } from "../src/services/error-report.js";
import { decodeReportOrigin, encodeReportOrigin, interactionReportOrigin, reportSourceLink, ScopedReportError, withReportContext } from "../src/services/report-context.js";

const guild = "111111111111111111", channel = "222222222222222222", message = "333333333333333333";
function fixture() {
  const save = vi.fn(async () => ({ id: "savedreport12345678" }));
  const send = vi.fn<(payload: { content: string; allowedMentions: unknown }) => Promise<void>>(async () => {});
  const client = { channels: { fetch: vi.fn(async () => ({ isTextBased: () => true, send })) } };
  return { save, send, client: client as unknown as Client, service: createErrorReportService({ errorReport: { create: save } } as unknown as PrismaClient) };
}

describe("report source context", () => {
  it("preserves the original failure while carrying a known guild through an outer job catch", async () => {
    const original = new TypeError("Pool timeout");
    let failure: unknown;
    try { await withReportContext({ guildId: guild, operation: "scheduled-events.reconcile" }, async () => { throw original; }); }
    catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(ScopedReportError);
    const s = fixture();
    expect(await s.service.report(s.client, failure, { source: "Discord scheduled events" })).toBe("12345678");
    const stored = (s.save.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(stored).toMatchObject({ guildId: guild, message: original.message, stack: original.stack, version: "6.7.0" });
    expect(decodeReportOrigin(stored["context"] as string)).toMatchObject({ operation: "scheduled-events.reconcile", channelId: null, messageId: null });
    expect(s.send.mock.calls[0]![0].content).toContain(`Source guild: ${guild} · channel: not recorded`);
  });

  it("keeps the most specific origin for a nested job without changing success values", async () => {
    expect(await withReportContext({ guildId: guild }, async () => 42)).toBe(42);
    const original = new Error("Failure");
    let failure: unknown;
    try { await withReportContext({ guildId: guild, operation: "outer" }, () => withReportContext({ channelId: channel, operation: "inner" }, async () => { throw original; })); }
    catch (error) { failure = error; }
    expect(failure).toMatchObject({ original, origin: { guildId: guild, channelId: channel, operation: "inner" } });
  });

  it("stores existing channel/message metadata and posts a usable source link without pings", async () => {
    const s = fixture();
    await s.service.report(s.client, "Submitted description", { source: "bug-report", guildId: guild, channelId: channel, messageId: message, operation: "/report bug", extra: "https://cdn.example/shot.png" });
    const stored = (s.save.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(decodeReportOrigin(stored["context"] as string)).toEqual({ channelId: channel, messageId: message, operation: "/report bug", extra: "https://cdn.example/shot.png" });
    expect(s.send.mock.calls[0]![0]).toMatchObject({ allowedMentions: { parse: [] } });
    expect(s.send.mock.calls[0]![0].content).toContain(`Source message: https://discord.com/channels/${guild}/${channel}/${message}`);
    expect(s.send.mock.calls[0]![0].content).toContain("Ref `12345678` · v6.7.0");
  });

  it("keeps host-wide context unknown instead of assigning the developer inbox as the source", async () => {
    const s = fixture();
    await s.service.report(s.client, new TypeError("Host failure"), { source: "context-test-global" });
    expect(s.send.mock.calls[0]![0].content).toContain("Source guild: unknown · channel: not recorded");
    expect(s.send.mock.calls[0]![0].content).not.toContain("https://discord.com/channels/");
  });

  it("does not suppress an identical automatic failure from another guild", async () => {
    const s = fixture();
    const failure = new TypeError("Same failure");
    await s.service.report(s.client, failure, { source: "context-test-dedupe", guildId: guild });
    await s.service.report(s.client, failure, { source: "context-test-dedupe", guildId: "444444444444444444" });
    await s.service.report(s.client, failure, { source: "context-test-dedupe", guildId: guild });
    expect(s.save).toHaveBeenCalledTimes(3);
    expect(s.send).toHaveBeenCalledTimes(2);
  });

  it("keeps source metadata and a closed code fence when the error is long", async () => {
    const s = fixture();
    await s.service.report(s.client, "x".repeat(4000), { source: "bug-report", guildId: guild, channelId: channel, messageId: message });
    const content = s.send.mock.calls[0]![0].content;
    expect(content.length).toBeLessThanOrEqual(1900);
    expect(content).toContain(`/${channel}/${message}`);
    expect(content.endsWith("\n```")).toBe(true);
  });

  it("never fabricates public message links for slash commands, ephemeral replies or invalid IDs", () => {
    expect(interactionReportOrigin({ channelId: channel })).toEqual({ channelId: channel, messageId: null });
    expect(interactionReportOrigin({ channelId: channel, message: { id: message, flags: { has: flag => flag === MessageFlags.Ephemeral } } }).messageId).toBeNull();
    expect(interactionReportOrigin({ channelId: channel, message: { id: message, flags: { has: () => false } } }).messageId).toBe(message);
    expect(reportSourceLink(guild, { channelId: channel })).toBe(`https://discord.com/channels/${guild}/${channel}`);
    expect(reportSourceLink(guild, { channelId: "invalid/path" })).toBeNull();
  });

  it("reads legacy screenshots and preserves bounded UTF-8 metadata as valid JSON", () => {
    expect(decodeReportOrigin("https://cdn.example/old.png")).toMatchObject({ extra: "https://cdn.example/old.png", operation: null });
    const encoded = encodeReportOrigin({ channelId: channel, operation: "é".repeat(200), extra: "é".repeat(700) });
    expect(JSON.parse(encoded)).toMatchObject({ channelId: channel, operation: "é".repeat(150), extra: "é".repeat(500) });
  });
});
