import { describe, expect, it, vi } from "vitest";
import { Collection, EmbedBuilder } from "discord.js";
import { cleanupRaidAlerts, isExpiredRaidAlert } from "../src/services/raid-alert-cleanup.js";

const now = new Date("2026-10-03T16:00:00Z");
const past = Math.floor(new Date("2026-10-02T00:00:00Z").getTime() / 1000);
const alert = (content: string) => ({ author: { id: "bot" }, pinned: false, createdTimestamp: past * 1000 - 3600000,
  content, embeds: [], components: [], attachments: new Collection() });
const expired = (message: unknown) => isExpiredRaidAlert(message as never, "bot", now);

describe("old raid alert cleanup", () => {
  it.each([
    `⏰ **MC** starts <t:${past}:R>. See you there: <@123>`,
    `⏰ **MC** commence <t:${past}:R>. On vous attend : <@123>`,
    `📣 **Players wanted: MC** (Core), <t:${past}:F> (<t:${past}:R>)`,
    `📣 **Joueurs recherchés : MC** (Core), <t:${past}:F> (<t:${past}:R>)`
  ])("recognizes an expired bilingual reminder or recruitment call", content => {
    expect(expired(alert(content))).toBe(true);
    expect(expired({ ...alert(content), pinned: true })).toBe(false);
    expect(expired({ ...alert(content), author: { id: "member" } })).toBe(false);
    expect(expired({ ...alert(content), createdTimestamp: now.getTime() })).toBe(false);
  });

  it("keeps upcoming raids, reports, panels and attachments", () => {
    expect(expired(alert(`⏰ **MC** starts <t:${Math.floor(now.getTime() / 1000) + 86400}:R>.`))).toBe(false);
    expect(expired(alert("An unrelated announcement"))).toBe(false);
    const embed = new EmbedBuilder().setDescription("⚔️ Raid started: **MC**");
    const message = { ...alert(""), embeds: [embed.toJSON()] };
    // Discord Message embeds expose an empty fields array.
    const notice = { ...message, embeds: [{ ...embed.toJSON(), fields: [] }] };
    expect(expired(notice)).toBe(true);
    expect(expired({ ...notice, embeds: [{ ...notice.embeds[0], title: "Raid report" }] })).toBe(false);
    expect(expired({ ...notice, components: [{}] })).toBe(false);
    expect(expired({ ...notice, attachments: new Map([["file", {}]]) })).toBe(false);
    expect(expired({ ...notice, embeds: [{ ...notice.embeds[0], description: "🏁 Raid terminé : **MC**", footer: { text: "Guilded delivery abc123" } }] })).toBe(true);
  });

  it("deletes only recognized expired bot alerts in configured channels", async () => {
    const remove = vi.fn();
    const keep = vi.fn();
    const messages = new Collection([
      ["old", { ...alert(`⏰ **MC** starts <t:${past}:R>.`), id: "old", delete: remove }],
      ["member", { ...alert(`⏰ **MC** starts <t:${past}:R>.`), author: { id: "member" }, id: "member", delete: keep }]
    ]);
    const fetch = vi.fn(async (id: string) => { expect(["shared", "core"]).toContain(id); return { isTextBased: () => true, messages: { fetch: vi.fn(async () => messages) } }; });
    const client = { user: { id: "bot" }, guilds: { cache: new Map([["guild", { channels: { fetch } }]]) } };
    const database = { guild: { findMany: vi.fn(async () => [{ discordId: "guild", settings: { notifyChannelId: "shared", raidSignupChannelId: "shared" }, raidCores: [{ signupChannelId: "core" }] }]) } };
    expect(await cleanupRaidAlerts(client as never, database as never, now)).toBe(2);
    expect(fetch.mock.calls.map(call => call[0])).toEqual(["shared", "core"]);
    expect(remove).toHaveBeenCalledTimes(2);
    expect(keep).not.toHaveBeenCalled();
  });
});
