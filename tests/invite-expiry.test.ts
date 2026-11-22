import { describe, expect, it, vi } from "vitest";
import {
  applyInviteReports, closeRequestsOf, EXPIRY, formatClosedInvites, handleInviteConfirmButton, handleRequesterLeft, KEEP_PREFIX, DROP_PREFIX,
  limitReached, parseInviteReports, sweepDepartedRequesters, sweepInviteExpiry
} from "../src/services/invite-expiry.js";
import { inviteListForAddon, formatInviteList } from "../src/services/invite-queue.js";
import { exportInviteReports } from "../companion/lua-export-content.mjs";
import { standingsToLua } from "../companion/standings-format.mjs";

const DAY = 86_400_000;
const NOW = new Date("2026-11-20T12:00:00Z");

interface Row {
  id: string; guildId: string; discordGuildId: string; discordUserId: string; displayName: string; status: string; createdAt: Date;
  invitesSent: number; lastInviteAt: Date | null; gameState: string | null; gameStateAt: Date | null; expiryBaseAt: Date | null; expiryBaseSent: number;
  confirmAskedAt: Date | null; closedAt: Date | null; closeReason: string | null;
}
const row = (over: Partial<Row> = {}): Row => ({
  id: "req_000001", guildId: "g1", discordGuildId: "d1", discordUserId: "u1", displayName: "Amy Archer", status: "PENDING", createdAt: new Date(NOW.getTime() - DAY),
  invitesSent: 0, lastInviteAt: null, gameState: null, gameStateAt: null, expiryBaseAt: null, expiryBaseSent: 0, confirmAskedAt: null, closedAt: null, closeReason: null, ...over
});

