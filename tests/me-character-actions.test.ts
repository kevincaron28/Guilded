import { beforeEach, describe, expect, it, vi } from "vitest";

// Make main and Unlink on My Guilded (T8B) through the real web app (origin + CSRF checks), the real setMainCharacter,
// unlinkNotMine, unlinkCharacter and detachCharacter, on an in-memory stand-in for Prisma. Only the officer-log post and
// markMemberChanged are replaced so the test can see them called.
const world = vi.hoisted(() => ({
  characters: [] as Record<string, unknown>[], claims: [] as Record<string, unknown>[], audits: [] as Record<string, unknown>[], log: [] as string[], changed: [] as unknown[]
}));
vi.mock("../src/services/housekeeping.js", () => ({ postToLogChannel: vi.fn(async (_guild: unknown, text: string) => { world.log.push(text); }) }));
vi.mock("../src/services/member-sync-events.js", () => ({ markMemberChanged: (change: unknown) => { world.changed.push(change); } }));

import { createWebApp, type WebResponse } from "../src/services/web-app.js";
import { csrfToken, hashToken, SESSION_COOKIE, sign } from "../src/services/web-auth.js";
import { createMeCharacterActions, ME_CHARACTER_MAIN_PATH, ME_CHARACTER_UNLINK_PATH } from "../src/services/me-character-actions.js";
import { meCharacterTable } from "../src/services/me-characters.js";
import { memoryWebStore } from "./helpers/memory-web-store.js";

const NOW = new Date("2026-11-19T18:00:00Z");
const SECRET = "s".repeat(40);
const A1 = "a".repeat(24), A2 = "b".repeat(24), B1 = "c".repeat(24);
const MEMBERS: Record<string, { id: string; guildId: string; discordUserId: string; status: string; guild: { discordId: string; name: string } }> = {
  m1: { id: "m1", guildId: "g1", discordUserId: "user1", status: "ACTIVE", guild: { discordId: "dg1", name: "Québec Gold" } },
  m2: { id: "m2", guildId: "g1", discordUserId: "user2", status: "ACTIVE", guild: { discordId: "dg1", name: "Québec Gold" } }
};
const row = (id: string, memberId: string, name: string, isMain = false) =>
  ({ id, guildId: "g1", memberId, name, className: "Mage", level: 60, isMain, detachedAt: null, displayName: null, realm: "Forever", gameEdition: "forever" });

function matches(r: Record<string, unknown>, where: Record<string, unknown> = {}): boolean {
  return Object.entries(where).every(([key, want]) => {
    if (want && typeof want === "object" && "not" in want) return r[key] !== (want as { not: unknown }).not;
    return r[key] === want;
  });
}
function database() {
  const holding = { id: "holding-g1" };
  const db = {
    character: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const found = world.characters.find((r) => r["id"] === where.id);
        return found ? { ...found, member: MEMBERS[found["memberId"] as string] ?? { id: found["memberId"], guildId: "g1", discordUserId: "holding", status: "LEFT", guild: { discordId: "dg1", name: "Québec Gold" } } } : null;
      }),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => world.characters.find((r) => matches(r, where)) ?? null),
      findMany: vi.fn(async () => []),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: object }) => Object.assign(world.characters.find((r) => r["id"] === where.id)!, data)),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: object }) => { for (const r of world.characters.filter((x) => matches(x, where))) Object.assign(r, data); })
    },
    member: { upsert: vi.fn(async () => holding) },
    guildSettings: { findUnique: vi.fn(async () => ({ language: "en" })) },
    unclaimedCharacter: { deleteMany: vi.fn(async () => ({})), findMany: vi.fn(async () => []) },
    guildRosterEntry: { findMany: vi.fn(async () => []) },
    characterLinkConflict: { updateMany: vi.fn(async () => ({})) },
    characterVerifyClaim: {
      findMany: vi.fn(async () => []),
      upsert: vi.fn(async ({ create, update, where }: { create: Record<string, unknown>; update: object; where: { guildId_memberId_nameKey: { memberId: string; nameKey: string } } }) => {
        const key = where.guildId_memberId_nameKey;
        const found = world.claims.find((c) => c["memberId"] === key.memberId && c["nameKey"] === key.nameKey);
        if (found) return Object.assign(found, update);
        world.claims.push(create);
        return create;
      })
    },
    auditLog: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { world.audits.push(data); return data; }) },
    $transaction: vi.fn(async (work: unknown) => (typeof work === "function" ? (work as (tx: unknown) => unknown)(db) : Promise.all(work as unknown[])))
  };
  return db;
}

