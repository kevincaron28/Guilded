import { describe, expect, it, vi, beforeEach } from "vitest";
import { battlegroundPrivacyHelp, battlegroundRecordPanel, battlegroundResultCard, battlegroundSetupHelp } from "../src/commands/battleground-record-ui.js";

const mocks = vi.hoisted(() => ({
  consent: vi.fn(), history: vi.fn(), correct: vi.fn(), stats: vi.fn(), context: vi.fn(),
  officer: vi.fn(), language: vi.fn(), season: vi.fn(), guild: vi.fn(),
}));
vi.mock("../src/database.js", () => ({ prisma: { officialSeason: { findFirst: mocks.season }, guild: { findUniqueOrThrow: mocks.guild } } }));
vi.mock("../src/commands/context.js", () => ({ requireGuildContext: mocks.context }));
vi.mock("../src/permissions.js", () => ({ hasPermission: mocks.officer }));
vi.mock("../src/services/activity-core-discord.js", () => ({ teamLanguage: mocks.language, requireTeamChannel: vi.fn(), teamSessionEmbed: vi.fn() }));
vi.mock("../src/services/battleground-records.js", () => ({ setBattlegroundConsent: mocks.consent, battlegroundHistory: mocks.history, correctBattlegroundReport: mocks.correct, battlegroundStats: mocks.stats }));
import { battlegroundCommand, executeBattleground, handleBattlegroundComponent } from "../src/commands/battleground.js";
import { runInGuildScope } from "../src/services/guild-scope.js";

const report = { id: "db-report", reportId: "durable-report", gameEdition: "forever", mode: "casual", mapId: 30,
  bracket: "6", endedAt: new Date("2026-11-05T20:30:00Z"), outcome: "WIN", presence: "FULL", status: "PROVISIONAL", correctionReason: null };
function interaction(sub: string, values: Record<string, unknown> = {}) {
  return { isChatInputCommand: () => true, user: { id: "discord-member" },
    guild: { members: { fetch: vi.fn().mockResolvedValue({ id: "discord-member" }) } },
    options: { getSubcommand: () => sub, getString: (k: string) => values[k] ?? null,
      getInteger: (k: string) => values[k] ?? null, getBoolean: (k: string) => values[k] ?? null },
    deferReply: vi.fn(), editReply: vi.fn(), reply: vi.fn() };
}
beforeEach(() => { vi.clearAllMocks(); mocks.context.mockResolvedValue({ guildId: "scoped-guild", memberId: "own-member" }); mocks.language.mockResolvedValue(false); mocks.history.mockResolvedValue([report]); mocks.officer.mockReturnValue(false); });

