import { describe, expect, it, vi } from "vitest";
import {
  authorizeUrl, exchangeLinkedRolesCode, LINKED_ROLES_COOKIE, metadataProblems, metadataRecords, metadataValues, newState, pickCharacter,
  pushRoleConnection, registerMetadata, roleConnectionBody, stateMatches, type Candidate
} from "../src/services/linked-roles.js";
import { createLinkedRolesWeb } from "../src/services/linked-roles-web.js";
import { isWebPath } from "../src/services/web-app.js";
import { parseCookies } from "../src/services/web-auth.js";

const auth = { clientId: "123456789012345678", clientSecret: "secret", siteUrl: "https://guilded.kcaron.top", sessionSecret: "s".repeat(40) };
const now = new Date("2026-11-22T12:00:00Z");
const candidate = (over: Partial<Candidate> = {}): Candidate => ({ name: "Aldric Stone", level: 40, isMain: false, guildRankIndex: 2, memberId: "m1", guildId: "g1", memberSince: new Date("2026-11-12T12:00:00Z"), evidenceRank: 2, ...over });

describe("metadata schema", () => {
  it("fits Discord's limits with French text", () => {
    const records = metadataRecords();
    expect(records).toHaveLength(5);
    expect(metadataProblems(records)).toEqual([]);
  });
  it("reports a record that breaks a limit", () => {
    const records = metadataRecords();
    records[0]!.description = "x".repeat(201);
    records[1]!.key = "Bad Key";
    expect(metadataProblems(records)).toEqual(expect.arrayContaining(["character_level: description length", "Bad Key: bad key"]));
  });
  it("registers with a bot token and refuses a failed answer", async () => {
    const ok = vi.fn(async () => new Response("[]", { status: 200 }));
    await registerMetadata("tok", "42", ok as unknown as typeof fetch);
    const [url, init] = ok.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://discord.com/api/v10/applications/42/role-connections/metadata");
    expect(init.method).toBe("PUT");
    expect((init.headers as Record<string, string>)["authorization"]).toBe("Bot tok");
    expect(JSON.parse(init.body as string)).toHaveLength(5);
    await expect(registerMetadata("tok", "42", (async () => new Response("no", { status: 403 })) as unknown as typeof fetch)).rejects.toThrow("403");
  });
});

describe("character choice and values", () => {
  it("prefers the chosen main, then level, then proof", () => {
    expect(pickCharacter([])).toBeNull();
    expect(pickCharacter([candidate({ name: "A", level: 60 }), candidate({ name: "B", level: 30, isMain: true })])?.name).toBe("B");
    expect(pickCharacter([candidate({ name: "A", level: 40 }), candidate({ name: "B", level: 41 })])?.name).toBe("B");
    expect(pickCharacter([candidate({ name: "A", evidenceRank: 1 }), candidate({ name: "B", evidenceRank: 5 })])?.name).toBe("B");
  });
  it("maps character data to metadata and leaves unknown values out", () => {
    const values = metadataValues(candidate(), 1234.9, new Date("2026-10-23T12:00:00Z"), now);
    expect(values).toEqual({ dungeon_score: 1234, in_guild: true, member_days: 30, character_level: 40, guild_rank: 2 });
    const lonely = metadataValues(candidate({ level: null, guildRankIndex: null }), 0, now, now);
    expect(lonely).toEqual({ dungeon_score: 0, in_guild: false, member_days: 0 });
    expect(roleConnectionBody(candidate({ name: "N".repeat(150) }), lonely).platform_username).toHaveLength(100);
    expect(roleConnectionBody(candidate(), lonely).platform_name).toBe("WoW Forever");
  });
});

describe("OAuth state", () => {
  it("asks for the two scopes and the callback address", () => {
    const url = new URL(authorizeUrl(auth, "st"));
    expect(url.searchParams.get("scope")).toBe("identify role_connections.write");
    expect(url.searchParams.get("redirect_uri")).toBe("https://guilded.kcaron.top/auth/linked-roles/callback");
    expect(url.searchParams.get("state")).toBe("st");
  });
  it("accepts only its own, unexpired, matching state", () => {
    const { state, cookie } = newState(auth, now);
    const value = parseCookies(cookie.split(";")[0])[LINKED_ROLES_COOKIE];
    expect(stateMatches(auth, value, state, now)).toBe(true);
    expect(stateMatches(auth, value, "other", now)).toBe(false);
    expect(stateMatches(auth, value, null, now)).toBe(false);
    expect(stateMatches(auth, value, state, new Date(now.getTime() + 11 * 60_000))).toBe(false);
    expect(stateMatches({ ...auth, sessionSecret: "t".repeat(40) }, value, state, now)).toBe(false);
    expect(stateMatches(auth, undefined, state, now)).toBe(false);
  });
});

