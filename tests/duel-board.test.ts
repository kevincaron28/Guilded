import { beforeEach, describe, expect, it, vi } from "vitest";

const { settingsRow, updateSettings } = vi.hoisted(() => ({
  settingsRow: { current: null as Record<string, unknown> | null }, updateSettings: vi.fn()
}));
vi.mock("../src/database.js", () => ({ prisma: {
  duelResult: { findMany: vi.fn(async () => []) }, discordJob: {}
} }));
vi.mock("../src/services/guild.js", () => ({ createGuildService: () => ({
  ensureGuild: async () => ({ id: "g1", gameEdition: "forever" }), getSettings: async () => settingsRow.current, updateSettings
}) }));
import { DUEL_BOARD_MARKER, duelBoardEmbed, loadDuelBoardData, updateDuelBoard, type DuelBoardData } from "../src/services/duel-board.js";

const row = (name: string, wins: number, losses: number, bestStreak = wins, streak = 1) =>
  ({ memberId: name, name, wins, losses, games: wins + losses, winRate: wins / (wins + losses), streak, bestStreak });
const data = (over: Partial<DuelBoardData> = {}): DuelBoardData => ({ standings: [], duels: 0, recent: [], edition: "forever", ...over });

describe("duel board embed", () => {
  it("shows the French empty state for Québec Gold", () => {
    const json = duelBoardEmbed(data(), "fr", "g1").toJSON();
    expect(json.title).toBe("⚔️ Duels de la guilde");
    expect(json.description).toBe("Aucun duel enregistré — défie un membre de la guilde!");
    expect(json.fields ?? []).toEqual([]);
  });
  it("shows the English empty state", () => {
    expect(duelBoardEmbed(data(), "en").toJSON().description).toBe("No duel recorded yet. Challenge a guild member!");
  });
  it("lists top duelists with wins, losses, win rate and best streak, and the latest duels", () => {
    const json = duelBoardEmbed(data({ duels: 9, standings: [row("Aria", 5, 1, 4, 3), row("Brom", 2, 4, 2, -2)],
      recent: [{ winner: "Aria", loser: "Brom", endedAt: new Date("2026-11-05T12:00:00Z"), reason: "knockout" }, { winner: "Brom", loser: "Cyd", endedAt: new Date("2026-11-05T11:00:00Z"), reason: "retreat" }] }), "fr", "g1").toJSON();
    expect(json.description).toContain("🥇 Aria — 5V 1D · 83% · meilleure série 4 · W3");
    expect(json.description).toContain("🥈 Brom — 2V 4D · 33% · meilleure série 2 · L2");
    expect(json.fields?.[0]?.name).toBe("Derniers duels");
    expect(json.fields?.[0]?.value).toContain("<t:1793880000:R> · **Aria** bat Brom");
    expect(json.fields?.[0]?.value).toContain("gagne (adversaire en fuite) contre Cyd");
    expect(json.footer?.text).toContain("9 duels comptés");
    expect(json.footer?.text?.startsWith(`${DUEL_BOARD_MARKER} • g1 •`)).toBe(true);
  });
  it("caps the board at ten names and escapes markdown", () => {
    const many = Array.from({ length: 14 }, (_, i) => row(i === 0 ? "**Bold**" : `P${i}`, 20 - i, 1));
    const lines = duelBoardEmbed(data({ standings: many, duels: 100 }), "en").toJSON().description!.split("\n");
    expect(lines).toHaveLength(10);
    expect(lines[0]).toContain("\\*\\*Bold\\*\\*");
  });
  it("never mixes battleground numbers into the duel ladder (they have their own board)", () => {
    expect(duelBoardEmbed(data({ standings: [row("A", 1, 0)] }), "en").toJSON().fields ?? []).toEqual([]);
  });
});

describe("duel board data", () => {
  it("builds standings from counted duels only", async () => {
    const findMany = vi.fn()
      .mockResolvedValueOnce([{ winnerId: "a", loserId: "b", winnerCharacter: "Aria", loserCharacter: "Brom" }])
      .mockResolvedValueOnce([{ winnerCharacter: "Aria", loserCharacter: "Brom", endedAt: new Date(), reason: "knockout" }]);
    const result = await loadDuelBoardData({ duelResult: { findMany } } as never, "g1", "forever");
    expect(result.standings[0]).toMatchObject({ name: "Aria", wins: 1 });
    expect(result.recent).toHaveLength(1);
    expect((findMany.mock.calls as unknown as [[{ where: { counted: boolean } }]])[0][0].where.counted).toBe(true);
  });
});

