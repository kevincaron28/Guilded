import { describe, expect, it, vi } from "vitest";
import { isReminderDue, deliverRaidReminder } from "../src/services/reminders.js";

const now = new Date("2026-10-01T19:10:00Z");
const start = new Date("2026-10-01T20:00:00Z");

describe("raid reminders", () => {
  it("is due inside the window, once, and not after start", () => {
    expect(isReminderDue({ now, scheduledAt: start, minutes: 60, sentAt: null })).toBe(true);
    expect(isReminderDue({ now, scheduledAt: start, minutes: 30, sentAt: null })).toBe(false);
    expect(isReminderDue({ now, scheduledAt: start, minutes: 60, sentAt: now })).toBe(false);
    expect(isReminderDue({ now, scheduledAt: start, minutes: 0, sentAt: null })).toBe(false);
    expect(isReminderDue({ now: new Date("2026-10-01T20:05:00Z"), scheduledAt: start, minutes: 60, sentAt: null })).toBe(false);
  });

  it("marks a reminder only after delivery, retries failures and recognizes a delivered marker", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const recent = vi.fn().mockResolvedValue([]);
    const channel = { isTextBased: () => true, send, messages: { fetch: recent } };
    const guild = { id: "g", client: { user: { id: "bot" } }, channels: { fetch: vi.fn().mockResolvedValue(channel) } };
    const update = vi.fn().mockResolvedValue({});
    const database = {
      raid: {
        findFirst: vi.fn().mockResolvedValue({
          id: "r1", status: "PLANNED", title: "MC", scheduledAt: start, reminderSentAt: null, signupChannelId: "chan",
          guild: { discordId: "g", settings: { raidReminderMinutes: 60, raidSignupChannelId: null } },
          signups: [{ member: { discordUserId: "111" } }, { member: { discordUserId: "222" } }]
        }),
        update
      }
    };
    const job = { id: "job1", guildId: "guild", payload: { raidId: "r1", scheduledAt: start.toISOString() } };
    send.mockRejectedValueOnce(new Error("offline"));
    await expect(deliverRaidReminder(guild as never, database as never, job as never, now)).rejects.toThrow("offline");
    expect(update).not.toHaveBeenCalled();
    await deliverRaidReminder(guild as never, database as never, job as never, now);
    expect(update).toHaveBeenCalledWith({ where: { id: "r1" }, data: { reminderSentAt: now } });
    expect(send.mock.calls[0]?.[0].allowedMentions).toEqual({ parse: [], users: ["111", "222"] });
    recent.mockResolvedValue([{ author: { id: "bot" }, embeds: [{ footer: { text: "Guilded reminder job1" } }] }]);
    send.mockClear(); update.mockClear();
    await deliverRaidReminder(guild as never, database as never, job as never, now);
    expect(send).not.toHaveBeenCalled(); expect(update).toHaveBeenCalledOnce();
    recent.mockClear();
    await deliverRaidReminder(guild as never, database as never, job as never, new Date(start.getTime() + 1));
    expect(recent).not.toHaveBeenCalled();
  });
});
