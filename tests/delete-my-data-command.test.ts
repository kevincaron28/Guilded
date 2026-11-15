/* eslint-disable @typescript-eslint/no-explicit-any -- a small fake of a Discord interaction */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ deleteMyData: vi.fn(async () => ({ members: 2, characters: 3, account: true })) }));
vi.mock("../src/services/data-deletion.js", () => ({ deleteMyData: mocks.deleteMyData }));
vi.mock("../src/database.js", () => ({ prisma: {} }));

import { deleteMyDataCommand, executeDeleteMyData } from "../src/commands/delete-my-data.js";

function interaction(choice: string | null, over: Record<string, unknown> = {}) {
  const replies: any[] = [];
  const message = { awaitMessageComponent: vi.fn(async ({ filter }: any) => {
    if (!choice) throw new Error("timeout");
    const component = { user: { id: "u1" }, customId: choice, deferUpdate: vi.fn(async () => undefined) };
    expect(filter(component)).toBe(true);
    expect(filter({ ...component, user: { id: "someone-else" } })).toBe(false);
    return component;
  }) };
  return { replies, value: { id: "i1", locale: "en-US", user: { id: "u1" }, deferReply: vi.fn(async () => undefined), editReply: vi.fn(async (r: any) => { replies.push(r); }), fetchReply: vi.fn(async () => message), ...over } as any };
}

describe("/delete-my-data", () => {
  beforeEach(() => mocks.deleteMyData.mockClear());
  it("is its own command with a French description and no options", () => {
    const json = deleteMyDataCommand.toJSON();
    expect(json.name).toBe("delete-my-data");
    expect(json.description_localizations?.fr).toBeTruthy();
    expect(json.options ?? []).toHaveLength(0);
  });
  it("previews first and deletes only the asker's data after the confirm button", async () => {
    const { value, replies } = interaction("deletemydata:i1:yes");
    await executeDeleteMyData(value);
    expect(replies[0].content).toContain("nothing has been deleted yet");
    expect(mocks.deleteMyData).toHaveBeenCalledTimes(1);
    expect((mocks.deleteMyData.mock.calls[0] as unknown[])[1]).toBe("u1");
    expect(replies.at(-1).content).toContain("Your data was deleted");
  });
  it("deletes nothing when cancelled or when nobody answers", async () => {
    for (const choice of ["deletemydata:i1:no", null]) {
      const { value, replies } = interaction(choice);
      await executeDeleteMyData(value);
      expect(replies.at(-1).content).toContain("Nothing was deleted");
    }
    expect(mocks.deleteMyData).not.toHaveBeenCalled();
  });
  it("answers in French for a French client and says so when the deletion fails", async () => {
    mocks.deleteMyData.mockRejectedValueOnce(new Error("db"));
    const { value, replies } = interaction("deletemydata:i1:yes", { locale: "fr" });
    await executeDeleteMyData(value);
    expect(replies[0].content).toContain("rien n’a été supprimé");
    expect(replies.at(-1).content).toContain("n’a pas pu être effectuée");
  });
});

import { gateOutcome, skipsGuildScope } from "../src/services/interaction-gate.js";
import { tierDenial, ALWAYS_ALLOWED_COMMANDS, liteCommandJson } from "../src/commands/lite.js";
import { commands } from "../src/commands/index.js";

describe("/delete-my-data in every tier", () => {
  it("is never refused by the tier gate, also for blocked and Lite servers", () => {
    for (const tier of ["approved", "lite", "blocked"]) expect(tierDenial(tier, "delete-my-data", null, null)).toBeNull();
    expect(tierDenial("blocked", "report", null, "bug")).toBe("blocked");
    expect(tierDenial("lite", "raid", null, "create")).toBe("lite");
    expect(tierDenial("lite", "report", null, "bug")).toBeNull();
  });
  it("is in the Lite command set", () => {
    expect((liteCommandJson(commands) as { name: string }[]).some(c => c.name === "delete-my-data")).toBe(true);
    expect(ALWAYS_ALLOWED_COMMANDS).toContain("delete-my-data");
  });
  // The global handler in main.ts asks these functions before replying or checking the member role.
  const click = (customId: string) => ({ customId });
  const slash = (commandName: string) => ({ commandName, options: { getSubcommandGroup: () => null, getSubcommand: () => null } });
  it("leaves the confirm and cancel clicks to the command's collector in every tier, with no denial and no role check", async () => {
    for (const tier of ["approved", "lite", "blocked"]) for (const id of ["deletemydata:i1:yes", "deletemydata:i1:no"]) {
      expect(gateOutcome(tier, click(id), false)).toBe("collector");
      expect(skipsGuildScope(click(id))).toBe(true);
    }
    expect(skipsGuildScope(slash("delete-my-data"))).toBe(true);
    expect(skipsGuildScope(slash("raid"))).toBe(false);
    expect(gateOutcome("blocked", click("other:button"), false)).toBe("blocked");
    expect(gateOutcome("blocked", slash("delete-my-data"), true)).toBeNull();
    expect(gateOutcome("blocked", slash("raid"), true)).toBe("blocked");
  });
  it("a click in a blocked server deletes once: the handler stays silent and the collector runs the service", async () => {
    mocks.deleteMyData.mockClear();
    const { value } = interaction("deletemydata:i1:yes");
    expect(gateOutcome("blocked", click("deletemydata:i1:yes"), false)).toBe("collector");
    await executeDeleteMyData(value);
    expect(mocks.deleteMyData).toHaveBeenCalledTimes(1);
  });
  it("reports a failed acknowledgement instead of throwing", async () => {
    mocks.deleteMyData.mockClear();
    const errors: unknown[] = [];
    const message = { awaitMessageComponent: vi.fn(async () => ({ user: { id: "u1" }, customId: "deletemydata:i1:yes", deferUpdate: vi.fn(async () => { throw new Error("already acknowledged"); }) })) };
    const { value } = interaction(null, { fetchReply: vi.fn(async () => message) });
    await executeDeleteMyData(value, error => errors.push(error));
    expect(errors).toHaveLength(1);
    expect(mocks.deleteMyData).not.toHaveBeenCalled();
  });
});
