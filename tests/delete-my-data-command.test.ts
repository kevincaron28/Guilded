/* eslint-disable @typescript-eslint/no-explicit-any -- a small fake of a Discord interaction */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ deleteMyData: vi.fn(async () => ({ members: 2, characters: 3, account: true })) }));
vi.mock("../src/services/data-deletion.js", () => ({ deleteMyData: mocks.deleteMyData }));
vi.mock("../src/database.js", () => ({ prisma: {} }));

import { executeDeleteMyData } from "../src/commands/delete-my-data.js";
import { characterCommand } from "../src/commands/character.js";

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
  it("is /character privacy action:delete (was its own command)", () => {
    const privacy = characterCommand.toJSON().options?.find((option) => option.name === "privacy") as unknown as { options: { choices: { value: string }[] }[] };
    expect(privacy.options[0]!.choices.map((choice) => choice.value)).toContain("delete");
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

// Commands restructure (November 2026): /delete-my-data is now /character privacy action:delete.
describe("/character privacy (was /delete-my-data) in every tier", () => {
  it("is never refused by the tier gate, also for blocked and Lite servers", () => {
    for (const tier of ["approved", "lite", "blocked"]) expect(tierDenial(tier, "character", null, "privacy")).toBeNull();
    expect(tierDenial("lite", "character", null, "add")).toBe("lite");
    expect(tierDenial("lite", "character", "profession", "privacy")).toBe("lite");
    expect(tierDenial("blocked", "report", null, "bug")).toBe("blocked");
    expect(tierDenial("lite", "raid", null, "create")).toBe("lite");
    expect(tierDenial("lite", "report", null, "bug")).toBeNull();
  });
  it("is in the Lite command set", () => {
    const lite = liteCommandJson(commands) as { name: string; options?: { name: string; options?: { name: string; choices?: { value: string }[] }[] }[] }[];
    const character = lite.find(c => c.name === "character");
    expect(character?.options?.map(o => o.name)).toEqual(["privacy"]);
    expect(character?.options?.[0]?.options?.[0]?.choices?.map(c => c.value)).toContain("delete");
    expect(lite.some(c => c.name === "delete-my-data")).toBe(false);
    expect(ALWAYS_ALLOWED_COMMANDS).toContain("character privacy");
  });
  // The global handler in main.ts asks these functions before replying or checking the member role.
  const click = (customId: string, button = true) => ({ customId, isButton: () => button });
  const slash = (commandName: string, sub: string | null = null) => ({ commandName, options: { getSubcommandGroup: () => null, getSubcommand: () => sub } });
  it("leaves the confirm and cancel clicks to the command's collector in every tier, with no denial and no role check", async () => {
    for (const tier of ["approved", "lite", "blocked"]) for (const id of ["deletemydata:i1:yes", "deletemydata:i1:no"]) {
      expect(gateOutcome(tier, click(id), false)).toBe("collector");
      expect(skipsGuildScope(click(id))).toBe(true);
    }
    expect(skipsGuildScope(slash("character", "privacy"))).toBe(true);
    expect(skipsGuildScope(slash("character", "add"))).toBe(false);
    expect(skipsGuildScope(slash("raid"))).toBe(false);
    expect(gateOutcome("blocked", click("other:button"), false)).toBe("blocked");
    // A modal or select menu with the same prefix is not one of our buttons.
    expect(skipsGuildScope(click("deletemydata:i1:yes", false))).toBe(false);
    expect(gateOutcome("blocked", click("deletemydata:i1:yes", false), false)).toBe("blocked");
    expect(gateOutcome("blocked", slash("character", "privacy"), true)).toBeNull();
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
  it("main.ts asks the gate before the member-role check and the tier block", () => {
    const main = readFileSync("src/main.ts", "utf8");
    // The deletion keeps its error report, and a stale /delete-my-data call says where it went.
    expect(main).toContain('executeDeleteMyData(interaction, error => reportInteractionError("Delete my data"');
    expect(main).toContain("handlers.set(name, retiredHandler(name))");
    expect(main).toContain("skipsGuildScope(interaction)");
    expect(main).toContain("gateOutcome(tier, interaction");
    expect(main).toMatch(/denial === "collector"\) return/);
  });
  it("a dead token cannot throw from the cancel or failure paths", async () => {
    const dead = vi.fn(async () => { throw new Error("Unknown interaction"); });
    const message = { awaitMessageComponent: vi.fn(async () => ({ user: { id: "u1" }, customId: "deletemydata:i1:no", deferUpdate: dead })) };
    const first = interaction(null, { fetchReply: vi.fn(async () => message) });
    await expect(executeDeleteMyData(first.value)).resolves.toBeUndefined();
    mocks.deleteMyData.mockRejectedValueOnce(new Error("db"));
    let calls = 0;
    const second = interaction("deletemydata:i1:yes", { editReply: vi.fn(async () => { if (++calls > 1) throw new Error("Invalid Webhook Token"); }) });
    await expect(executeDeleteMyData(second.value)).resolves.toBeUndefined();
  });
});
