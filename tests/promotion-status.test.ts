import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PROMOTION_RULE } from "../src/services/promotion.js";
import { evaluateProgress, formatProgress, promotionAnnouncement, PROMOTION_STATUS_BUTTON, promotionProgressFor } from "../src/services/promotion-status.js";
import { createVoiceTimeTracker, voiceHour } from "../src/services/voice-time.js";
import { commands } from "../src/commands/index.js";

const NOW = new Date("2026-11-20T12:00:00Z");
const days = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const char = (over: Record<string, unknown> = {}) => ({ name: "Amy Smith", displayName: null, guildRankName: "Initiate", guildRankAt: days(1), since: days(8), level: 20, isMain: true, ...over });
const progress = (characters: ReturnType<typeof char>[], voiceMinutes: number, rule = DEFAULT_PROMOTION_RULE) => evaluateProgress({ rule, characters, voiceMinutes, now: NOW });

describe("promotion status", () => {
  it("is ready with a link, 7 days and 3 h of voice; 2 h 59 waits and says so", () => {
    expect(progress([char()], 180).ready).toBe(true);
    const short = progress([char()], 179);
    expect(short.ready).toBe(false);
    expect(formatProgress(short, "en")).toContain("2 h 59 / 3 h");
    expect(formatProgress(progress([char()], 180), "en")).toContain("on the list");
  });
  it("tells an unlinked member how to link, and counts days as 'not in the roster yet' without a roster rank", () => {
    const text = formatProgress(progress([], 200), "fr");
    expect(text).toContain("Prénom Nom");
    expect(text).not.toContain("/character claim");
    expect(text).toContain("pas encore dans le roster");
    expect(progress([], 500).ready).toBe(false);
    expect(text).not.toContain("<#");
    expect(formatProgress(progress([], 200), "fr", "123")).toContain("ou écris-le dans <#123>");
    expect(formatProgress(progress([], 200), "en", "123")).toContain("or type it in <#123>");
  });
  it("shows days left and respects the switches", () => {
    expect(formatProgress(progress([char({ since: days(3) })], 300), "en")).toContain("3 / 7");
    const off = { ...DEFAULT_PROMOTION_RULE, requireLink: false, minVoiceMinutes: 0 };
    expect(progress([char()], 0, off).ready).toBe(true);
    expect(formatProgress(progress([char()], 0, off), "en")).not.toContain("Voice");
  });
  it("members above the starting rank get one line", () => {
    const p = progress([char({ guildRankName: "Member" })], 0);
    expect(p.state).toBe("above");
    expect(formatProgress(p, "en")).toBe("You're already Member. Nothing left to do.");
  });
  it("reads the member's own rows and the last 7 days of voice", async () => {
    const aggregate = vi.fn(async () => ({ _sum: { seconds: 3 * 3600 } }));
    const db = { guildSettings: { findUnique: async () => null }, memberVoiceHour: { aggregate },
      member: { findFirst: async () => ({ characters: [{ name: "Amy Smith", displayName: null, level: 20, guildRankName: "Initiate", guildRankAt: days(1), isMain: true, rankSeen: { since: days(8) } }] }) } } as never;
    const result = await promotionProgressFor(db, "g1", "u1", "forever", NOW);
    expect(result.progress.ready).toBe(true);
    expect((aggregate.mock.calls as unknown as [unknown][])[0]![0]).toMatchObject({ where: { guildId: "g1", userId: "u1" } });
  });
  it("announcement follows the rule and the officer's own wording; the button id is fixed and the commands exist", () => {
    const embed = promotionAnnouncement(DEFAULT_PROMOTION_RULE, "fr", { intro: "Bubble etait seul.", title: "Comment devenir Membre" }).toJSON();
    expect(embed.title).toBe("Comment devenir Membre");
    expect(embed.description).toContain("Bubble etait seul.");
    expect(embed.description).toContain("3 h");
    expect(promotionAnnouncement(DEFAULT_PROMOTION_RULE, "en").toJSON().description).not.toContain("Bubble");
    expect(promotionAnnouncement(DEFAULT_PROMOTION_RULE, "en", { inviteChannelId: "77" }).toJSON().description).toContain("or type it in <#77>");
    expect(PROMOTION_STATUS_BUTTON).toBe("promotion:status");
    expect(commands.map((c) => c.name)).toContain("promotion");
  });
});

describe("raw voice time", () => {
  const state = (id: string, channelId: string | null, bot = false) => [id, { channelId, member: { user: { bot } } }] as const;
  const guild = (states: (readonly [string, unknown])[]) => {
    const map = new Map<string, unknown>(states);
    const cache = Object.assign(map, { filter: (fn: (s: never) => boolean) => new Map([...map.entries()].filter(([, v]) => fn(v as never))) });
    return { id: "d1", afkChannelId: "afk", voiceStates: { cache } } as never;
  };
  it("counts a person alone in a channel, skips the AFK channel, bots and people not connected", async () => {
    const upsert = vi.fn(async () => ({}));
    const tracker = createVoiceTimeTracker({ guild: { findUnique: async () => ({ id: "g1" }) }, memberVoiceHour: { upsert, deleteMany: async () => ({}) } } as never);
    const g = guild([state("solo", "room"), state("sleeper", "afk"), state("bot", "room", true), state("away", null)]);
    const t0 = Date.UTC(2026, 10, 20, 12, 0, 0);
    await tracker.tick(g, t0);
    await tracker.tick(g, t0 + 60_000);
    expect([...tracker.pending.values()]).toEqual([{ guildId: "g1", userId: "solo", hour: voiceHour(t0), seconds: 60 }]);
    await tracker.flush(t0 + 60_000);
    expect(upsert).toHaveBeenCalledTimes(1);
  });
});
