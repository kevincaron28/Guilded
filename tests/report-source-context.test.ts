import type { Client } from "discord.js";
import { MessageFlags } from "discord.js";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
vi.mock("../src/config.js", () => ({ config: { ERROR_LOG_CHANNEL_ID: "private-intake" } }));
vi.mock("../src/services/diagnostic-target.js", () => ({ diagnosticTarget: async (client: Client | null, id: string) => client ? { channel: await client.channels.fetch(id), id, label: "Private intake" } : null }));
import { createErrorReportService } from "../src/services/error-report.js";
import { decodeReportOrigin, encodeReportOrigin, interactionReportOrigin, reportSourceLink, ScopedReportError, withReportContext } from "../src/services/report-context.js";

const guild = "111111111111111111", channel = "222222222222222222", message = "333333333333333333";
const version = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;
function fixture() {
  const save = vi.fn(async () => ({ id: "savedreport12345678" }));
  const send = vi.fn<(payload: { content: string; allowedMentions: unknown }) => Promise<void>>(async () => {});
  const client = { channels: { fetch: vi.fn(async () => ({ isTextBased: () => true, send })) } };
  return { save, send, client: client as unknown as Client, service: createErrorReportService({ errorReport: { create: save } } as unknown as PrismaClient) };
}

describe("report source context", () => {
  it("requires explicit submission consent before storage or delivery", async () => {
    const s=fixture();
    expect(await s.service.report(s.client,"private draft",{source:"bug-report"})).toBeNull();
    expect(s.save).not.toHaveBeenCalled();expect(s.send).not.toHaveBeenCalled();
  });

  it("never forwards to an unpreviewed or changed notification destination", async () => {
    const s=fixture();
    await s.service.report(s.client,"confirmed",{source:"bug-report",consented:true,notificationChannelId:"unapproved"});
    await s.service.report(s.client,"confirmed",{source:"bug-report",consented:true,notificationChannelId:null});
    expect(s.save).toHaveBeenCalledTimes(2);expect(s.send).not.toHaveBeenCalled();
  });

  it("does not post a report after storage failure", async () => {
    const s=fixture();s.save.mockRejectedValueOnce(new Error("database password=do-not-log"));
    const log=vi.spyOn(console,"error").mockImplementation(()=>{});
    try {
      expect(await s.service.report(s.client,"confirmed",{source:"bug-report",consented:true,notificationChannelId:"private-intake"})).toBeNull();
      expect(s.send).not.toHaveBeenCalled();expect(JSON.stringify(log.mock.calls)).not.toContain("do-not-log");
    } finally { log.mockRestore(); }
  });

  it("stores bounded technical context without automatic user/message/private payloads", async () => {
    const s=fixture();
    await s.service.report(s.client,new TypeError("private chat"),{source:"privacy-auto",userId:"private-user",messageId:message,
      extra:"private conversation",diagnostics:{build:70532,capability:"native",token:"private-token"}});
    const stored=(s.save.mock.calls[0] as unknown as [{data:Record<string,unknown>}])[0].data;
    expect(stored["userId"]).toBeNull();
    expect(decodeReportOrigin(stored["context"] as string)).toMatchObject({messageId:null,extra:'{"build":70532,"capability":"native"}'});
    expect(JSON.stringify(stored)).not.toMatch(/private chat|private-user|private conversation|private-token/);
  });
  it("preserves the original failure while carrying a known guild through an outer job catch", async () => {
    const original = new TypeError("Pool timeout");
    let failure: unknown;
    try { await withReportContext({ guildId: guild, operation: "scheduled-events.reconcile" }, async () => { throw original; }); }
    catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(ScopedReportError);
    const s = fixture();
    expect(await s.service.report(s.client, failure, { source: "Discord scheduled events" })).toBe("12345678");
    const stored = (s.save.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(stored).toMatchObject({ guildId: guild, version });
    expect(stored["message"]).toMatch(/^TypeError \[error:[a-f0-9]{12}\]$/);
    expect(JSON.stringify(stored)).not.toContain(original.message);
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
    await s.service.report(s.client, "Submitted description", { source: "bug-report", consented: true, notificationChannelId: "private-intake", guildId: guild, channelId: channel, messageId: message, operation: "/report bug", extra: "https://cdn.example/shot.png" });
    const stored = (s.save.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(decodeReportOrigin(stored["context"] as string)).toEqual({ channelId: channel, messageId: message, operation: "/report bug", extra: null });
    expect(s.send.mock.calls[0]![0]).toMatchObject({ allowedMentions: { parse: [] } });
    expect(s.send.mock.calls[0]![0].content).toContain(`Source message: https://discord.com/channels/${guild}/${channel}/${message}`);
    expect(s.send.mock.calls[0]![0].content).toContain(`Ref \`12345678\` · v${version}`);
  });

  it("keeps a confirmed bug report's Discord screenshot link, and only that", async () => {
    const shot = "https://cdn.discordapp.com/ephemeral-attachments/1/2/shot.png?ex=1&is=2&hm=3";
    const s = fixture();
    await s.service.report(s.client, "Broken button", { source: "bug-report", consented: true, notificationChannelId: "private-intake", screenshotUrl: shot });
    await s.service.report(s.client, "Broken button", { source: "bug-report", consented: true, notificationChannelId: "private-intake", screenshotUrl: "https://evil.example/attachments/shot.png" });
    await s.service.report(s.client, new TypeError("boom"), { source: "job", screenshotUrl: shot });
    const extra = (call: number) => decodeReportOrigin((s.save.mock.calls[call] as unknown as [{ data: Record<string, unknown> }])[0].data["context"] as string).extra;
    expect([extra(0), extra(1), extra(2)]).toEqual([shot, null, null]);
    expect(s.send.mock.calls[0]![0].content).toContain(`Screenshot: ${shot}`);
    expect(s.send.mock.calls[1]![0].content).not.toContain("evil.example");
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
    await s.service.report(s.client, "x".repeat(4000), { source: "bug-report", consented: true, notificationChannelId: "private-intake", guildId: guild, channelId: channel, messageId: message });
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
