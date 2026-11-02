import { describe, expect, it, vi } from "vitest";
import { ButtonStyle, MessageFlags } from "discord.js";
import { createOwnerConsole, CONSOLE_CHANNEL_NAME, type ConsoleDeps } from "../src/services/owner-console.js";
import {
  ACTIONS, PAGE_SIZE, boardComponents, buildDigest, confirmComponents, confirmFresh, confirmToken, detailComponents, digestText, fleetLines, helpText, pageCount, pageSlice, parseConsoleId, setupProgress, type FleetRow
} from "../src/services/owner-console-model.js";
import { ownerConsoleCommand } from "../src/commands/owner-console.js";

const HOME = "100000000000000001", OWNER = "owner-1", CHANNEL = "chan-1", OTHER = "200000000000000001";
const row = (n: number, extra: Partial<FleetRow> = {}): FleetRow => ({
  discordId: `2000000000000000${String(n).padStart(2, "0")}`, name: `Guild ${n}`, memberCount: n, tier: "approved", editions: ["forever"], language: "en", lastActivity: null,
  setupDone: 3, setupTotal: 8, achievements: true, announcements: false, publicSharing: false, weeklyReport: false, honors: null, errors24h: 0, lastSync: null, version: "8.4.0",
  characters: 0, cores: 0, upcomingRaids: 0, hasAdminChannel: true, untracked: false, ...extra
});

describe("owner console model", () => {
  it("paginates fleets and clamps pages", () => {
    const all = Array.from({ length: 30 }, (_, i) => i);
    expect(pageCount(30)).toBe(Math.ceil(30 / PAGE_SIZE));
    expect(pageSlice(all, 0)).toHaveLength(PAGE_SIZE);
    expect(pageSlice(all, 99)).toEqual(all.slice((pageCount(30) - 1) * PAGE_SIZE));
    expect(pageSlice(all, -4)[0]).toBe(0);
    expect(pageCount(0)).toBe(1);
  });
  it("respects Discord limits on the board", () => {
    expect(PAGE_SIZE).toBeLessThanOrEqual(25);
    const rows = Array.from({ length: PAGE_SIZE }, (_, i) => row(i, { name: "N".repeat(200) }));
    expect(fleetLines(rows).length).toBeLessThan(4000);
    const components = boardComponents(rows, 40, 1, false).map(r => r.toJSON());
    expect(components.length).toBeLessThanOrEqual(5);
    expect(components[0]!.components.length).toBeLessThanOrEqual(5);
    expect((components[1]!.components[0] as unknown as { options: unknown[] }).options.length).toBeLessThanOrEqual(25);
    for (const r of components) for (const c of r.components as { custom_id?: string }[]) expect(c.custom_id!.length).toBeLessThanOrEqual(100);
    expect(helpText().length).toBeLessThan(2000);
  });
  it("disables prev on the first page and next on the last", () => {
    const first = boardComponents([row(1)], 20, 0, false)[0]!.toJSON().components as { disabled?: boolean }[];
    expect(first[0]!.disabled).toBe(true);
    const last = boardComponents([row(1)], 20, 2, false)[0]!.toJSON().components as { disabled?: boolean }[];
    expect(last[1]!.disabled).toBe(true);
  });
  it("describes every action in the help and keeps detail rows within five buttons", () => {
    for (const action of ACTIONS) expect(helpText()).toContain(action.label);
    for (const r of detailComponents(row(1), false)) expect(r.components.length).toBeLessThanOrEqual(5);
  });
  it("blocks leave and tier on the home server and send without an admin channel", () => {
    const buttons = detailComponents(row(1, { hasAdminChannel: false }), true).flatMap(r => r.toJSON().components) as { label: string; disabled?: boolean }[];
    const disabled = buttons.filter(b => b.disabled).map(b => b.label);
    expect(disabled).toEqual(expect.arrayContaining(["Leave server", "Toggle approval tier", "Message admin channel"]));
  });
  it("expires confirmations", () => {
    const now = 1_000_000;
    expect(confirmFresh(confirmToken(now), now + 60_000)).toBe(true);
    expect(confirmFresh(confirmToken(now), now + 10 * 60_000)).toBe(false);
    expect(confirmFresh(undefined, now)).toBe(false);
    const ok = confirmComponents("leave", "123", now).toJSON().components as { custom_id: string; style: number }[];
    expect(ok[0]!.style).toBe(ButtonStyle.Danger);
    expect(parseConsoleId(ok[0]!.custom_id)).toMatchObject({ kind: "ok", args: ["leave", "123", confirmToken(now)] });
    expect(parseConsoleId("other:thing")).toBeNull();
  });
  it("computes the digest, flags spikes, and stays quiet when nothing changed", () => {
    const digest = buildDigest({ known: { a: "Old", b: "Kept" }, current: [{ id: "b", name: "Kept", errors24h: 12 }, { id: "c", name: "New", errors24h: 0 }] });
    expect(digest).toMatchObject({ added: ["New"], removed: ["Old"], spikes: ["Kept (12)"], quiet: false });
    expect(digestText(digest)).toContain("New servers");
    expect(buildDigest({ known: { b: "Kept" }, current: [{ id: "b", name: "Kept", errors24h: 0 }] }).quiet).toBe(true);
    expect(buildDigest({ known: null, current: [{ id: "x", name: "X", errors24h: 0 }] }).added).toEqual([]);
  });
  it("counts setup progress without Discord calls", () => {
    expect(setupProgress(null)).toEqual({ done: 0, total: 8 });
    expect(setupProgress({ notifyChannelId: "1", adminChannelId: "2", logChannelId: null })).toMatchObject({ done: 2 });
  });
  it("registers /guilded-console with setup and refresh, admin-only", () => {
    const json = ownerConsoleCommand.toJSON();
    expect(json.options?.map(o => o.name)).toEqual(["setup", "refresh"]);
    expect(json.default_member_permissions).toBe("8");
  });
});