async function setup(options: { clock?: () => number } = {}) {
  const memory = memoryWebStore().store;
  const account = await memory.upsertAccount({ id: "user1", username: "Tester", displayName: "Tester" }, NOW);
  await memory.createSession(account.id, hashToken("session"), new Date(NOW.getTime() + 600_000));
  const db = database();
  const actions = createMeCharacterActions(db as never, { client: { guilds: { fetch: async () => ({}) } } as never, now: options.clock });
  const app = createWebApp({ store: memory, auth: { clientId: "1", clientSecret: "x", siteUrl: "https://guildedwow.com", sessionSecret: SECRET }, allows: () => true, postApplication: async () => null, now: () => NOW, routes: [actions.route] });
  const csrf = csrfToken(SECRET, "session");
  const post = async (path: string, fields: Record<string, string>, opts: { csrf?: string | null; origin?: string | null } = {}): Promise<WebResponse> => {
    const body = new URLSearchParams(fields);
    if (opts.csrf !== null) body.set("csrf", opts.csrf ?? csrf);
    return (await app.respond({ method: "POST", path, query: new URLSearchParams(), headers: {
      cookie: `${SESSION_COOKIE}=${sign(SECRET, "session")}`, "content-type": "application/x-www-form-urlencoded", ...(opts.origin === null ? {} : { origin: opts.origin ?? "https://guildedwow.com" })
    }, body: body.toString() })) as WebResponse;
  };
  return { post };
}

const mains = (memberId: string) => world.characters.filter((r) => r["memberId"] === memberId && r["isMain"]).map((r) => r["id"]);

beforeEach(() => {
  world.characters.length = 0; world.claims.length = 0; world.audits.length = 0; world.log.length = 0; world.changed.length = 0;
  world.characters.push(row(A1, "m1", "Ray", true), row(A2, "m1", "Rayne"), row(B1, "m2", "Zed", true));
});

describe("My Guilded: Make main", () => {
  it("own character: becomes the only main, member re-synced, audited", async () => {
    const { post } = await setup();
    const answer = await post(ME_CHARACTER_MAIN_PATH, { character: A2 });
    expect(answer.status).toBe(303);
    expect(answer.headers["location"]).toContain("char=main");
    expect(mains("m1")).toEqual([A2]);
    expect(mains("m2")).toEqual([B1]);
    expect(world.changed).toContainEqual({ guildId: "g1", memberId: "m1" });
    expect(world.audits[0]).toMatchObject({ action: "CHARACTER_MAIN_SET", guildId: "g1", actorId: "m1", entityId: A2 });
  });

  it("someone else's character: 403, no name leaked, nothing changed", async () => {
    const { post } = await setup();
    const answer = await post(ME_CHARACTER_MAIN_PATH, { character: B1 });
    expect(answer.status).toBe(403);
    expect(answer.body).not.toContain("Zed");
    expect(mains("m2")).toEqual([B1]);
    expect(mains("m1")).toEqual([A1]);
    expect(world.changed).toHaveLength(0);
    // An id that does not exist looks the same.
    const missing = await post(ME_CHARACTER_MAIN_PATH, { character: "z".repeat(24) });
    expect(missing.status).toBe(403);
    expect(missing.body).toBe(answer.body);
  });

  it("a missing or wrong CSRF token, or another origin, is refused before anything runs", async () => {
    const { post } = await setup();
    expect((await post(ME_CHARACTER_MAIN_PATH, { character: A2 }, { csrf: null })).status).toBe(403);
    expect((await post(ME_CHARACTER_MAIN_PATH, { character: A2 }, { csrf: "forged" })).status).toBe(403);
    expect((await post(ME_CHARACTER_MAIN_PATH, { character: A2 }, { origin: "https://evil.example" })).status).toBe(403);
    expect(mains("m1")).toEqual([A1]);
  });

  it("is rate limited per account", async () => {
    let clock = 1_000_000;
    const { post } = await setup({ clock: () => clock });
    for (let i = 0; i < 20; i++) expect((await post(ME_CHARACTER_MAIN_PATH, { character: A2 })).headers["location"]).toContain("char=main");
    expect((await post(ME_CHARACTER_MAIN_PATH, { character: A2 })).headers["location"]).toContain("char=slow");
    clock += 11 * 60_000;
    expect((await post(ME_CHARACTER_MAIN_PATH, { character: A2 })).headers["location"]).toContain("char=main");
  });
});