describe("code exchange and push (mocked Discord)", () => {
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  it("needs the role connection scope and a real user id", async () => {
    const good = vi.fn().mockResolvedValueOnce(reply({ access_token: "at", scope: "identify role_connections.write" })).mockResolvedValueOnce(reply({ id: "222222222222222222" }));
    expect(await exchangeLinkedRolesCode(auth, "code", good as unknown as typeof fetch)).toEqual({ accessToken: "at", userId: "222222222222222222" });
    const narrow = vi.fn().mockResolvedValueOnce(reply({ access_token: "at", scope: "identify" }));
    await expect(exchangeLinkedRolesCode(auth, "code", narrow as unknown as typeof fetch)).rejects.toThrow("permission");
    await expect(exchangeLinkedRolesCode(auth, "code", (async () => reply({}, 400)) as unknown as typeof fetch)).rejects.toThrow("refused");
  });
  it("puts the connection for this application with the member's token", async () => {
    const fetcher = vi.fn(async () => reply({}));
    await pushRoleConnection(auth, "at", roleConnectionBody(candidate(), { dungeon_score: 1 }), fetcher as unknown as typeof fetch);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://discord.com/api/v10/users/@me/applications/123456789012345678/role-connection");
    expect((init.headers as Record<string, string>)["authorization"]).toBe("Bearer at");
  });
});

describe("web route", () => {
  const kit = {
    page: (status: number, title: string, body: string) => ({ status, headers: {}, body: `${title}|${body}` }),
    redirect: (location: string, cookies?: string[]) => ({ status: 302, headers: { location, ...(cookies ? { "set-cookie": cookies } : {}) }, body: "" }),
    signInPrompt: () => ({ status: 503, headers: {}, body: "off" })
  };
  const context = (path: string, query: string, cookie?: string) => ({
    request: { method: "GET", path, query: new URLSearchParams(query), headers: { cookie } }, lang: "en" as const, t: (en: string) => en, now,
    account: null, sessionToken: null, csrf: null, form: null, auth
  });
  const row = { id: "c1", memberId: "m1", guildId: "g1", name: "Aldric Stone", realm: "r", gameEdition: "forever", level: 40, isMain: true, confirmedAt: new Date("2026-11-01T00:00:00Z"), linkEvidence: "officer", guildRankIndex: 1, member: { createdAt: new Date("2026-11-01T00:00:00Z") } };
  const db = (rows: unknown[]) => ({
    character: { findMany: async () => rows },
    characterVerifyClaim: { findMany: async () => [] },
    guildRosterEntry: { findMany: async () => [] },
    dungeonSeason: { findFirst: async () => null },
    dungeonPointTransaction: { aggregate: async () => ({ _sum: { amount: 77 } }) }
  }) as never;
  const claimed = () => {
    const { state, cookie } = newState(auth, now);
    return { state, cookie: `${LINKED_ROLES_COOKIE}=${cookie.split(";")[0]!.split("=").slice(1).join("=")}` };
  };

  it("is routed and ignores other paths", async () => {
    expect(isWebPath("/auth/linked-roles")).toBe(true);
    expect(isWebPath("/auth/linked-roles/callback")).toBe(true);
    expect(await createLinkedRolesWeb(db([]), auth).route(context("/me/", "") as never, kit as never)).toBeNull();
    expect((await createLinkedRolesWeb(db([]), null).route(context("/auth/linked-roles", "") as never, kit as never))?.status).toBe(503);
  });
  it("sends the member to Discord with a state cookie", async () => {
    const answer = await createLinkedRolesWeb(db([]), auth).route(context("/auth/linked-roles", "") as never, kit as never);
    expect(answer?.status).toBe(302);
    expect(String(answer?.headers["location"])).toContain("role_connections.write");
  });
  it("pushes the confirmed character and never calls Discord without a valid state", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "at", scope: "identify role_connections.write" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "222222222222222222" })))
      .mockResolvedValueOnce(new Response("{}"));
    const web = createLinkedRolesWeb(db([row]), auth, fetcher as unknown as typeof fetch);
    const bad = await web.route(context("/auth/linked-roles/callback", "code=abc&state=nope", claimed().cookie) as never, kit as never);
    expect(bad?.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
    const { state, cookie } = claimed();
    const done = await web.route(context("/auth/linked-roles/callback", `code=abc&state=${state}`, cookie) as never, kit as never);
    expect(done?.status).toBe(200);
    expect(done?.body).toContain("Aldric Stone");
    const put = fetcher.mock.calls[2] as unknown as [string, RequestInit];
    expect(JSON.parse(put[1].body as string)).toEqual({ platform_name: "WoW Forever", platform_username: "Aldric Stone", metadata: { dungeon_score: 77, in_guild: true, member_days: 21, character_level: 40, guild_rank: 1 } });
  });
  it("skips a member with no confirmed character", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "at", scope: "identify role_connections.write" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "222222222222222222" })));
    const named = { ...row, linkEvidence: "named", confirmedAt: null };
    const { state, cookie } = claimed();
    const answer = await createLinkedRolesWeb(db([named]), auth, fetcher as unknown as typeof fetch).route(context("/auth/linked-roles/callback", `code=abc&state=${state}`, cookie) as never, kit as never);
    expect(answer?.status).toBe(200);
    expect(answer?.body).toContain("No verified character");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