function fixture(options: { stored?: Record<string, unknown> | null; channelFetch?: () => Promise<unknown> } = {}) {
  let stored: Record<string, unknown> | null = options.stored === undefined ? { id: "main", channelId: CHANNEL, boardMessageId: "msg-1", digestEnabled: false, digestLastAt: null, knownGuilds: null } : options.stored;
  const sent: unknown[] = [], edited: unknown[] = [];
  const message = { id: "msg-1", editable: true, edit: vi.fn(async (value: unknown) => { edited.push(value); }) };
  const channel = { isTextBased: () => true, send: vi.fn(async (value: unknown) => { sent.push(value); return { id: "msg-2" }; }), messages: { fetch: vi.fn(async () => message) } };
  const adminSend = vi.fn(async () => undefined);
  const guilds = new Map<string, unknown>([
    [HOME, { id: HOME, name: "K Caron Projects", memberCount: 3, leave: vi.fn(), channels: { fetch: vi.fn() } }],
    [OTHER, { id: OTHER, name: "Other", memberCount: 40, leave: vi.fn(async () => undefined), channels: { fetch: vi.fn(async () => ({ isTextBased: () => true, send: adminSend })) } }]
  ]);
  const db = {
    ownerConsole: {
      findUnique: vi.fn(async () => stored),
      upsert: vi.fn(async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => { stored = stored ? { ...stored, ...update } : { ...create }; return stored; })
    },
    ownerConsoleAudit: { create: vi.fn(async () => undefined) },
    guild: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => ({ id: "db-1" })) },
    guildSettings: { findUnique: vi.fn(async () => ({ adminChannelId: "admin-1", achievementsEnabled: true })), update: vi.fn(async () => undefined) },
    errorReport: { count: vi.fn(async () => 0) }
  };
  const tools = { updateMessages: vi.fn(async () => "Updated: bot guide."), createChannels: vi.fn(async () => "made"), setupCheck: vi.fn(async () => "checks") };
  const setTier = vi.fn(async () => "Approved.");
  const client = { guilds: { cache: guilds }, user: { id: "bot" }, channels: { fetch: vi.fn(options.channelFetch ?? (async () => channel)) } };
  const warn = vi.fn();
  const deps = { db, client, homeGuildId: HOME, ownerId: async () => OWNER, tier: () => "lite", setTier, version: "8.4.0", tools, warn, now: () => 5_000_000 } as unknown as ConsoleDeps;
  return { console_: createOwnerConsole(deps), db, tools, setTier, sent, edited, channel, adminSend, guilds, warn, get stored() { return stored; } };
}

