import { beforeEach, describe, expect, it, vi } from "vitest";
const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("../src/database.js", () => ({ prisma: { character: { findMany } } }));
import { pickSignupCharacter } from "../src/commands/signup-character-picker.js";

describe("private signup character selection", () => {
  beforeEach(() => vi.clearAllMocks());
  const character = (id: number) => ({ id: String(id), name: `Char${id}`, realm: "Quebec", className: "Mage" });
  function interaction(choices: unknown[] = [], acknowledged = false) {
    const message = { id: "private", awaitMessageComponent: vi.fn() };
    for (const choice of choices) message.awaitMessageComponent.mockResolvedValueOnce(choice);
    message.awaitMessageComponent.mockRejectedValue(new Error("expired"));
    return { user: { id: "owner" }, deferred: acknowledged, replied: false,
      deferReply: vi.fn().mockResolvedValue(undefined), editReply: vi.fn().mockResolvedValue(message),
      followUp: vi.fn().mockResolvedValue(message), webhook: { editMessage: vi.fn().mockResolvedValue(undefined) }, message };
  }
  it("acknowledges before querying and selects a sole owned character", async () => {
    const i = interaction();
    findMany.mockImplementation(async () => { expect(i.deferReply).toHaveBeenCalledWith({ ephemeral: true }); return [character(1)]; });
    expect(await pickSignupCharacter(i as never, "guild", "member")).toEqual(character(1));
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { memberId: "member", member: { guildId: "guild" } } }));
  });
  it("pages beyond 25 choices and only accepts the initiating user's private components", async () => {
    findMany.mockResolvedValue(Array.from({ length: 27 }, (_, id) => character(id)));
    const next = { customId: "signupchar:next", isStringSelectMenu: () => false, update: vi.fn() };
    const selected = { customId: "signupchar:choose", values: ["26"], isStringSelectMenu: () => true, update: vi.fn() };
    const i = interaction([next, selected], true);
    expect(await pickSignupCharacter(i as never, "guild", "member")).toEqual(character(26));
    expect(i.deferReply).not.toHaveBeenCalled();
    expect(i.followUp).toHaveBeenCalledWith(expect.objectContaining({ ephemeral: true }));
    const menu = next.update.mock.calls[0]![0].components[0].toJSON();
    expect(menu.components[0].options.map((o: { value: string }) => o.value)).toEqual(["25", "26"]);
    const filter = i.message.awaitMessageComponent.mock.calls[0]![0].filter;
    expect(filter({ user: { id: "intruder" }, customId: "signupchar:choose" })).toBe(false);
    expect(filter({ user: { id: "owner" }, customId: "signupchar:choose" })).toBe(true);
  });
  it("expires without selecting a default character", async () => {
    findMany.mockResolvedValue([character(1), character(2)]);
    const i = interaction();
    expect(await pickSignupCharacter(i as never, "guild", "member")).toBeNull();
    expect(i.webhook.editMessage).toHaveBeenCalledWith("private", expect.objectContaining({ components: [] }));
  });
});
