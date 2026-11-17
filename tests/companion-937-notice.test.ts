import { describe, expect, it, vi } from "vitest";
import { NOTICE_END, NOTICE_KIND, eligibleRows, noteCompanionVersion, noticeText, resetNotedVersions, runNoticePass, type SeenRow } from "../src/services/companion-937-notice.js";

const now = new Date("2026-11-18T12:00:00Z");
const ago = (hours: number) => new Date(now.getTime() - hours * 3_600_000);
const row = (user: string, version: string | null, hours: number, language: string | null = "en"): SeenRow => ({ discordUserId: user, guildDiscordId: "g1", version, seenAt: ago(hours), language });

describe("eligibility", () => {
  it("needs exactly 9.3.7 and silence of two hours", () => {
    const rows = [row("a", "9.3.7", 3), row("b", "9.3.7", 1), row("c", "9.3.6", 5), row("d", "9.3.8", 5), row("e", "9.3.70", 5), row("f", null, 5)];
    expect(eligibleRows(rows, now).map((r) => r.discordUserId)).toEqual(["a"]);
  });
  it("skips a member later seen with a newer version", () => {
    expect(eligibleRows([row("a", "9.3.7", 10), row("a", "9.3.8", 3)], now)).toEqual([]);
    expect(eligibleRows([row("a", "9.3.6", 10), row("a", "9.3.7", 3)], now)).toHaveLength(1);
  });
});

describe("text", () => {
  it("is French or English with the download address and no mentions", () => {
    expect(noticeText("fr", "https://x/companion/")).toContain("Ton compagnon");
    expect(noticeText("fr", "https://x/companion/")).toContain("arrêté");
    expect(noticeText("en", "https://x/companion/")).toContain("Your Guilded Companion");
    expect(noticeText(null, "https://x/companion/")).toContain("https://x/companion/");
    expect(noticeText("en")).not.toMatch(/@/);
  });
});

function fakeDb(rows: SeenRow[], told: string[] = []) {
  const markers = new Map<string, string>(told.map((id) => [id, "sent"]));
  const members = rows.map((r) => ({ companionVersion: r.version, companionVersionAt: r.seenAt, member: { discordUserId: r.discordUserId, guildId: "G", guild: { discordId: r.guildDiscordId } } }));
  return {
    markers,
    companionCredential: { findMany: async () => members },
    companionDevice: { findMany: async () => [] },
    guildSettings: { findMany: async () => [{ guildId: "G", language: rows[0]?.language ?? "en" }] },
    companionNotice: {
      findMany: async () => [...markers.keys()].map((discordUserId) => ({ discordUserId })),
      create: async ({ data }: { data: { discordUserId: string } }) => { if (markers.has(data.discordUserId)) throw new Error("unique"); markers.set(data.discordUserId, "sending"); },
      update: async ({ where, data }: { where: { discordUserId_kind: { discordUserId: string } }; data: { outcome: string } }) => { markers.set(where.discordUserId_kind.discordUserId, data.outcome); },
      delete: async ({ where }: { where: { discordUserId_kind: { discordUserId: string } } }) => { markers.delete(where.discordUserId_kind.discordUserId); }
    }
  };
}
const opts = { now, sleep: async () => undefined, log: () => undefined, allows: () => true };
const clientWith = (send: (id: string) => Promise<unknown>) => ({ users: { fetch: async (id: string) => ({ send: () => send(id) }) } }) as never;

describe("pass", () => {
  it("sends once and never again", async () => {
    const db = fakeDb([row("a", "9.3.7", 3)]);
    const send = vi.fn(async () => ({}));
    expect(await runNoticePass(clientWith(send), db as never, opts)).toMatchObject({ eligible: 1, sent: 1 });
    expect(await runNoticePass(clientWith(send), db as never, opts)).toMatchObject({ eligible: 0, sent: 0, skipped: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(NOTICE_KIND).toBe("companion-9.3.7");
  });
  it("keeps the marker when DMs are closed so it is never retried", async () => {
    const db = fakeDb([row("a", "9.3.7", 3)]);
    const closed = () => Promise.reject(Object.assign(new Error("closed"), { code: 50007 }));
    expect(await runNoticePass(clientWith(closed), db as never, opts)).toMatchObject({ sent: 0, closed: 1 });
    expect(db.markers.get("a")).toBe("closed");
    expect(await runNoticePass(clientWith(closed), db as never, opts)).toMatchObject({ eligible: 0 });
  });
  it("drops the marker after another failure so the next hour retries", async () => {
    const db = fakeDb([row("a", "9.3.7", 3)]);
    await runNoticePass(clientWith(() => Promise.reject(new Error("network"))), db as never, opts);
    expect(db.markers.has("a")).toBe(false);
  });
  it("dry run sends nothing and writes nothing", async () => {
    const db = fakeDb([row("a", "9.3.7", 3)]);
    const send = vi.fn(async () => ({}));
    expect(await runNoticePass(clientWith(send), db as never, { ...opts, mode: "dry" })).toMatchObject({ eligible: 1, sent: 0, dry: true });
    expect(send).not.toHaveBeenCalled();
    expect(db.markers.size).toBe(0);
  });
  it("stops after the end date and respects the pilot gate", async () => {
    const send = vi.fn(async () => ({}));
    expect(await runNoticePass(clientWith(send), fakeDb([row("a", "9.3.7", 3)]) as never, { ...opts, now: new Date(NOTICE_END.getTime() + 1000) })).toMatchObject({ eligible: 0, sent: 0 });
    expect(await runNoticePass(clientWith(send), fakeDb([row("a", "9.3.7", 3)]) as never, { ...opts, allows: () => false })).toMatchObject({ eligible: 0 });
    expect(send).not.toHaveBeenCalled();
  });
  it("sends the French text to a French server", async () => {
    const db = fakeDb([row("a", "9.3.7", 3, "fr")]);
    const content: string[] = [];
    const client = { users: { fetch: async () => ({ send: async (m: { content: string }) => { content.push(m.content); } }) } } as never;
    await runNoticePass(client, db as never, opts);
    expect(content[0]).toContain("Ton compagnon");
  });
});

describe("recording the version", () => {
  it("writes once per secret and version, and ignores unreadable versions", () => {
    resetNotedVersions();
    const updateMany = vi.fn(async () => ({}));
    const db = { companionCredential: { updateMany }, companionDevice: { updateMany: vi.fn(async () => ({})) } } as never;
    const secret = "s".repeat(40);
    noteCompanionVersion(db, { credential: secret }, "9.3.7");
    noteCompanionVersion(db, { credential: secret }, "9.3.7");
    noteCompanionVersion(db, { credential: secret }, "garbage");
    expect(updateMany).toHaveBeenCalledTimes(1);
  });
});
