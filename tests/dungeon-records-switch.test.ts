import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ officer: true, language: "en" }));
const update = vi.hoisted(() => vi.fn<(arg?: unknown) => Promise<object>>(async () => ({})));
const record = vi.hoisted(() => vi.fn<(arg?: unknown) => Promise<object>>(async () => ({})));
vi.mock("../src/database.js", () => ({ prisma: { guildSettings: { update } } }));
vi.mock("../src/services/audit.js", () => ({ createAuditService: () => ({ record }) }));
vi.mock("../src/permissions.js", () => ({ hasPermission: () => state.officer }));
vi.mock("../src/commands/context.js", () => ({
  requireGuildContext: async () => ({ guildId: "g1", memberId: "m1" }),
  guildService: { getSettings: async () => ({ language: state.language }) }
}));

import { executeDungeon } from "../src/commands/dungeon.js";

function interaction(options: Record<string, boolean | null>) {
  const reply = vi.fn(async () => undefined);
  return { reply, value: {
    member: {}, user: { id: "u1" },
    options: { getSubcommand: () => "records", getBoolean: (name: string) => options[name] ?? null, getString: () => null },
    reply
  } as never };
}

beforeEach(() => { update.mockClear(); record.mockClear(); state.officer = true; state.language = "en"; });

describe("/dungeon records switches for officers", () => {
  it("applies both switches when both are given, and records the change", async () => {
    const { value, reply } = interaction({ announce: false, "other-guilds": false });
    await executeDungeon(value);
    expect(update).toHaveBeenCalledWith({ where: { guildId: "g1" }, data: { dungeonHighlightsEnabled: false, crossGuildRuns: false } });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ guildId: "g1", actorId: "u1", metadata: expect.objectContaining({ announce: false, otherGuilds: false }) }));
    const text = (reply.mock.calls[0] as unknown as [{ content: string }])[0].content;
    expect(text).toContain("no longer called out");
    expect(text).toContain("no longer receive");
  });

  it("changes only the sharing switch when only that is given, in French when the server speaks French", async () => {
    state.language = "fr";
    const { value, reply } = interaction({ "other-guilds": true });
    await executeDungeon(value);
    expect(update).toHaveBeenCalledWith({ where: { guildId: "g1" }, data: { crossGuildRuns: true } });
    expect((reply.mock.calls[0] as unknown as [{ content: string }])[0].content).toContain("d'autres guildes");
  });

  it("refuses members", async () => {
    state.officer = false;
    const { value } = interaction({ "other-guilds": false });
    await expect(executeDungeon(value)).rejects.toThrow(/Officers only/);
    expect(update).not.toHaveBeenCalled();
  });
});
