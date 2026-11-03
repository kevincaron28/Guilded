import { describe, expect, it, vi } from "vitest";
import { Collection } from "discord.js";
import { ensureInstallPost, installPost, installPostState, START_URL } from "../src/services/install-post.js";
import { tx } from "../src/i18n.js";

type Fake = ReturnType<typeof stored>;
function stored(lang: "en" | "fr", options: { author?: string } = {}) {
  const post = installPost(lang);
  return {
    author: { id: options.author ?? "bot" }, editable: true,
    embeds: [post.embeds[0]!.data], components: post.components.map((row) => row.toJSON()),
    edit: vi.fn().mockResolvedValue(undefined), pin: vi.fn().mockResolvedValue(undefined)
  };
}
function channel(pins: Fake[], recent: Fake[] = []) {
  const sent = stored("en"); sent.embeds = []; 
  return {
    client: { user: { id: "bot" } },
    messages: { fetchPins: vi.fn(async () => ({ items: pins.map((message) => ({ message })) })), fetch: vi.fn(async () => new Collection(recent.map((m, i) => [String(i), m] as const))) },
    send: vi.fn(async () => sent), sent
  };
}

describe("install post", () => {
  it("has link buttons to the real downloads and the start page, mentions nobody", () => {
    const post = installPost("en");
    const buttons = post.components[0]!.toJSON().components as unknown as { url: string; style: number }[];
    expect(buttons.map((b) => b.url)).toEqual([
      "https://www.curseforge.com/wow/addons/guilded",
      "https://apps.microsoft.com/detail/9N680XX3QFL9", "https://github.com/kevincaron28/Guilded/releases/latest", START_URL
    ]);
    expect(buttons.every((b) => b.style === 5)).toBe(true);
    expect(post.allowedMentions).toEqual({ parse: [] });
    expect(installPost("fr").embeds[0]!.data.title).toContain("Installer Guilded");
    expect(installPost("fr").components[0]!.toJSON().components.at(-1)).toMatchObject({ url: `${START_URL}?lang=fr` });
  });

  it("posts and pins when missing", async () => {
    const c = channel([]); const message = c.sent as unknown as { pin: ReturnType<typeof vi.fn> };
    message.pin = vi.fn().mockResolvedValue(undefined);
    expect(await installPostState(c as never, "en")).toBe("missing");
    expect(await ensureInstallPost(c as never, "en")).toEqual({ pinned: true });
    expect(c.send).toHaveBeenCalledTimes(1);
    expect(message.pin).toHaveBeenCalled();
  });

  it("edits in place and never posts twice", async () => {
    const old = stored("en"); old.embeds = [{ ...old.embeds[0]!, description: "old" }];
    const c = channel([old]);
    expect(await installPostState(c as never, "en")).toBe("outdated");
    expect(await ensureInstallPost(c as never, "en")).toEqual({ pinned: true });
    expect(old.edit).toHaveBeenCalledTimes(1);
    expect(c.send).not.toHaveBeenCalled();
    const current = stored("fr");
    expect(await installPostState(channel([current]) as never, "fr")).toBe("current");
    const same = channel([current]);
    await ensureInstallPost(same as never, "fr");
    expect(current.edit).not.toHaveBeenCalled(); expect(same.send).not.toHaveBeenCalled();
  });

  it("ignores another author's post", async () => {
    const c = channel([stored("en", { author: "member" })]);
    expect(await installPostState(c as never, "en")).toBe("missing");
  });

  it("finds an unpinned post, edits it and reports the missing pin permission quietly", async () => {
    const unpinned = stored("en"); unpinned.pin.mockRejectedValue(new Error("Missing Permissions"));
    const c = channel([], [unpinned]);
    expect(await installPostState(c as never, "en")).toBe("outdated");
    expect(await ensureInstallPost(c as never, "en")).toEqual({ pinned: false });
    expect(c.send).not.toHaveBeenCalled();
    expect(tx("fr", "The install post is in the channel but not pinned: give Guilded the Manage Messages permission there, then press \"Update bot messages\" again.")).toContain("Gérer les messages");
  });
});