const button = (customId: string, userId = OWNER, extra: Record<string, unknown> = {}) => ({
  customId, user: { id: userId }, guildId: HOME, channelId: CHANNEL,
  isButton: () => true, isStringSelectMenu: () => false, isModalSubmit: () => false,
  reply: vi.fn(async () => undefined), update: vi.fn(async () => undefined), editReply: vi.fn(async () => undefined), deferUpdate: vi.fn(async () => undefined), showModal: vi.fn(async () => undefined), ...extra
});
const modalSubmit = (customId: string, text: string) => ({ customId, user: { id: OWNER }, guildId: HOME, channelId: CHANNEL, isButton: () => false, isStringSelectMenu: () => false, isModalSubmit: () => true,
  fields: { getTextInputValue: () => text }, reply: vi.fn(async () => undefined), deferReply: vi.fn(async () => undefined), editReply: vi.fn(async () => undefined) });

describe("owner console interactions", () => {
  it("refuses anyone but the owner, outside the home server, or outside the console channel", async () => {
    const f = fixture();
    for (const i of [button(`oc:act:tier:${OTHER}`, "intruder"), button(`oc:act:tier:${OTHER}`, OWNER, { guildId: "999" }), button(`oc:act:tier:${OTHER}`, OWNER, { channelId: "elsewhere" })]) {
      expect(await f.console_.handle(i as never)).toBe(true);
      expect(i.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("Only the Guilded bot's owner"), flags: MessageFlags.Ephemeral }));
      expect(i.update).not.toHaveBeenCalled();
    }
    expect(f.setTier).not.toHaveBeenCalled();
    expect(f.db.ownerConsoleAudit.create).not.toHaveBeenCalled();
  });
  it("ignores ids that are not the console's", async () => {
    expect(await fixture().console_.handle(button("pilot-request:x") as never)).toBe(false);
  });
  it("asks for confirmation before any change and does nothing until Confirm", async () => {
    const f = fixture();
    const click = button(`oc:act:achievements:${OTHER}`);
    await f.console_.handle(click as never);
    expect(click.reply).toHaveBeenCalledWith(expect.objectContaining({ components: expect.any(Array) }));
    expect(f.db.guildSettings.update).not.toHaveBeenCalled();
    expect(f.tools.updateMessages).not.toHaveBeenCalled();
    await f.console_.handle(button(`oc:ok:achievements:${OTHER}:${confirmToken(5_000_000)}`) as never);
    expect(f.db.guildSettings.update).toHaveBeenCalledWith(expect.objectContaining({ data: { achievementsEnabled: false } }));
    expect(f.db.ownerConsoleAudit.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actorId: OWNER, targetGuildId: OTHER }) }));
  });
  it("rejects a stale confirmation without acting", async () => {
    const f = fixture();
    const stale = button(`oc:ok:messages:${OTHER}:${confirmToken(1_000)}`);
    await f.console_.handle(stale as never);
    expect(stale.update).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("expired") }));
    expect(f.tools.updateMessages).not.toHaveBeenCalled();
  });
  it("routes confirmed actions to the right tool and the tier switch", async () => {
    const f = fixture();
    await f.console_.handle(button(`oc:ok:messages:${OTHER}:${confirmToken(5_000_000)}`) as never);
    expect(f.tools.updateMessages).toHaveBeenCalledOnce();
    await f.console_.handle(button(`oc:ok:tier:${OTHER}:${confirmToken(5_000_000)}`) as never);
    expect(f.setTier).toHaveBeenCalledWith(OTHER, "approved");
  });
  it("requires LEAVE typed exactly, and never leaves the home server", async () => {
    const f = fixture();
    const other = f.guilds.get(OTHER) as { leave: ReturnType<typeof vi.fn> };
    await f.console_.handle(modalSubmit(`oc:leavem:${OTHER}`, "leave") as never);
    expect(other.leave).not.toHaveBeenCalled();
    await f.console_.handle(modalSubmit(`oc:leavem:${OTHER}`, "LEAVE") as never);
    expect(other.leave).toHaveBeenCalledOnce();
    await f.console_.handle(modalSubmit(`oc:leavem:${HOME}`, "LEAVE") as never);
    expect((f.guilds.get(HOME) as { leave: ReturnType<typeof vi.fn> }).leave).not.toHaveBeenCalled();
  });
  it("sends typed text to the admin channel only after a preview and confirmation, without mentions", async () => {
    const f = fixture();
    const modal = modalSubmit(`oc:sendm:${OTHER}`, "hello @everyone");
    await f.console_.handle(modal as never);
    expect(f.adminSend).not.toHaveBeenCalled();
    const reply = modal.reply.mock.calls[0] as unknown as [{ components: { toJSON(): { components: { custom_id: string }[] } }[] }];
    const confirmId = reply[0].components[0]!.toJSON().components[0]!.custom_id;
    await f.console_.handle(button(confirmId) as never);
    expect(f.adminSend).toHaveBeenCalledWith(expect.objectContaining({ allowedMentions: { parse: [] }, content: expect.stringContaining("hello @everyone") }));
    await f.console_.handle(button(confirmId) as never);
    expect(f.adminSend).toHaveBeenCalledOnce();
  });
});

