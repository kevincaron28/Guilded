import { describe, expect, it, vi } from "vitest";
import { PermissionFlagsBits, PermissionsBitField, type APIGuildScheduledEvent } from "discord.js";
import { discordCalendarEvents, mergeCalendarEvents } from "../src/services/discord-calendar.js";

const now = new Date("2026-09-30T12:00:00Z");
const event = (extra = {}) => ({ id: "e1", guild_id: "g1", name: "Molten Core", scheduled_start_time: "2026-10-01T18:00:00Z", status: 1, description: "Bring pots", ...extra } as APIGuildScheduledEvent);
describe("Discord calendar export", () => {
  it("filters private native events using the paired member's fresh channel permissions", async () => {
    const fetchMember = vi.fn(async () => ({ id: "paired" }));
    const fetchChannel = vi.fn(async (id: string) => ({ permissionsFor: () => new PermissionsBitField(id === "public" ? PermissionFlagsBits.ViewChannel : 0n) }));
    const guild = { members: { fetch: fetchMember }, channels: { fetch: fetchChannel } };
    const client = { guilds: { fetch: async () => guild }, rest: { get: async () => [event({ id: "external", channel_id: null }), event({ id: "public", channel_id: "public" }), event({ id: "private", channel_id: "private" })] } };
    const exported = await discordCalendarEvents(client as never, "g1", "paired");
    expect(exported.map(row => row.id)).toEqual(["external", "public"]);
    expect(fetchMember).toHaveBeenCalledWith({ user: "paired", force: true });
  });
  it("fails closed when a member's event permissions cannot be verified", async () => {
    const client = { guilds: { fetch: async () => ({ members: { fetch: async () => { throw new Error("Member unavailable"); } } }) }, rest: { get: async () => [event({ channel_id: "private" })] } };
    await expect(discordCalendarEvents(client as never, "g1", "paired")).rejects.toThrow("Member unavailable");
  });
  it("exports built-in Discord events in the companion's calendar format", () => {
    expect(mergeCalendarEvents([], [event()], now)).toEqual([expect.objectContaining({ id: "discord:e1", title: "Molten Core", at: "2026-10-01T18:00:00.000Z", note: expect.stringContaining("https://discord.com/events/g1/e1") })]);
  });
  it("keeps bot raid metadata when the same event is also on Discord", () => {
    const raid = { id: "r1", title: "Molten Core", at: "2026-10-01T18:00:00Z", core: "Raid A", note: "Bot signup" };
    expect(mergeCalendarEvents([raid], [event()], now)).toEqual([raid]);
  });
  it("excludes cancelled, completed, past and distant events and sorts the rest", () => {
    const events = [event({ status: 3 }), event({ status: 4 }), event({ scheduled_start_time: "2026-09-29T18:00:00Z" }), event({ scheduled_start_time: "2026-11-01T18:00:00Z" }), event({ id: "later", scheduled_start_time: "2026-10-02T18:00:00Z" }), event()];
    expect(mergeCalendarEvents([], events, now).map((row) => row.id)).toEqual(["discord:e1", "discord:later"]);
  });
  it("deduplicates managed raids by identity even when their Discord name/time changed", () => {
    const raid = { id: "r1", title: "Molten Core", at: "2026-10-01T18:00:00Z", core: "Raid A", note: "Bot signup" };
    const renamed = event({ name: "Renamed raid", scheduled_start_time: "2026-10-01T20:00:00Z", description: "Signup link\nGuilded event guild:raid:r1" });
    expect(mergeCalendarEvents([raid], [renamed], now)).toEqual([raid]);
    expect(mergeCalendarEvents([], [renamed], now)).toEqual([]);
  });
});
