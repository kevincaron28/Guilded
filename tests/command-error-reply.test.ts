import { describe, expect, it, vi } from "vitest";

vi.mock("../src/database.js", () => ({ prisma: {} }));
const { replyWithCommandError } = await import("../src/commands/context.js");


function interaction() {
  return {
    commandName: "x", guildId: "g", user: { id: "u" }, client: {},
    options: { getSubcommandGroup: () => null, getSubcommand: () => null },
    deferred: false, replied: false, reply: vi.fn()
  };
}

describe("replyWithCommandError", () => {
  it("shows a member's own mistake as is", async () => {
    const i = interaction();
    await replyWithCommandError(i as never, new Error("Link a character first."));
    expect(i.reply.mock.calls[0]![0].content).toBe("Link a character first.");
  });

  it("never shows the message of an unexpected error", async () => {
    const i = interaction();
    vi.spyOn(console, "error").mockImplementation(() => {});
    class DatabaseFailure extends Error {}
    await replyWithCommandError(i as never, new DatabaseFailure("connect ECONNREFUSED 10.0.0.5:5432 password=hunter2"));
    expect(i.reply.mock.calls[0]![0].content).toBe("The command could not be completed. Please try again or contact an officer.");
  });
});
