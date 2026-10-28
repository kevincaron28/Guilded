import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageFlags } from "discord.js";
const { findMany, findSettings } = vi.hoisted(() => ({ findMany: vi.fn(), findSettings: vi.fn() }));
vi.mock("../src/database.js", () => ({ prisma: { character: { findMany }, guildSettings: { findUnique: findSettings } } }));
import { pickSignupCharacter } from "../src/commands/signup-character-picker.js";

describe("private signup character selection", () => {
  beforeEach(() => { vi.clearAllMocks(); findSettings.mockResolvedValue({ language: "fr" }); });
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
    findMany.mockImplementation(async () => { expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral }); return [character(1)]; });
    expect(await pickSignupCharacter(i as never, "guild", "member")).toEqual(character(1));
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { memberId: "member", member: { guildId: "guild" } } }));
  });
  it.each([false, true])('gives linking instructions without a signup or exception when no characters exist (acknowledged=%s)', async acknowledged => {
    findMany.mockResolvedValue([]);
    const i = interaction([], acknowledged);
    expect(await pickSignupCharacter(i as never, 'guild', 'member')).toBeNull();
    const send = acknowledged ? i.followUp : i.editReply;
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('/character pair'), components: [] }));
    expect(send.mock.calls[0]![0].content).toContain('Choisis ton personnage');
    expect(i.message.awaitMessageComponent).not.toHaveBeenCalled();
  });
  it("pages beyond 25 choices and only accepts the initiating user's private components", async () => {
    findMany.mockResolvedValue(Array.from({ length: 27 }, (_, id) => character(id)));
    const next = { customId: "signupchar:next", isStringSelectMenu: () => false, update: vi.fn() };
    const selected = { customId: "signupchar:choose", values: ["26"], isStringSelectMenu: () => true, update: vi.fn() };
    const i = interaction([next, selected], true);
    expect(await pickSignupCharacter(i as never, "guild", "member")).toEqual(character(26));
    expect(i.deferReply).not.toHaveBeenCalled();
    expect(i.followUp).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.Ephemeral }));
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
  it("does not return a selection after an officer's authority is revoked", async () => {
    findMany.mockResolvedValue([character(1),character(2)]);
    const choice={customId:'signupchar:choose',isStringSelectMenu:()=>true,values:['2'],update:vi.fn()};
    const authorize=vi.fn().mockResolvedValue(false);
    expect(await pickSignupCharacter(interaction([choice]) as never,'guild','member',authorize)).toBeNull();
    expect(authorize).toHaveBeenCalledWith(choice);expect(choice.update).not.toHaveBeenCalled();
  });
  it.each([
    ["en", "Which character", "Your character", "Previous", "Next", "Selected character", "Selection expired"],
    ["fr", "Quel personnage", "Ton personnage", "Précédents", "Suivants", "Personnage choisi", "Choix expiré"]
  ])("uses the guild's %s language throughout selection and expiry", async (language, prompt, placeholder, previous, next, selected, expired) => {
    findSettings.mockResolvedValue({ language });
    findMany.mockResolvedValue(Array.from({ length: 26 }, (_, id) => character(id)));
    const choice = { customId: "signupchar:choose", values: ["1"], isStringSelectMenu: () => true, update: vi.fn() };
    const i = interaction([choice]);
    await pickSignupCharacter(i as never, "guild", "member");
    expect(findSettings).toHaveBeenCalledWith({ where: { guildId: "guild" }, select: { language: true } });
    const screen = i.editReply.mock.calls[0]![0];
    expect(screen.content).toContain(prompt);
    expect(screen.components[0].toJSON().components[0].placeholder).toContain(placeholder);
    expect(screen.components[1].toJSON().components.map((button: { label: string }) => button.label)).toEqual([previous, next]);
    expect(choice.update).toHaveBeenCalledWith({ content: `${selected} : **Char1 — Quebec**.`, components: [] });
    const timedOut = interaction();
    await pickSignupCharacter(timedOut as never, "guild", "member");
    expect(timedOut.webhook.editMessage).toHaveBeenCalledWith("private", expect.objectContaining({ content: expect.stringContaining(expired), components: [] }));
  });
});
