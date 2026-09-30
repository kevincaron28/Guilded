import { describe, expect, it } from "vitest";
import type { APIGuildScheduledEvent } from "discord.js";
import { mergeCalendarEvents } from "../src/services/discord-calendar.js";

const now = new Date("2026-09-30T12:00:00Z");
const event = (extra = {}) => ({ id: "e1", guild_id: "g1", name: "Molten Core", scheduled_start_time: "2026-10-01T18:00:00Z", status: 1, description: "Bring pots", ...extra } as APIGuildScheduledEvent);
describe("Discord calendar export", () => {
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
});