describe("private BG records navigation", () => {
  it("keeps both languages within Discord command/component limits and binds controls to guild", () => {
    expect(battlegroundCommand.toJSON().options!.length).toBeLessThanOrEqual(25);
    for (const fr of [false, true]) {
      const buttons = battlegroundRecordPanel(fr, "original-guild").toJSON().components;
      expect(buttons).toHaveLength(4);
      for (const button of buttons) expect("custom_id" in button && button.custom_id).toMatch(/^bgui:original-guild:/);
      expect(battlegroundPrivacyHelp(fr).length).toBeLessThan(1600);
      expect(battlegroundSetupHelp(fr).length).toBeLessThan(2000);
    }
  });
  it("cards mark evidence provisional and escape correction text without manufacturing a result", () => {
    for (const fr of [false, true]) {
      const card = battlegroundResultCard({ ...report, correctionReason: "@everyone **bad**" }, fr).toJSON();
      expect(card.fields!.find(x => x.value === "PROVISIONAL")).toBeTruthy();
      expect(JSON.stringify(card)).not.toContain("@everyone");
      expect(card.description).toContain("<t:");
      expect(card.description).toMatch(/API.*6/);
      expect(card.footer?.text).toMatch(/competitive|compétitif/);
    }
  });
  it("uses fresh membership and an exact self-only lookup for old report IDs", async () => {
    const i = interaction("result", { report: "durable-report" });
    await executeBattleground(i as never);
    expect(i.guild.members.fetch).toHaveBeenCalledWith({ user: "discord-member", force: true });
    expect(mocks.history).toHaveBeenCalledWith(expect.anything(), "scoped-guild", "own-member", "durable-report");
    expect(i.deferReply).toHaveBeenCalledWith({ flags: 64 });
    expect(i.editReply.mock.calls[0]![0]).toMatchObject({ allowedMentions: { parse: [] } });
  });
  it("never renders a missing or foreign report", async () => {
    mocks.history.mockResolvedValue([]);
    const i = interaction("result", { report: "foreign" });
    await expect(executeBattleground(i as never)).rejects.toThrow(/Own report not found/);
    expect(i.editReply).not.toHaveBeenCalled();
  });
  it("denies a member whose scoped role was removed before the fresh fetch", async () => {
    const i = interaction("history");
    i.guild.members.fetch.mockResolvedValue({ id: "discord-member", permissions: { has: () => false }, roles: { cache: new Map() } });
    await expect(runInGuildScope({ guild: { id: "scoped-guild" } as never, memberRoleId: "required-role" }, () => executeBattleground(i as never))).rejects.toThrow(/Current guild member role required/);
    expect(mocks.history).not.toHaveBeenCalled();
  });
  it("persists only explicit privacy choices for the authenticated member", async () => {
    const i = interaction("privacy", { capture: false, "guild-stats": false });
    await executeBattleground(i as never);
    expect(mocks.consent).toHaveBeenCalledWith(expect.anything(), "scoped-guild", "own-member", { capture: false, guildStats: false });
  });
  it("withdraws only the caller's report through the scoped correction service", async () => {
    const i = interaction("correct", { report: "db-report", reason: "Wrong match" });
    await executeBattleground(i as never);
    expect(mocks.correct).toHaveBeenCalledWith(expect.anything(), "scoped-guild", "own-member", "db-report", "Wrong match");
  });
  it("refuses setup to ordinary members without mutating any Discord configuration", async () => {
    await expect(executeBattleground(interaction("setup") as never)).rejects.toThrow(/Officer required/);
    expect(mocks.consent).not.toHaveBeenCalled();
    mocks.officer.mockReturnValue(true);
    const i = interaction("setup"); await executeBattleground(i as never);
    expect(i.editReply.mock.calls[0]![0].content).toContain("changes no channels");
  });
  it("does not present provisional evidence as a zero percent verified win rate", async () => {
    mocks.guild.mockResolvedValue({ gameEdition: "forever" });
    mocks.season.mockResolvedValueOnce({ number: 1, startsAt: new Date("2026-01-01") }).mockResolvedValueOnce(null);
    mocks.stats.mockResolvedValue({ matches: 0, participations: 7, wins: 0, losses: 0, draws: 0, unknownOutcomes: 7, winRate: null, provisionalReports: 7 });
    const i = interaction("stats", { mode: "casual", bracket: "6" }); await executeBattleground(i as never);
    expect(mocks.stats.mock.calls[0]![2]).toMatchObject({ edition: "forever", mode: "casual", bracket: "6" });
    const embed = i.editReply.mock.calls[0]![0].embeds[0].toJSON();
    expect(embed.fields.find((x: { name: string }) => x.name === "Reported win rate").value).toBe("—");
    expect(embed.fields.find((x: { name: string }) => x.name === "Player participations (not unique matches)").value).toBe("7");
    expect(embed.fields.find((x: { name: string }) => x.name === "Verified unique matches").value).toMatch(/Unavailable/);
  });
  it("history buttons run the same scoped ephemeral command path", async () => {
    const i = { ...interaction("history"), customId: "bgui:scoped-guild:history", isChatInputCommand: () => false, isModalSubmit: () => false, isButton: () => true };
    await handleBattlegroundComponent(i as never);
    expect(mocks.history).toHaveBeenCalledWith(expect.anything(), "scoped-guild", "own-member", undefined);
    expect(i.deferReply).toHaveBeenCalledWith({ flags: 64 });
  });
  it("stats navigation asks for one format and bracket without mixing reports", async () => {
    const i = { ...interaction("stats"), customId: "bgui:scoped-guild:stats", isChatInputCommand: () => false, isModalSubmit: () => false, isButton: () => true };
    await handleBattlegroundComponent(i as never);
    expect(mocks.stats).not.toHaveBeenCalled();
    expect(i.editReply.mock.calls[0]![0].content).toContain("Formats and brackets are never mixed");
    expect(i.editReply.mock.calls[0]![0].content).toContain("not a verified level range");
    expect(i.editReply.mock.calls[0]![0].content).not.toContain("10-19");
  });
  it("makes conflicts reviewable without enabling mentions or unbounded text", () => {
    const card = battlegroundResultCard({ ...report, conflictSummary: "@everyone outcome: WIN → LOSS " + "x".repeat(700) }, false).toJSON();
    const conflict = card.fields!.find(x => x.name === "Conflict to review")!;
    expect(conflict.value).toContain("WIN → LOSS");
    expect(conflict.value).not.toContain("@everyone");
    expect(conflict.value.length).toBeLessThanOrEqual(600);
  });
  it("labels reported outcomes and displays their rate against the known-outcome sample", async () => {
    mocks.guild.mockResolvedValue({ gameEdition: "forever" });
    mocks.season.mockResolvedValueOnce({ number: 1, startsAt: new Date("2026-01-01") }).mockResolvedValueOnce(null);
    mocks.stats.mockResolvedValue({ matches: 0, participations: 3, wins: 1, losses: 1, draws: 0, unknownOutcomes: 1, winRate: 0.5, provisionalReports: 3 });
    const i = interaction("stats", { mode: "casual", bracket: "6" }); await executeBattleground(i as never);
    const embed = i.editReply.mock.calls[0]![0].embeds[0].toJSON();
    expect(embed.title).toBe("Provisional guild participation reports");
    expect(embed.fields.find((x: { name: string }) => x.name === "Reported win rate").value).toBe("50.0%");
    expect(embed.fields.find((x: { name: string }) => x.name === "Known-outcome sample / unknown").value).toBe("2 / 1");
  });
});
