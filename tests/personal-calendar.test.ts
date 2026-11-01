import { expect, it, vi } from "vitest";
import { createPersonalCalendar, personalCalendarIcs, personalCalendarStore } from "../src/services/personal-calendar.js";
import type { WebContext, WebKit } from "../src/services/web-app.js";

const now = new Date("2026-10-30T18:00:00Z");
const account = { id: "account", discordUserId: "user", username: "Name", displayName: null };
const event = { id: "raid:r", title: "Raid, café; préparation\\\nBEGIN:BAD", at: new Date("2026-11-01T01:30:00-04:00"), status: "CONFIRMED" as const, context: "Guild · retail" };
const uid = (ics: string) => ics.replace(/\r\n /g, "").match(/UID:([^\r]+)/)?.[1];

it("keeps identity stable through rescheduling and cancellation without leaking account identifiers", () => {
  const initial = personalCalendarIcs(account.id, [event], now);
  const moved = personalCalendarIcs(account.id, [{ ...event, at: new Date("2026-11-01T01:30:00-05:00"), status: "CANCELLED" }], now);
  expect(uid(initial)).toBe(uid(moved)); expect(uid(initial)).not.toContain(account.id);
  expect(initial).toContain("DTSTART:20261101T053000Z"); expect(moved).toContain("DTSTART:20261101T063000Z");
  expect(moved).toContain("STATUS:CANCELLED"); expect(initial).not.toContain("DTEND:");
  expect(uid(personalCalendarIcs("other", [event], now))).not.toBe(uid(initial));
});

it("escapes injected lines and folds Unicode within 75 UTF-8 octets with CRLF endings", () => {
  const ics = personalCalendarIcs(account.id, [{ ...event, context: "é🙂".repeat(90) }], now);
  expect(ics).not.toContain("\r\nBEGIN:BAD");
  expect(ics).toContain("Raid\\, café\\; préparation\\\\\\nBEGIN:BAD");
  for (const line of ics.split("\r\n")) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
  expect(ics.replace(/\r\n /g, "")).toContain("DESCRIPTION:" + "é🙂".repeat(90));
  expect(ics.replace(/\r\n/g, "")).not.toContain("\n");
});

function fixture() {
  const raid = { id: "r", title: "Raid", scheduledAt: now, status: "CANCELLED", signupChannelId: "visible", guildId: "g", guild: { discordId: "discord-g" } };
  const db = { raidSignup: { findMany: vi.fn(async () => [{ status: "SIGNED_UP", raid }, { status: "SIGNED_UP", raid: { ...raid, id: "private", signupChannelId: "hidden" } }]) },
    activityResponse: { findMany: vi.fn(async () => [{ status: "CONFIRMED", session: { id: "s", scheduledAt: now, endsAt: new Date(now.getTime() + 3600000), status: "PLANNED", core: { name: "Team", guildId: "g", channelId: "visible", guild: { discordId: "discord-g" } } } }]) } };
  const memberFetch = vi.fn(async () => ({}));
  const channels = vi.fn(async (id: string) => ({ permissionsFor: () => ({ has: () => id === "visible" }) }));
  const client = { isReady: () => true, guilds: { fetch: vi.fn(async () => ({ members: { fetch: memberFetch }, channels: { fetch: channels } })) } };
  const access = { guilds: vi.fn(async () => [{ id: "g", name: "Guild", edition: "retail" }]) };
  return { db, client, access, memberFetch, channels };
}

it("checks session membership and live channel permissions, includes cancellation and confirmed team responses", async () => {
  const f = fixture();
  const result = await personalCalendarStore(f.db as never, f.access as never, f.client as never)(account, now);
  expect(f.access.guilds).toHaveBeenCalledWith("user");
  expect(f.db.raidSignup.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ member: { discordUserId: "user", guildId: { in: ["g"] } } }) }));
  expect(f.memberFetch).toHaveBeenCalledWith({ user: "user", force: true });
  expect(result.events.map(e => [e.id, e.status])).toEqual([["raid:r", "CANCELLED"], ["team:s", "CONFIRMED"]]);
  expect(f.channels).toHaveBeenCalledWith("hidden", { force: true });
});

it("fails closed if current Discord visibility cannot be checked", async () => {
  const f = fixture(); f.memberFetch.mockRejectedValueOnce(new Error("unreachable"));
  await expect(personalCalendarStore(f.db as never, f.access as never, f.client as never)(account, now)).rejects.toThrow("unreachable");
});

it("requires sign-in, ignores requested identity, and serves a private manual snapshot", async () => {
  const ctx: WebContext = { account, request: { path: "/me/calendar", method: "GET", query: new URLSearchParams("account=other&download=ics"), headers: {} },
    lang: "en", t: en => en, now, sessionToken: null, csrf: null, form: null, auth: null };
  const kit: WebKit = { page: (status, _title, body) => ({ status, headers: {}, body }), redirect: () => ({ status: 303, headers: {}, body: "" }), signInPrompt: () => ({ status: 401, headers: {}, body: "Sign in" }) };
  const load = vi.fn(async () => ({ events: [event], limited: false })), page = createPersonalCalendar(load);
  expect((await page.route({ ...ctx, account: null }, kit))?.status).toBe(401); expect(load).not.toHaveBeenCalled();
  const response = await page.route(ctx, kit);
  expect(load).toHaveBeenCalledWith(account, now); expect(response?.headers["cache-control"]).toBe("private, no-store");
  expect(response?.body).toContain("BEGIN:VCALENDAR");
  load.mockRejectedValueOnce(new Error("private internal details"));
  const failed = await page.route(ctx, kit); expect(failed?.status).toBe(503); expect(failed?.body).not.toContain("private internal details");
});
