import { describe, expect, it, vi } from "vitest";

const issues: { value: unknown[] } = { value: [] };
vi.mock("../src/services/sync-health.js", async (original) => ({ ...(await original<typeof import("../src/services/sync-health.js")>()), collectSyncIssues: async () => issues.value }));

import { NOTICE_END, RELEASE_AT, eligibleMembers, noticeText, runNoticePass, seenRows, type SeenRow } from "../src/services/companion-937-notice.js";

const now = new Date("2026-11-18T12:00:00Z");
const ago = (hours: number) => new Date(now.getTime() - hours * 3_600_000);
const silent = (memberId: string, hours: number, version: string | null = null): SeenRow => ({ memberId, signal: "silent", lastContact: ago(hours), version });
const broken = (memberId: string, hours: number): SeenRow => ({ memberId, signal: "broken-version", lastContact: ago(hours), version: "9.3.7" });

describe("eligibility", () => {
  it("takes stalled members whose last contact is after the 9.3.7 release and over 12 h ago", () => {
    expect(eligibleMembers([silent("a", 20), silent("b", 13)], now)).toEqual(["a", "b"]);
    expect(eligibleMembers([{ memberId: "old", signal: "silent", lastContact: new Date(RELEASE_AT.getTime() - 3_600_000), version: null }], now)).toEqual([]);
    expect(eligibleMembers([silent("recent", 5)], now)).toEqual([]);
  });
  it("takes a known-broken latest version once silent over 2 h, whatever the date", () => {
    expect(eligibleMembers([broken("a", 3), broken("b", 1)], now)).toEqual(["a"]);
    expect(eligibleMembers([{ memberId: "c", signal: "silent", lastContact: new Date("2026-11-01T00:00:00Z"), version: "9.3.7" }], now)).toEqual(["c"]);
  });
  it("skips a member whose latest report is newer than 9.3.7, but not an older or equal one", () => {
    expect(eligibleMembers([silent("a", 20, "9.3.8")], now)).toEqual([]);
    expect(eligibleMembers([silent("a", 20, "9.3.6")], now)).toEqual(["a"]);
  });
  it("reads only the lines that carry a member", () => {
    expect(seenRows([{ signal: "silent", who: "x", detail: "", fix: { en: "", fr: "" }, memberId: "m", lastContact: ago(20) }, { signal: "parked", who: "y", detail: "", fix: { en: "", fr: "" } }] as never)).toHaveLength(1);
  });
});

describe("text", () => {
  it("is hedged, French or English, with the link and no mentions", () => {
    expect(noticeText("fr", "https://x/companion/")).toContain("semble avoir cessé");
    expect(noticeText("fr", "https://x/companion/")).toContain("ignorer");
    expect(noticeText("en", "https://x/companion/")).toContain("seems to have stopped");
    expect(noticeText("en", "https://x/companion/")).toContain("you can ignore this");
    expect(noticeText(null, "https://x/companion/")).toContain("https://x/companion/");
    expect(noticeText("en")).not.toMatch(/@/);
  });
});

function fakeDb(language = "en", told: string[] = []) {
  const markers = new Map<string, string>(told.map((id) => [id, "sent"]));
  return {
    markers,
    guild: { findMany: async () => [{ id: "G", discordId: "g1" }] },
    member: { findMany: async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => ({ discordUserId: `u-${id}` })) },
    guildSettings: { findUnique: async () => ({ language }) },
    companionNotice: {
      findMany: async () => [...markers.keys()].map((discordUserId) => ({ discordUserId })),
      create: async ({ data }: { data: { discordUserId: string } }) => { if (markers.has(data.discordUserId)) throw new Error("unique"); markers.set(data.discordUserId, "sending"); },
      update: async ({ where, data }: { where: { discordUserId_kind: { discordUserId: string } }; data: { outcome: string } }) => { markers.set(where.discordUserId_kind.discordUserId, data.outcome); },
      delete: async ({ where }: { where: { discordUserId_kind: { discordUserId: string } } }) => { markers.delete(where.discordUserId_kind.discordUserId); }
    }
  };
}
const line = (memberId: string, hours = 20) => ({ signal: "silent", who: memberId, detail: "", fix: { en: "", fr: "" }, memberId, lastContact: ago(hours) });
const opts = { now, mode: "on", sleep: async () => undefined, log: () => undefined, allows: () => true };
const clientWith = (send: () => Promise<unknown>) => ({ users: { fetch: async () => ({ send }) } }) as never;

describe("pass", () => {
  it("sends once and never again", async () => {
    issues.value = [line("a")];
    const db = fakeDb();
    const send = vi.fn(async () => ({}));
    expect(await runNoticePass(clientWith(send), db as never, opts)).toMatchObject({ eligible: 1, sent: 1 });
    expect(await runNoticePass(clientWith(send), db as never, opts)).toMatchObject({ eligible: 0, sent: 0, skipped: 1 });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("keeps the marker when DMs are closed", async () => {
    issues.value = [line("a")];
    const db = fakeDb();
    const closed = () => Promise.reject(Object.assign(new Error("closed"), { code: 50007 }));
    expect(await runNoticePass(clientWith(closed), db as never, opts)).toMatchObject({ sent: 0, closed: 1 });
    expect(db.markers.get("u-a")).toBe("closed");
    expect(await runNoticePass(clientWith(closed), db as never, opts)).toMatchObject({ eligible: 0 });
  });
  it("drops the marker after another failure so the next hour retries", async () => {
    issues.value = [line("a")];
    const db = fakeDb();
    await runNoticePass(clientWith(() => Promise.reject(new Error("network"))), db as never, opts);
    expect(db.markers.has("u-a")).toBe(false);
  });
  it("is a dry run unless the mode is on", async () => {
    issues.value = [line("a")];
    for (const mode of [undefined, "dry", "anything"]) {
      const db = fakeDb();
      const send = vi.fn(async () => ({}));
      expect(await runNoticePass(clientWith(send), db as never, { ...opts, mode })).toMatchObject({ eligible: 1, sent: 0, dry: true });
      expect(send).not.toHaveBeenCalled();
      expect(db.markers.size).toBe(0);
    }
  });
  it("stops after the end date, when off, and behind the pilot gate", async () => {
    issues.value = [line("a")];
    const send = vi.fn(async () => ({}));
    expect(await runNoticePass(clientWith(send), fakeDb() as never, { ...opts, now: new Date(NOTICE_END.getTime() + 1000) })).toMatchObject({ eligible: 0 });
    expect(await runNoticePass(clientWith(send), fakeDb() as never, { ...opts, mode: "off" })).toMatchObject({ eligible: 0 });
    expect(await runNoticePass(clientWith(send), fakeDb() as never, { ...opts, allows: () => false })).toMatchObject({ eligible: 0 });
    expect(send).not.toHaveBeenCalled();
  });
  it("sends the French text to a French server", async () => {
    issues.value = [line("a")];
    const content: string[] = [];
    const client = { users: { fetch: async () => ({ send: async (m: { content: string }) => { content.push(m.content); } }) } } as never;
    await runNoticePass(client, fakeDb("fr") as never, opts);
    expect(content[0]).toContain("Ton compagnon");
  });
});
