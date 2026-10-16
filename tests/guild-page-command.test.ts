import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  page: vi.fn(),
  edit: vi.fn(async () => "Quebec Gold: /g/quebec-gold/ is published."),
  forget: vi.fn()
}));
vi.mock("../src/database.js", () => ({ prisma: { guildPage: { findFirst: mocks.page } } }));
vi.mock("../src/services/guild-page.js", async (original) => ({
  ...(await original<typeof import("../src/services/guild-page.js")>()),
  editGuildPage: mocks.edit,
  forgetGuildPage: mocks.forget
}));
import { executeGuildPage, guildPageCommand } from "../src/commands/guild-page.js";

function interaction(sub: string, options: Record<string, string | boolean> = {}, roles: string[] = ["Officier"]) {
  return {
    guildId: "111",
    member: { permissions: { has: () => false }, roles: { cache: { some: (fn: (role: { name: string }) => boolean) => roles.some((name) => fn({ name })) } } },
    options: {
      getSubcommand: () => sub,
      getString: (name: string) => (options[name] as string | undefined) ?? null,
      getBoolean: (name: string) => (options[name] as boolean | undefined) ?? null
    },
    reply: vi.fn()
  };
}
const replyOf = (i: ReturnType<typeof interaction>) => (i.reply.mock.calls[0]![0] as { content: string }).content;

describe("/mod page", () => {
  beforeEach(() => {
    mocks.page.mockResolvedValue({ slug: "quebec-gold", sections: ["cores", "loot"] });
    mocks.edit.mockClear(); mocks.forget.mockClear();
  });

  it("is limited to officers, guild masters and administrators", async () => {
    const i = interaction("publish", {}, ["Chef de raid"]);
    await executeGuildPage(i as never);
    expect(replyOf(i)).toContain("Only Officers");
    expect(mocks.edit).not.toHaveBeenCalled();
  });

  it("turns one section on or off and keeps the others", async () => {
    await executeGuildPage(interaction("section", { name: "rankings", show: true }) as never);
    expect(mocks.edit).toHaveBeenLastCalledWith(expect.anything(), "sections", "111", "cores,loot,rankings");
    await executeGuildPage(interaction("section", { name: "loot", show: false }) as never);
    expect(mocks.edit).toHaveBeenLastCalledWith(expect.anything(), "sections", "111", "cores");
    expect(mocks.forget).toHaveBeenCalled();
  });

  it("maps text, invite and search to the page settings and shows the address", async () => {
    const i = interaction("text", { field: "recruitment", value: "We raid twice a week." });
    await executeGuildPage(i as never);
    expect(mocks.edit).toHaveBeenLastCalledWith(expect.anything(), "recruitment", "111", "We raid twice a week.");
    expect(replyOf(i)).toContain("/g/quebec-gold/");
    await executeGuildPage(interaction("invite") as never);
    expect(mocks.edit).toHaveBeenLastCalledWith(expect.anything(), "invite", "111", "none");
    await executeGuildPage(interaction("search", { allow: false }) as never);
    expect(mocks.edit).toHaveBeenLastCalledWith(expect.anything(), "index", "111", "off");
  });

  it("asks to create the page first", async () => {
    mocks.page.mockResolvedValue(null);
    const i = interaction("publish");
    await executeGuildPage(i as never);
    expect(replyOf(i)).toContain("/mod page create");
    expect(guildPageCommand.toJSON().options?.map((o) => o.name)).toEqual(["status", "create", "section", "text", "invite", "search", "publish", "unpublish"]);
  });
});
