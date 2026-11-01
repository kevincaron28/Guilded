import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  config: { DISCORD_CLIENT_ID: "self-hosted-app", UPDATE_CHECK: true },
  db: { guildSettings: { findMany: vi.fn(), update: vi.fn() } }
}));
vi.mock("../src/config.js", () => ({ config: mocks.config }));
vi.mock("../src/database.js", () => ({ prisma: mocks.db }));

import { announceAvailableUpdate, fetchLatestRelease, isNewerVersion } from "../src/services/update-check.js";

const companion = createRequire(import.meta.url)("../companion-app/update-check.cjs") as {
  pickUpdate: (current: string, latest: { version: string; url: string } | null, bot?: string | null) => { version: string; url: string } | null;
  fetchLatestRelease: (fetchImpl: unknown) => Promise<{ version: string; url: string } | null>;
  RELEASES_PAGE: string;
};

const github = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
const release = { tag_name: "v6.6.0", html_url: "https://github.com/kevincaron28/Guilded/releases/tag/v6.6.0" };

function client(send = vi.fn<(message: { content: string }) => Promise<object>>(async () => ({}))) {
  const channel = { isTextBased: () => true, send };
  return { send, client: { guilds: { fetch: vi.fn(async () => ({ channels: { fetch: vi.fn(async () => channel) } })) } } as never };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.db.guildSettings.findMany.mockResolvedValue([{ id: "s1", logChannelId: "log", language: "en", guild: { discordId: "g1" } }]);
  mocks.db.guildSettings.update.mockResolvedValue({});
});

describe("release versions", () => {
  it("compares versions numerically and ignores anything that is not x.y.z", () => {
    expect(isNewerVersion("6.10.0", "6.9.9")).toBe(true);
    expect(isNewerVersion("v6.5.1", "6.5.1")).toBe(false);
    expect(isNewerVersion("6.5.0", "6.5.1")).toBe(false);
    expect(isNewerVersion("7.0.0-beta", "6.5.1")).toBe(false);
  });

  it("reads the latest release and copes with GitHub being down", async () => {
    await expect(fetchLatestRelease(github(release))).resolves.toEqual({ version: "6.6.0", url: release.html_url });
    await expect(fetchLatestRelease(github({}, false))).resolves.toBeNull();
    await expect(fetchLatestRelease(vi.fn(async () => { throw new Error("offline"); }) as never)).resolves.toBeNull();
  });
});

describe("bot update notice", () => {
  it("tells each server's officer log once about a newer release", async () => {
    const { client: discord, send } = client();
    expect(await announceAvailableUpdate(discord, { current: "6.5.1", fetchImpl: github(release) })).toBe(1);
    expect(mocks.db.guildSettings.update).toHaveBeenCalledWith({ where: { id: "s1" }, data: { lastUpdateNoticeVersion: "6.6.0" } });
    expect(mocks.db.guildSettings.findMany.mock.calls[0]![0].where.OR).toEqual([{ lastUpdateNoticeVersion: null }, { lastUpdateNoticeVersion: { not: "6.6.0" } }]);
    expect(String(send.mock.calls[0]![0]!.content)).toContain("Guilded 6.6.0 is available");
    expect(String(send.mock.calls[0]![0]!.content)).toContain("This bot runs 6.5.1");
  });

  it("stays quiet when up to date, on the hosted bot, or when turned off", async () => {
    const { client: discord, send } = client();
    expect(await announceAvailableUpdate(discord, { current: "6.6.0", fetchImpl: github(release) })).toBe(0);
    expect(await announceAvailableUpdate(discord, { current: "6.5.1", fetchImpl: github(release), clientId: "1552633893587394590" })).toBe(0);
    expect(await announceAvailableUpdate(discord, { current: "6.5.1", fetchImpl: github(release), enabled: false })).toBe(0);
    expect(send).not.toHaveBeenCalled();
    expect(mocks.db.guildSettings.findMany).not.toHaveBeenCalled();
  });
});

describe("desktop companion update prompt", () => {
  it("only suggests published stable clients, even when the backend is newer", () => {
    const latest = { version: "6.6.0", url: release.html_url };
    expect(companion.pickUpdate("6.3.2", latest, "6.5.1")).toEqual(latest);
    expect(companion.pickUpdate("6.3.2", null, "6.5.1")).toBeNull();
    expect(companion.pickUpdate("8.0.2", { version: "8.0.2", url: release.html_url }, "8.1.0")).toBeNull();
    expect(companion.pickUpdate("6.3.2", latest, "8.1.0")).toEqual(latest);
    expect(companion.pickUpdate("6.6.0", latest, "6.6.0")).toBeNull();
    expect(companion.pickUpdate("6.6.0", latest, null)).toBeNull();
  });

  it("never sends the user to a page outside GitHub", async () => {
    const odd = await companion.fetchLatestRelease(github({ tag_name: "v6.6.0", html_url: "https://evil.example/download" }));
    expect(odd).toEqual({ version: "6.6.0", url: companion.RELEASES_PAGE });
  });

  it("rejects draft or prerelease responses even with a stable-looking tag", async () => {
    await expect(companion.fetchLatestRelease(github({ ...release, prerelease: true }))).resolves.toBeNull();
    await expect(companion.fetchLatestRelease(github({ ...release, draft: true }))).resolves.toBeNull();
  });
});
