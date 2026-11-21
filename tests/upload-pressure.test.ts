import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { linkPairedCharacter } from "../src/services/character-pairing.js";
import { companionAccess } from "../src/services/companion-access.js";
import { createCharacterPortraits } from "../src/services/character-portrait.js";

// 20 Nov 2026: uploads crossed the website's 20 s limit while the 1 GB VM swapped. These pin the changes that take load off it.

describe("linkPairedCharacter under database pressure", () => {
  const self = { name: "Ray", realm: "Forever", class: "PRIEST", race: "Scourge", level: 60, spec: "Holy", professions: [] };
  const makeTx = () => ({
    character: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0), create: vi.fn(async () => ({ id: "character" })) },
    professionSkill: { upsert: vi.fn(async () => ({})) },
    unclaimedCharacter: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    characterVerifyClaim: { findFirst: vi.fn(async () => null) }
  });
  it("retries once after a P2028 that rolled back, then links without a double write", async () => {
    const tx = makeTx();
    let attempts = 0;
    const options: unknown[] = [];
    const database = { $transaction: async (callback: (client: typeof tx) => unknown, opts: unknown) => {
      options.push(opts);
      if (++attempts === 1) throw Object.assign(new Error("Transaction API error: expired"), { code: "P2028" });
      return callback(tx);
    } };
    expect(await linkPairedCharacter(database as never, "guild", "member", self)).toBe("linked");
    expect(attempts).toBe(2);
    expect(tx.character.create).toHaveBeenCalledTimes(1);
    expect(options[0]).toEqual({ timeout: 15_000, maxWait: 6_000 });
  });
  it("gives up after the one retry and does not retry other errors", async () => {
    let attempts = 0;
    const busy = { $transaction: async () => { attempts++; throw Object.assign(new Error("expired"), { code: "P2028" }); } };
    await expect(linkPairedCharacter(busy as never, "guild", "member", self)).rejects.toMatchObject({ code: "P2028" });
    expect(attempts).toBe(2);
    attempts = 0;
    const broken = { $transaction: async () => { attempts++; throw new Error("boom"); } };
    await expect(linkPairedCharacter(broken as never, "guild", "member", self)).rejects.toThrow("boom");
    expect(attempts).toBe(1);
  });
});

describe("companion access round trips", () => {
  const officerMember = () => ({ id: "u", permissions: { has: () => true }, roles: { cache: { has: () => false } } });
  it("reuses the credential the caller just read instead of looking it up again", async () => {
    const findFirst = vi.fn();
    const db = { companionCredential: { findFirst } };
    const client = { guilds: { fetch: async () => ({ members: { fetch: async () => officerMember() } }) } };
    const access = await companionAccess(db as never, client as never, "g", "discord", "k".repeat(43), false, { known: { memberId: "m", discordUserId: "u" } });
    expect(access?.memberId).toBe("m");
    expect(findFirst).not.toHaveBeenCalled();
  });
  it("answers a burst of upload parts from one Discord role check when asked to", async () => {
    const fetchMember = vi.fn(async () => officerMember());
    const client = { guilds: { fetch: async () => ({ members: { fetch: fetchMember } }) } };
    const db = { companionCredential: { findFirst: vi.fn() } };
    const known = { memberId: "m", discordUserId: "burst-user" };
    for (let i = 0; i < 3; i++) await companionAccess(db as never, client as never, "g", "discord", "k".repeat(43), false, { known, cacheMs: 10_000 });
    expect(fetchMember).toHaveBeenCalledTimes(1);
    await companionAccess(db as never, client as never, "g", "discord", "k".repeat(43), false, { known });
    expect(fetchMember).toHaveBeenCalledTimes(2);
  });
});

async function fakeRender() {
  const body = await sharp({ create: { width: 300, height: 800, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 1 } } }).png().toBuffer();
  const head = await sharp({ create: { width: 120, height: 120, channels: 4, background: { r: 40, g: 200, b: 40, alpha: 1 } } }).png().toBuffer();
  return sharp({ create: { width: 1600, height: 1200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: body, left: 650, top: 200 }, { input: head, left: 740, top: 80 }]).png().toBuffer();
}

describe("portrait memory and disk cache", () => {
  it("decodes a render once: a later process reads the finished crop from disk, a stale one fetches again", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "portraits-"));
    try {
      const full = await fakeRender();
      const fetchImage = vi.fn(async (url: string) => url.endsWith("main-raw.png") ? full : null);
      expect((await sharp((await createCharacterPortraits({ fetchImage, cacheDir: dir }).forId(7n))!).metadata()).width).toBe(256);
      const again = await createCharacterPortraits({ fetchImage, cacheDir: dir }).forId(7n);
      expect((await sharp(again!).metadata()).width).toBe(256);
      expect(fetchImage).toHaveBeenCalledTimes(1);
      const later = await createCharacterPortraits({ fetchImage, cacheDir: dir, now: () => Date.now() + 8 * 24 * 3_600_000 }).forId(7n);
      expect(later).not.toBeNull();
      expect(fetchImage).toHaveBeenCalledTimes(2);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("never works on two renders at once", async () => {
    const full = await fakeRender();
    let active = 0, peak = 0;
    const fetchImage = async (url: string) => {
      if (!url.endsWith("main-raw.png")) return null;
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => { setTimeout(resolve, 10); });
      active--;
      return full;
    };
    const portraits = createCharacterPortraits({ fetchImage });
    await Promise.all([1n, 2n, 3n, 4n].map((id) => portraits.forId(id)));
    expect(peak).toBe(1);
  });
});