describe("My Guilded: Unlink", () => {
  it("asks first: without the confirm field nothing is unlinked", async () => {
    const { post } = await setup();
    const answer = await post(ME_CHARACTER_UNLINK_PATH, { character: A2 });
    expect(answer.status).toBe(200);
    expect(answer.body).toContain("Unlink this character?");
    expect(answer.body).toContain('name="confirm"');
    expect(world.characters.find((r) => r["id"] === A2)!["detachedAt"]).toBeNull();
    expect(world.claims).toHaveLength(0);
  });

  it("confirmed: detached, BLOCKED claim, officer-log line, audit, member re-synced", async () => {
    const { post } = await setup();
    const answer = await post(ME_CHARACTER_UNLINK_PATH, { character: A2, confirm: "1" });
    expect(answer.headers["location"]).toContain("char=unlinked");
    expect(world.characters.find((r) => r["id"] === A2)!["detachedAt"]).toBeInstanceOf(Date);
    expect(world.claims).toEqual([expect.objectContaining({ memberId: "m1", status: "BLOCKED" })]);
    expect(world.log).toHaveLength(1);
    expect(world.log[0]).toContain("<@user1>");
    expect(world.log[0]).toContain("website");
    expect(world.audits[0]).toMatchObject({ action: "CHARACTER_UNLINKED_WEB", actorId: "m1", entityId: A2 });
    expect(world.changed).toContainEqual({ guildId: "g1", memberId: "m1" });
    expect(mains("m1")).toEqual([A1]);
  });

  it("someone else's character, confirmed or not: 403, no name, nothing written", async () => {
    const { post } = await setup();
    for (const fields of [{ character: B1 }, { character: B1, confirm: "1" }]) {
      const answer = await post(ME_CHARACTER_UNLINK_PATH, fields);
      expect(answer.status).toBe(403);
      expect(answer.body).not.toContain("Zed");
    }
    expect(world.characters.find((r) => r["id"] === B1)!["detachedAt"]).toBeNull();
    expect(world.claims).toHaveLength(0);
    expect(world.log).toHaveLength(0);
  });

  it("an already unlinked character is refused the same way (no second block write or log line)", async () => {
    const { post } = await setup();
    await post(ME_CHARACTER_UNLINK_PATH, { character: A2, confirm: "1" });
    const again = await post(ME_CHARACTER_UNLINK_PATH, { character: A2, confirm: "1" });
    expect(again.status).toBe(403);
    expect(world.log).toHaveLength(1);
  });

  it("a missing CSRF token never unlinks", async () => {
    const { post } = await setup();
    expect((await post(ME_CHARACTER_UNLINK_PATH, { character: A2, confirm: "1" }, { csrf: null })).status).toBe(403);
    expect(world.characters.find((r) => r["id"] === A2)!["detachedAt"]).toBeNull();
  });
});

describe("the table's forms", () => {
  const list = [
    { id: A1, name: "Ray", isMain: true, trust: "confirmed" as const, level: 60, className: "Mage", race: null, serverName: "QG", inGuild: true, guildRank: null, armoryName: "Ray" },
    { id: A2, name: "Rayne", isMain: false, trust: "reported" as const, level: 12, className: "Mage", race: null, serverName: "QG", inGuild: false, guildRank: null, armoryName: "Rayne" }
  ];
  const t = (en: string, fr: string) => en + (fr ? "" : "");
  it("Make main only on non-main rows; Unlink on all; CSRF in every form; no forms without a token", () => {
    const html = meCharacterTable(list, t, "en", "tok");
    expect(html.match(/Make main/g)).toHaveLength(1);
    expect(html.match(/>Unlink</g)).toHaveLength(2);
    expect(html.match(/name="csrf" value="tok"/g)).toHaveLength(3);
    expect(meCharacterTable(list, t, "en")).not.toContain("<form");
  });
});
