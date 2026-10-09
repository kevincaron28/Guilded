import { describe, expect, it, vi } from "vitest";
import { Collection } from "discord.js";
import { deliverTeamPost, requireTeamChannel, teamRosterEmbed, teamSessionButtons, teamSessionEmbed } from "../src/services/activity-core-discord.js";

const now = new Date("2026-10-09T12:00:00Z");
function fixture() {
  const core = { id: "core", guildId: "guild", name: "Weekly", kind: "PVP", channelId: "channel", members: [], tanks: 1, healers: 2, dps: 7, goal: null,
    archived: false, rosterMessageId: null, timezone: "America/Toronto", weeklySchedule: "vendredi 20h00", durationMinutes: 120 };
  const session = { id: "session", core, responses: [], messageId: null as string | null, status: "PLANNED", result: null,
    scheduledAt: new Date("2026-10-09T13:00:00Z"), endsAt: new Date("2026-10-09T15:00:00Z"), openRecruitment: false };
  const message = { id: "message", author: { id: "bot" }, embeds: [{ footer: { text: "Guilded session session" } }], edit: vi.fn(async () => message) };
  const channel = { isTextBased: () => true, isThread: () => false, client: { user: { id: "bot" } },
    permissionsFor: vi.fn(() => ({ has: (): boolean => true })), send: vi.fn(async () => message),
    messages: { fetch: vi.fn(async (input: unknown) => typeof input === "string" ? message : new Collection()) } };
  const guild = { channels: { fetch: vi.fn(async () => channel) } };
  const db = { guildSettings: { findUnique: vi.fn(async () => ({ language: "fr" })) },
    activityCore: { findFirst: vi.fn(async () => core), update: vi.fn() },
    activitySession: { findFirst: vi.fn(async () => session), update: vi.fn() } };
  const deliver = (kind = "TEAM_SESSION") => deliverTeamPost(guild as never, db as never, "guild", kind, "session", now);
  return { core, session, message, channel, guild, db, deliver };
}

describe("team Discord delivery", () => {
  it("does not recreate a cancelled or expired session", async () => {
    const f = fixture();
    f.session.status = "CANCELLED";
    await f.deliver();
    f.session.status = "PLANNED";
    f.session.endsAt = now;
    await f.deliver();
    expect(f.channel.send).not.toHaveBeenCalled();
  });
  it("edits existing cancelled posts to remove buttons", async () => {
    const f = fixture();
    f.session.status = "CANCELLED";
    f.session.messageId = "message";
    await f.deliver();
    expect(f.message.edit).toHaveBeenCalledWith(expect.objectContaining({ components: [] }));
    expect(f.channel.send).not.toHaveBeenCalled();
  });
  it("recovers a post sent just before a database-save crash", async () => {
    const f = fixture();
    f.channel.messages.fetch.mockResolvedValue(new Collection([["message", f.message]]));
    await f.deliver();
    expect(f.channel.send).not.toHaveBeenCalled();
    expect(f.message.edit).toHaveBeenCalled();
    expect(f.db.activitySession.update).toHaveBeenCalledWith({ where: { id: "session" }, data: { messageId: "message" } });
  });
  it("does not treat a permission failure as a deleted message", async () => {
    const f = fixture();
    f.session.messageId = "message";
    f.channel.messages.fetch.mockRejectedValue({ code: 50013 });
    await expect(f.deliver()).rejects.toMatchObject({ code: 50013 });
    expect(f.channel.send).not.toHaveBeenCalled();
  });
  it("creates a missing upcoming post with restricted mentions and nonce", async () => {
    const f = fixture();
    await f.deliver();
    expect(f.channel.send).toHaveBeenCalledWith(expect.objectContaining({ nonce: "session", enforceNonce: true, allowedMentions: { parse: [] } }));
    expect(f.db.activitySession.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "session", core: { guildId: "guild" } } }));
  });
  it("drops stale reminders and deduplicates a delivered reminder", async () => {
    const f = fixture();
    f.session.scheduledAt = now;
    await f.deliver("TEAM_REMINDER");
    expect(f.channel.send).not.toHaveBeenCalled();
    f.session.scheduledAt = new Date(now.getTime() + 60_000);
    f.message.embeds[0]!.footer.text = "Guilded reminder session";
    f.channel.messages.fetch.mockResolvedValue(new Collection([["message", f.message]]));
    await f.deliver("TEAM_REMINDER");
    expect(f.channel.send).not.toHaveBeenCalled();
  });
  it("rejects members who cannot see the team's channel", async () => {
    const f = fixture();
    f.channel.permissionsFor.mockReturnValue({ has: () => false });
    await expect(requireTeamChannel(f.guild as never, "channel", {} as never)).rejects.toThrow(/cannot view/);
  });
  it("renders French cards, bounded rosters, and closed-state controls", () => {
    const f = fixture();
    const members = Array.from({ length: 100 }, (_, n) => ({ memberId: String(n), role: "DPS", bench: n > 50, member: { displayName: "A".repeat(60) }, character: { name: "B".repeat(50) } }));
    expect(teamRosterEmbed({ ...f.core, members } as never, true).toJSON().description).toContain("hebdomadaire");
    const card = teamSessionEmbed({ ...f.session, core: { ...f.core, members }, responses: members.map(m => ({ ...m, attendance: "PRESENT", status: "CONFIRMED" })) } as never, true).toJSON();
    expect(card.title).toContain("Prévu");
    const textSize = (card.title?.length ?? 0) + (card.description?.length ?? 0) + (card.footer?.text.length ?? 0)
      + (card.fields ?? []).reduce((sum, f) => sum + f.name.length + f.value.length, 0);
    expect(textSize).toBeLessThan(6000);
    expect(teamSessionButtons({ ...f.session, status: "COMPLETED" } as never, false, now)).toEqual([]);
    expect(teamSessionButtons(f.session as never, true, now)[0]?.components).toHaveLength(5);
  });
});
