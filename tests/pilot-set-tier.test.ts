import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client } from "discord.js";
import { createPilotRequests } from "../src/services/pilot-requests.js";
import { pilotFilePolicy } from "../src/services/pilot-admin.js";

const primary = "111111111111111111", guest = "222222222222222222";
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

async function fixture(liteLimit: number, extraIds = "") {
  const dir = await mkdtemp(join(tmpdir(), "guilded-tier-")); dirs.push(dir);
  const envPath = join(dir, ".env.local"), statePath = join(dir, "requests.json");
  await writeFile(envPath, `DISCORD_GUILD_ID=${primary}\nDISCORD_CLIENT_ID=${primary}\nHOSTED_PILOT=true\nHOSTED_GUILD_LIMIT=5\nHOSTED_GUILD_IDS=${extraIds}\n`);
  const ids = pilotFilePolicy(await readFile(envPath, "utf8")).guildIds;
  const guild = { id: guest, name: "Guest", ownerId: guest, memberCount: 9, leave: vi.fn() };
  const client = { application: { fetch: async () => ({ owner: { id: "owner" } }) }, users: { fetch: async () => ({ send: async () => ({ id: "m" }) }) }, guilds: { cache: new Map([[guest, guild]]) } };
  const activate = vi.fn(async () => undefined), demote = vi.fn(async () => undefined);
  const manager = createPilotRequests(client as unknown as Client, { enabled: true, allows: id => ids.includes(id), replace: next => { ids.splice(0, ids.length, ...next); }, liteLimit, activate, demote, envPath, statePath });
  return { manager, ids, envPath, activate, demote };
}

describe("owner console tier changes", () => {
  it("approves a Lite server and registers the full commands", async () => {
    const f = await fixture(1);
    expect(await f.manager.setTier(guest, "approved")).toContain("Approved");
    expect(f.ids).toContain(guest);
    expect(f.activate).toHaveBeenCalledOnce();
    expect(await f.manager.setTier(guest, "approved")).toBe("Already approved.");
  });
  it("demotes an approved server to Lite when a slot is free, and edits only the pilot ids", async () => {
    const f = await fixture(1, guest);
    expect(await f.manager.setTier(guest, "lite")).toContain("Guilded Lite");
    expect(f.ids).not.toContain(guest);
    expect(f.demote).toHaveBeenCalledOnce();
    expect(await readFile(f.envPath, "utf8")).toContain("DISCORD_CLIENT_ID=");
  });
  it("refuses to demote with no free Lite slot, and never touches the home server", async () => {
    const f = await fixture(0, guest);
    expect(await f.manager.setTier(guest, "lite")).toContain("No Guilded Lite slot");
    expect(f.ids).toContain(guest);
    await expect((await fixture(1)).manager.setTier(primary, "lite")).rejects.toThrow();
  });
});