function fake(rows: Row[], settings: Array<{ guildId: string; discordId: string; language?: string; inviteExpiryEnabled?: boolean; inviteExpiryDmEnabled?: boolean }> = []) {
  const matches = (r: Row, where: Record<string, unknown>): boolean => Object.entries(where).every(([key, value]) => {
    if (key === "guild") return r.discordGuildId === (value as { discordId: string }).discordId;
    const actual = (r as unknown as Record<string, unknown>)[key];
    if (value && typeof value === "object" && !(value instanceof Date)) {
      const v = value as { in?: unknown[]; lte?: Date };
      if (v.in) return v.in.includes(actual);
      if (v.lte) return actual instanceof Date && actual <= v.lte;
      return false;
    }
    return actual === value;
  });
  return {
    rows,
    inviteRequest: {
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => { const hit = rows.filter((r) => matches(r, where)); hit.forEach((r) => Object.assign(r, data)); return { count: hit.length }; },
      findMany: async ({ where }: { where: Record<string, unknown> }) => rows.filter((r) => matches(r, where)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
      findUnique: async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => Object.assign(rows.find((r) => r.id === where.id)!, data)
    },
    guildSettings: {
      findMany: async ({ where }: { where: { guild?: { discordId: string }; inviteQueueEnabled?: boolean; inviteExpiryEnabled?: boolean } }) => settings
        .filter((s) => (!where.guild || s.discordId === where.guild.discordId) && (where.inviteExpiryEnabled === undefined || (s.inviteExpiryEnabled ?? true) === where.inviteExpiryEnabled))
        .map((s) => ({ guildId: s.guildId, language: s.language ?? "en", inviteExpiryDmEnabled: s.inviteExpiryDmEnabled ?? true, guild: { id: s.guildId, discordId: s.discordId, name: "Québec Gold" } })),
      findUnique: async ({ where }: { where: { guildId: string } }) => settings.find((s) => s.guildId === where.guildId) ?? null
    }
  };
}

function discordFake(opts: { missing?: Set<string>; dmClosed?: Set<string> } = {}) {
  const sent: Array<{ user: string; content: string; components: unknown }> = [];
  const client = {
    guilds: { fetch: async () => ({ members: { fetch: async (id: string) => { if (opts.missing?.has(id)) throw Object.assign(new Error("Unknown Member"), { code: 10007 }); return { id }; } } }) },
    users: { fetch: async (id: string) => ({ send: async (payload: { content: string; components: unknown }) => { if (opts.dmClosed?.has(id)) throw new Error("Cannot send messages to this user"); sent.push({ user: id, ...payload }); } }) }
  };
  return { client, sent };
}
const settings1 = [{ guildId: "g1", discordId: "d1" }];

describe("rule 1: leaving Discord cancels", () => {
  it("closes the member's open requests in that server only", async () => {
    const db = fake([row({ id: "a" }), row({ id: "b", discordUserId: "u2" }), row({ id: "c", discordGuildId: "d2", guildId: "g2" }), row({ id: "d", status: "INVITED" })], settings1);
    expect(await handleRequesterLeft(db as never, "d1", "u1")).toBe(1);
    expect(db.rows.map((r) => `${r.id}:${r.status}:${r.closeReason}`)).toEqual(["a:CLOSED:left_discord", "b:PENDING:null", "c:PENDING:null", "d:INVITED:null"]);
  });
  it("still cancels when the expiry switch is off: the person is gone", async () => {
    const db = fake([row()], [{ guildId: "g1", discordId: "d1", inviteExpiryEnabled: false }]);
    expect(await handleRequesterLeft(db as never, "d1", "u1")).toBe(1);
  });
  it("closeRequestsOf leaves handled requests alone", async () => {
    const db = fake([row({ status: "JOINED" })]);
    expect(await closeRequestsOf(db as never, { guildId: "g1", discordUserId: "u1" }, "expired")).toBe(0);
  });
});

describe("rule 2: what the addon reports back", () => {
  it("reads only well-formed reports", () => {
    const good = { id: "req_000001", sent: 2, state: "declined", at: 1_794_000_000 };
    expect(parseInviteReports([good, { ...good, id: "x" }, { ...good, state: "weird" }, { ...good, at: 5 }, "no", { ...good, state: null }])).toHaveLength(2);
    expect(parseInviteReports(undefined)).toEqual([]);
  });
  it("counts invites (never down), keeps the newest game answer and closes a removed request", async () => {
    const at = Math.floor(NOW.getTime() / 1000);
    const db = fake([row({ id: "req_000001", invitesSent: 2 }), row({ id: "req_000002" }), row({ id: "req_000003", guildId: "other" })]);
    await applyInviteReports(db as never, "g1", parseInviteReports([
      { id: "req_000001", sent: 1, state: "declined", at }, { id: "req_000002", sent: 3, state: "inguild", at }, { id: "req_000003", sent: 9, at }
    ]));
    expect(db.rows[0]).toMatchObject({ invitesSent: 2, gameState: "declined" });
    expect(db.rows[1]).toMatchObject({ invitesSent: 3, gameState: "inguild", lastInviteAt: new Date(at * 1000) });
    expect(db.rows[2]).toMatchObject({ invitesSent: 0, gameState: null });
    // An older answer does not replace a newer one; a newer invite with no answer clears it.
    await applyInviteReports(db as never, "g1", parseInviteReports([{ id: "req_000002", sent: 4, state: "notfound", at: at - 100 }]));
    expect(db.rows[1]!.gameState).toBe("inguild");
    await applyInviteReports(db as never, "g1", parseInviteReports([{ id: "req_000002", sent: 5, at: at + 100 }]));
    expect(db.rows[1]).toMatchObject({ invitesSent: 5, gameState: null });
    await applyInviteReports(db as never, "g1", parseInviteReports([{ id: "req_000001", sent: 2, removed: true, at: at + 200 }]));
    expect(db.rows[0]).toMatchObject({ status: "CLOSED", closeReason: "officer_removed" });
  });
});

describe("rule 3 and 6: ask once, then expire (numbers in one place)", () => {
  it("keeps the limits as constants", () => expect(EXPIRY).toMatchObject({ maxInvites: 3, maxAgeDays: 4, graceDays: 3 }));
  it("reaches the limit at 3 invites or 4 days, counted from the last Yes", () => {
    const base = { createdAt: new Date(NOW.getTime() - 3 * DAY), invitesSent: 2, expiryBaseAt: null, expiryBaseSent: 0 };
    expect(limitReached(base, NOW)).toBe(false);
    expect(limitReached({ ...base, invitesSent: 3 }, NOW)).toBe(true);
    expect(limitReached({ ...base, createdAt: new Date(NOW.getTime() - 4 * DAY) }, NOW)).toBe(true);
    expect(limitReached({ ...base, createdAt: new Date(NOW.getTime() - 30 * DAY), invitesSent: 9, expiryBaseAt: new Date(NOW.getTime() - DAY), expiryBaseSent: 9 }, NOW)).toBe(false);
  });
  it("sends one DM with Yes and No buttons, then does nothing more on the next pass", async () => {
    const db = fake([row({ createdAt: new Date(NOW.getTime() - 5 * DAY) })], settings1);
    const { client, sent } = discordFake();
    expect(await sweepInviteExpiry(client as never, db as never, NOW)).toEqual({ asked: 1, closed: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.content).toContain("Still want to join **Québec Gold**");
    const ids = JSON.stringify(sent[0]!.components);
    expect(ids).toContain(`${KEEP_PREFIX}req_000001`);
    expect(ids).toContain(`${DROP_PREFIX}req_000001`);
    expect(db.rows[0]!.status).toBe("PENDING");
    expect(await sweepInviteExpiry(client as never, db as never, new Date(NOW.getTime() + DAY))).toEqual({ asked: 0, closed: 0 });
    expect(sent).toHaveLength(1);
  });
  it("asks after 3 invites even for a fresh request", async () => {
    const db = fake([row({ createdAt: new Date(NOW.getTime() - DAY), invitesSent: 3 })], settings1);
    const { client, sent } = discordFake();
    await sweepInviteExpiry(client as never, db as never, NOW);
    expect(sent).toHaveLength(1);
  });
  it("closes an unanswered question after 3 more days, and not before", async () => {
    const db = fake([row({ createdAt: new Date(NOW.getTime() - 9 * DAY), confirmAskedAt: new Date(NOW.getTime() - 2 * DAY) })], settings1);
    const { client } = discordFake();
    expect((await sweepInviteExpiry(client as never, db as never, NOW)).closed).toBe(0);
    expect((await sweepInviteExpiry(client as never, db as never, new Date(NOW.getTime() + DAY))).closed).toBe(1);
    expect(db.rows[0]).toMatchObject({ status: "CLOSED", closeReason: "no_answer" });
  });
  it("skips the DM quietly when DMs are closed, and the request closes after the same wait", async () => {
    const db = fake([row({ createdAt: new Date(NOW.getTime() - 6 * DAY) })], settings1);
    const { client, sent } = discordFake({ dmClosed: new Set(["u1"]) });
    expect(await sweepInviteExpiry(client as never, db as never, NOW)).toEqual({ asked: 1, closed: 0 });
    expect(sent).toHaveLength(0);
    await sweepInviteExpiry(client as never, db as never, new Date(NOW.getTime() + 3 * DAY));
    expect(db.rows[0]!.closeReason).toBe("no_answer");
  });
  it("asks one question per member even with several old requests", async () => {
    const db = fake([row({ id: "a", createdAt: new Date(NOW.getTime() - 8 * DAY) }), row({ id: "b", createdAt: new Date(NOW.getTime() - 6 * DAY), displayName: "Amy Archer-Two" })], settings1);
    const { client, sent } = discordFake();
    await sweepInviteExpiry(client as never, db as never, NOW);
    expect(sent).toHaveLength(1);
    expect(db.rows.every((r) => r.confirmAskedAt)).toBe(true);
  });
  it("closes a member who is no longer in the Discord server instead of asking", async () => {
    const db = fake([row({ createdAt: new Date(NOW.getTime() - 6 * DAY) })], settings1);
    const { client, sent } = discordFake({ missing: new Set(["u1"]) });
    await sweepInviteExpiry(client as never, db as never, NOW);
    expect(sent).toHaveLength(0);
    expect(db.rows[0]).toMatchObject({ status: "CLOSED", closeReason: "left_discord" });
  });
});

describe("rule 7: requests that were already old get the question once, never an instant close", () => {
  it("asks at most 10 members per pass; the rest follow on later passes", async () => {
    const rows = Array.from({ length: 14 }, (_, i) => row({ id: `req_old_${i}`.padEnd(10, "0"), discordUserId: `u${i}`, createdAt: new Date(NOW.getTime() - (30 + i) * DAY) }));
    const db = fake(rows, settings1);
    const { client, sent } = discordFake();
    expect(await sweepInviteExpiry(client as never, db as never, NOW)).toEqual({ asked: EXPIRY.dmPerSweep, closed: 0 });
    expect(rows.filter((r) => r.status === "CLOSED")).toHaveLength(0);
    expect(await sweepInviteExpiry(client as never, db as never, new Date(NOW.getTime() + 60 * 60_000))).toEqual({ asked: 4, closed: 0 });
    expect(sent).toHaveLength(14);
  });
});

describe("rule 6: officer switches", () => {
  it("does nothing for a server with the expiry off", async () => {
    const db = fake([row({ createdAt: new Date(NOW.getTime() - 20 * DAY) })], [{ guildId: "g1", discordId: "d1", inviteExpiryEnabled: false }]);
    const { client, sent } = discordFake();
    expect(await sweepInviteExpiry(client as never, db as never, NOW)).toEqual({ asked: 0, closed: 0 });
    expect(sent).toHaveLength(0);
    expect(db.rows[0]!.status).toBe("PENDING");
  });
  it("with the DM off, a request at the limit closes at once with its own reason", async () => {
    const db = fake([row({ createdAt: new Date(NOW.getTime() - 5 * DAY) })], [{ guildId: "g1", discordId: "d1", inviteExpiryDmEnabled: false }]);
    const { client, sent } = discordFake();
    expect(await sweepInviteExpiry(client as never, db as never, NOW)).toEqual({ asked: 0, closed: 1 });
    expect(sent).toHaveLength(0);
    expect(db.rows[0]!.closeReason).toBe("expired");
  });
  it("asks in French on a French server", async () => {
    const db = fake([row({ createdAt: new Date(NOW.getTime() - 5 * DAY) })], [{ guildId: "g1", discordId: "d1", language: "fr" }]);
    const { client, sent } = discordFake();
    await sweepInviteExpiry(client as never, db as never, NOW);
    expect(sent[0]!.content).toContain("Tu veux toujours rejoindre");
  });
});

describe("the DM answer", () => {
  const press = (customId: string, userId: string) => {
    const calls: Array<{ kind: string; payload: unknown }> = [];
    return { calls, interaction: { customId, user: { id: userId },
      update: async (payload: unknown) => { calls.push({ kind: "update", payload }); },
      reply: async (payload: unknown) => { calls.push({ kind: "reply", payload }); } } };
  };
  it("Yes keeps the request and restarts the counters", async () => {
    const db = fake([row({ invitesSent: 3, confirmAskedAt: NOW, createdAt: new Date(NOW.getTime() - 9 * DAY) })], settings1);
    const { interaction, calls } = press(`${KEEP_PREFIX}req_000001`, "u1");
    await handleInviteConfirmButton(interaction as never, db as never);
    expect(db.rows[0]).toMatchObject({ status: "PENDING", confirmAskedAt: null, expiryBaseSent: 3 });
    expect(db.rows[0]!.expiryBaseAt).toBeInstanceOf(Date);
    expect(limitReached(db.rows[0]!, new Date(db.rows[0]!.expiryBaseAt!.getTime() + DAY))).toBe(false);
    expect(JSON.stringify(calls[0]!.payload)).toContain("stay on the list");
  });
  it("No closes the request", async () => {
    const db = fake([row({ confirmAskedAt: NOW })], settings1);
    const { interaction } = press(`${DROP_PREFIX}req_000001`, "u1");
    await handleInviteConfirmButton(interaction as never, db as never);
    expect(db.rows[0]).toMatchObject({ status: "CLOSED", closeReason: "member_cancelled" });
  });
  it("only the member who asked may answer, and a closed request says so", async () => {
    const db = fake([row({ confirmAskedAt: NOW }), row({ id: "req_000002", status: "CLOSED" })], settings1);
    const other = press(`${DROP_PREFIX}req_000001`, "someone-else");
    await handleInviteConfirmButton(other.interaction as never, db as never);
    expect(db.rows[0]!.status).toBe("PENDING");
    expect(other.calls[0]!.kind).toBe("reply");
    const late = press(`${KEEP_PREFIX}req_000002`, "u1");
    await handleInviteConfirmButton(late.interaction as never, db as never);
    expect(JSON.stringify(late.calls[0]!.payload)).toContain("already closed");
    expect(db.rows[1]!.status).toBe("CLOSED");
  });
});

describe("what the addon and the officers see", () => {
  it("sends the request id, invites sent and status to the addon, never a Discord id", () => {
    const list = inviteListForAddon([
      { id: "req_000001", displayName: "Amy Archer", createdAt: new Date("2026-11-10T10:00:00Z"), invitesSent: 2, gameState: "declined", confirmAskedAt: null },
      { id: "req_000002", displayName: "Bob Brewer", createdAt: new Date("2026-11-11T10:00:00Z"), confirmAskedAt: NOW, gameState: "declined" },
      { displayName: "Old Shape", createdAt: new Date("2026-11-12T10:00:00Z") }
    ]);
    expect(list[0]).toEqual({ name: "Amy Archer", at: "2026-11-10T10:00:00.000Z", id: "req_000001", sent: 2, state: "declined" });
    expect(list[1]!.state).toBe("confirm");
    expect(list[2]).toEqual({ name: "Old Shape", at: "2026-11-12T10:00:00.000Z" });
    const lua = standingsToLua({ updatedAt: "2026-11-15T00:00:00Z", baseGp: 0, standings: [], officerInvites: list } as never);
    expect(lua).toContain(`{ name = "Amy Archer", at = "2026-11-10T10:00:00.000Z", id = "req_000001", sent = 2, state = "declined" },`);
    expect(lua).toContain(`{ name = "Old Shape", at = "2026-11-12T10:00:00.000Z" },`);
    expect(JSON.stringify(list)).not.toMatch(/discord/i);
  });
  it("the officer list shows invites sent and the game's answer; the closed view says why", () => {
    const text = formatInviteList([{ displayName: "Amy Archer", discordUserId: "u1", createdAt: NOW, channelId: "c", messageId: "m", invitesSent: 2, gameState: "inguild", confirmAskedAt: NOW }], "d1");
    expect(text).toContain("2 invites sent · in another guild · asked to confirm");
    const closed = formatClosedInvites([
      { displayName: "Amy Archer", discordUserId: "u1", closedAt: NOW, closeReason: "left_discord", invitesSent: 3, gameState: null },
      { displayName: "Bob Brewer", discordUserId: "u2", closedAt: NOW, closeReason: "officer_removed", invitesSent: 0, gameState: "declined" }
    ]);
    expect(closed).toContain("the member left the Discord server (3 invites sent)");
    expect(closed).toContain("removed by an officer in game (declined in game)");
    expect(formatClosedInvites([])).toBe("No closed requests.");
    expect(formatClosedInvites(Array.from({ length: 30 }, (_, i) => ({ displayName: `Name${i} Last`, discordUserId: "u", closedAt: NOW, closeReason: "no_answer", invitesSent: 0, gameState: null }))).length).toBeLessThan(1990);
  });
});

describe("the companion export", () => {
  it("whitelists reports from the addon's saved data", () => {
    const at = 1_794_000_000;
    const out = exportInviteReports({ inviteReports: {
      req_000001: { sent: 3, state: "declined", at }, req_000002: { sent: "x", removed: true, at: at + 5 }, bad: { sent: 1, at }, req_000003: { sent: 1, state: "evil", at: 1 }
    } }) as { inviteReports: Array<Record<string, unknown>> };
    expect(out.inviteReports).toEqual([{ id: "req_000002", sent: 0, at: at + 5, removed: true }, { id: "req_000001", sent: 3, at, state: "declined" }]);
    expect(exportInviteReports({})).toEqual({});
  });
});

vi.setConfig({ testTimeout: 15_000 });

describe("sweepDepartedRequesters", () => {
  const settings = [{ guildId: "g1", discordId: "d1" }];
  const clientWith = (present: Set<string>, failure?: number) => ({
    guilds: { fetch: async () => ({ members: { fetch: async (id: string) => { if (present.has(id)) return {}; throw Object.assign(new Error("x"), { code: failure ?? 10007 }); } } }) }
  });
  it("closes the requests of a member who is no longer in the Discord server (a missed leave)", async () => {
    const db = fake([row({ id: "req_000001", discordUserId: "gone" }), row({ id: "req_000002", discordUserId: "here", displayName: "Bob Baker" })], settings);
    expect(await sweepDepartedRequesters(clientWith(new Set(["here"])) as never, db as never, NOW)).toBe(1);
    expect(db.rows[0]).toMatchObject({ status: "CLOSED", closeReason: "left_discord" });
    expect(db.rows[1]!.status).toBe("PENDING");
  });
  it("leaves a request alone on any other Discord error", async () => {
    const db = fake([row()], settings);
    expect(await sweepDepartedRequesters(clientWith(new Set(), 50013) as never, db as never, NOW)).toBe(0);
    expect(db.rows[0]!.status).toBe("PENDING");
  });
});