describe("owner console channel and board", () => {
  it("forgets a deleted channel once, quietly, without reporting an error", async () => {
    const gone = Object.assign(new Error("Unknown Channel"), { code: 10003 });
    const f = fixture({ channelFetch: async () => { throw gone; } });
    await f.console_.refresh(true);
    expect(f.stored).toMatchObject({ channelId: null, boardMessageId: null });
    expect(f.warn).toHaveBeenCalledOnce();
    await f.console_.refresh(true);
    expect(f.warn).toHaveBeenCalledOnce();
  });
  it("edits the board message in place instead of posting again", async () => {
    const f = fixture();
    await f.console_.refresh(true);
    expect(f.edited).toHaveLength(1);
    expect(f.sent).toHaveLength(0);
  });
  it("does nothing when the console was never set up", async () => {
    const f = fixture({ stored: null });
    await f.console_.refresh(true);
    expect(f.channel.send).not.toHaveBeenCalled();
  });
  it("setup is owner-only, home-only, and idempotent", async () => {
    const f = fixture({ stored: null });
    const existing = { type: 0, name: CONSOLE_CHANNEL_NAME, id: CHANNEL, permissionOverwrites: { set: vi.fn(async () => undefined) } };
    const create = vi.fn(async () => existing);
    const cache = new Map<string, unknown>() as Map<string, unknown> & { find?: (fn: (c: unknown) => boolean) => unknown };
    cache.find = (fn) => [...cache.values()].find(fn);
    const home = { id: HOME, roles: { everyone: { id: "everyone" } }, channels: { cache, fetch: vi.fn(async () => null), create } };
    const slash = (userId: string, guildId: string) => ({ user: { id: userId }, guildId, guild: guildId === HOME ? home : { id: guildId }, reply: vi.fn(async () => undefined), deferReply: vi.fn(async () => undefined), editReply: vi.fn(async () => undefined) });
    const stranger = slash("x", HOME), elsewhere = slash(OWNER, "999");
    await f.console_.setupChannel(stranger as never);
    await f.console_.setupChannel(elsewhere as never);
    expect(create).not.toHaveBeenCalled();
    expect(stranger.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("Only") }));
    expect(elsewhere.reply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("home server") }));
    await f.console_.setupChannel(slash(OWNER, HOME) as never);
    expect(create).toHaveBeenCalledOnce();
    const overwrites = (create.mock.calls[0] as unknown as [{ permissionOverwrites: { id: string; deny?: bigint[] }[] }])[0].permissionOverwrites;
    expect(overwrites.map(o => o.id)).toEqual(["everyone", OWNER, "bot"]);
    expect(overwrites[0]!.deny).toHaveLength(1);
    // Re-run: the stored channel is found again, so nothing new is created.
    home.channels.fetch = vi.fn(async () => existing) as never;
    await f.console_.setupChannel(slash(OWNER, HOME) as never);
    expect(create).toHaveBeenCalledOnce();
    expect(existing.permissionOverwrites.set).toHaveBeenCalledOnce();
  });
});