function channel(messages: Record<string, unknown>) {
  const sent = { id: "new", editable: true, author: { id: "bot" }, embeds: [] };
  return {
    isTextBased: () => true, send: vi.fn(async () => sent),
    messages: { fetch: vi.fn(async (arg: unknown) => {
      if (typeof arg === "string") { if (messages[arg]) return messages[arg]; throw new Error("Unknown Message"); }
      return { find: (fn: (m: unknown) => boolean) => Object.values(messages).find(fn) };
    }) }
  };
}
const guildWith = (ch: ReturnType<typeof channel>) => ({ id: "d1", name: "QG", client: { user: { id: "bot" } }, channels: { fetch: vi.fn(async () => ch) } }) as never;

describe("updateDuelBoard (delivery)", () => {
  beforeEach(() => { vi.clearAllMocks(); settingsRow.current = { duelBoardEnabled: true, duelBoardChannelId: "c1", duelBoardMessageId: "m1", language: "fr" }; });

  it("edits the saved message in place and never posts a new one", async () => {
    const edit = vi.fn(async (payload: unknown) => payload);
    const ch = channel({ m1: { id: "m1", editable: true, author: { id: "bot" }, embeds: [], edit } });
    expect(await updateDuelBoard(guildWith(ch), true)).toBe(true);
    expect(edit).toHaveBeenCalledTimes(1);
    expect(ch.send).not.toHaveBeenCalled();
    expect(updateSettings).not.toHaveBeenCalled();
    const embed = (edit.mock.calls[0]![0] as { embeds: { toJSON(): { description: string } }[] }).embeds[0]!.toJSON();
    expect(embed.description).toBe("Aucun duel enregistré — défie un membre de la guilde!");
  });

  it("adopts an existing bot board when the saved id is gone, instead of posting a duplicate", async () => {
    const edit = vi.fn(async () => ({ id: "old" }));
    const old = { id: "old", editable: true, author: { id: "bot" }, embeds: [{ footer: { text: `${DUEL_BOARD_MARKER} • g1 • x` } }], edit };
    const ch = channel({ old });
    expect(await updateDuelBoard(guildWith(ch), true)).toBe(true);
    expect(edit).toHaveBeenCalled();
    expect(ch.send).not.toHaveBeenCalled();
    expect(updateSettings).toHaveBeenCalledWith("g1", { duelBoardMessageId: "old" });
  });

  it("posts once and remembers the id when no board exists", async () => {
    const ch = channel({});
    expect(await updateDuelBoard(guildWith(ch), true)).toBe(true);
    expect(ch.send).toHaveBeenCalledTimes(1);
    expect(updateSettings).toHaveBeenCalledWith("g1", { duelBoardMessageId: "new" });
  });

  it("moves the board to the duel channel and deletes only its own old copy in the statistics channel", async () => {
    settingsRow.current = { duelBoardEnabled: true, duelBoardChannelId: "duels", bgStatsChannelId: "stats", duelBoardMessageId: "oldmsg", language: "en" };
    const del = vi.fn(async () => ({}));
    const oldCopy = { id: "oldmsg", editable: true, author: { id: "bot" }, embeds: [{ footer: { text: `${DUEL_BOARD_MARKER} • g1 • x` } }], delete: del };
    const stranger = { id: "oldmsg", author: { id: "person" }, embeds: [{ footer: { text: `${DUEL_BOARD_MARKER} • g1 • x` } }], delete: vi.fn() };
    const duels = channel({}), stats = channel({ oldmsg: oldCopy });
    const guild = { id: "d1", name: "QG", client: { user: { id: "bot" } }, channels: { fetch: vi.fn(async (id: string) => id === "duels" ? duels : stats) } } as never;
    expect(await updateDuelBoard(guild, true)).toBe(true);
    expect(duels.send).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledTimes(1);
    const other = channel({ oldmsg: stranger });
    const guild2 = { id: "d1", name: "QG", client: { user: { id: "bot" } }, channels: { fetch: vi.fn(async (id: string) => id === "duels" ? channel({}) : other) } } as never;
    await updateDuelBoard(guild2, true);
    expect(stranger.delete).not.toHaveBeenCalled();
  });

  it("does nothing unless the server opted in and has the duel ladder channel", async () => {
    const ch = channel({});
    settingsRow.current = { duelBoardEnabled: false, duelBoardChannelId: "c1" };
    expect(await updateDuelBoard(guildWith(ch), true)).toBe(false);
    settingsRow.current = { duelBoardEnabled: true, duelBoardChannelId: null };
    expect(await updateDuelBoard(guildWith(ch), true)).toBe(false);
    expect(ch.send).not.toHaveBeenCalled();
  });
});
