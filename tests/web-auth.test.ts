import { describe, expect, it, vi } from "vitest";
import {
  authorizeUrl, checkCsrf, csrfToken, exchangeCode, parseCookies, readStateCookie, safeReturnPath, sameOrigin, serializeCookie, sign,
  STATE_COOKIE, stateCookie, unsign, webAuthConfig
} from "../src/services/web-auth.js";

const auth = { clientId: "123456789012345678", clientSecret: "secret", siteUrl: "https://guilded.kcaron.top", sessionSecret: "s".repeat(40) };

describe("website sign-in configuration", () => {
  it("is off unless the client secret, site address and session secret are all set", () => {
    const full = { DISCORD_CLIENT_ID: "1", DISCORD_OAUTH_CLIENT_SECRET: "x", PUBLIC_SITE_URL: "https://guilded.kcaron.top/", WEB_SESSION_SECRET: "y".repeat(32) };
    expect(webAuthConfig(full)?.siteUrl).toBe("https://guilded.kcaron.top");
    for (const key of ["DISCORD_OAUTH_CLIENT_SECRET", "PUBLIC_SITE_URL", "WEB_SESSION_SECRET"] as const) {
      expect(webAuthConfig({ ...full, [key]: undefined })).toBeNull();
    }
  });
});

describe("signed cookies", () => {
  it("rejects a changed value or signature", () => {
    const signed = sign(auth.sessionSecret, "token123");
    expect(unsign(auth.sessionSecret, signed)).toBe("token123");
    expect(unsign(auth.sessionSecret, signed.replace("token123", "token124"))).toBeNull();
    expect(unsign(auth.sessionSecret, `${signed}x`)).toBeNull();
    expect(unsign("another-secret-of-thirty-two-chars!!", signed)).toBeNull();
    expect(unsign(auth.sessionSecret, undefined)).toBeNull();
    expect(unsign(auth.sessionSecret, "nodot")).toBeNull();
  });

  it("are HttpOnly, Secure, SameSite=Lax and host-only", () => {
    const cookie = serializeCookie("__Host-guilded_session", "a.b", 60);
    expect(cookie).toBe("__Host-guilded_session=a.b; Max-Age=60; Path=/; HttpOnly; Secure; SameSite=Lax");
    expect(cookie).not.toContain("Domain");
    expect(parseCookies("a=1; __Host-guilded_session=x%7Cy; a=2; bad")).toEqual({ a: "1", "__Host-guilded_session": "x|y" });
  });
});

describe("CSRF and origin checks", () => {
  it("accepts only the session's own token", () => {
    const token = csrfToken(auth.sessionSecret, "session-a");
    expect(checkCsrf(auth.sessionSecret, "session-a", token)).toBe(true);
    expect(checkCsrf(auth.sessionSecret, "session-b", token)).toBe(false);
    expect(checkCsrf(auth.sessionSecret, null, token)).toBe(false);
    expect(checkCsrf(auth.sessionSecret, "session-a", undefined)).toBe(false);
  });

  it("requires the post to come from the website", () => {
    expect(sameOrigin({ origin: "https://guilded.kcaron.top" }, auth.siteUrl)).toBe(true);
    expect(sameOrigin({ origin: "https://evil.example" }, auth.siteUrl)).toBe(false);
    expect(sameOrigin({ origin: "null" }, auth.siteUrl)).toBe(false);
    expect(sameOrigin({ referer: "https://guilded.kcaron.top/me/" }, auth.siteUrl)).toBe(true);
    expect(sameOrigin({ referer: "https://guilded.kcaron.top.evil.example/" }, auth.siteUrl)).toBe(false);
    expect(sameOrigin({}, auth.siteUrl)).toBe(false);
  });

  it("returns only to this website's own pages after sign-in", () => {
    expect(safeReturnPath("/recruitment/?class=Mage")).toBe("/recruitment/?class=Mage");
    expect(safeReturnPath("/leaderboards/character/Kev")).toBe("/leaderboards/character/Kev");
    expect(safeReturnPath("/players/?edition=retail&lang=fr")).toBe("/players/?edition=retail&lang=fr");
    for (const bad of ["https://evil.example/", "//evil.example/me/", "/me//evil", "/companion/", "/me/\nx", null]) expect(safeReturnPath(bad)).toBe("/me/");
  });
});

describe("Discord OAuth", () => {
  it("asks for the identify scope only, with the fixed redirect address", () => {
    const url = new URL(authorizeUrl(auth, "state1"));
    expect(url.origin + url.pathname).toBe("https://discord.com/oauth2/authorize");
    expect(url.searchParams.get("scope")).toBe("identify");
    expect(url.searchParams.get("redirect_uri")).toBe("https://guilded.kcaron.top/auth/callback");
    expect(url.searchParams.get("state")).toBe("state1");
  });

  it("binds the state to the browser and expires it", () => {
    const now = new Date("2026-10-19T12:00:00Z");
    const cookie = stateCookie(auth, "state1", "/recruitment/", now);
    const value = parseCookies(cookie.split(";")[0])[STATE_COOKIE];
    expect(readStateCookie(auth, value, "state1", now)).toEqual({ returnPath: "/recruitment/" });
    expect(readStateCookie(auth, value, "state2", now)).toBeNull();
    expect(readStateCookie(auth, value, "state1", new Date(now.getTime() + 11 * 60_000))).toBeNull();
    expect(readStateCookie(auth, undefined, "state1", now)).toBeNull();
  });

  it("exchanges the code, reads the account and keeps no token", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/oauth2/token")) {
        const body = new URLSearchParams(String(init?.body));
        expect(body.get("client_secret")).toBe("secret");
        expect(body.get("redirect_uri")).toBe("https://guilded.kcaron.top/auth/callback");
        return Response.json({ access_token: "abc", token_type: "Bearer", scope: "identify" });
      }
      expect((init?.headers as Record<string, string>)["authorization"]).toBe("Bearer abc");
      return Response.json({ id: "222222222222222222", username: "kev", global_name: "Kev" });
    });
    expect(await exchangeCode(auth, "code", fetcher as unknown as typeof fetch)).toEqual({ id: "222222222222222222", username: "kev", displayName: "Kev" });
    const refused = vi.fn(async () => new Response("no", { status: 400 }));
    await expect(exchangeCode(auth, "code", refused as unknown as typeof fetch)).rejects.toThrow("refused");
    const odd = vi.fn(async (url: string | URL | Request) => String(url).endsWith("/token") ? Response.json({ access_token: "abc" }) : Response.json({ id: "x", username: "kev" }));
    await expect(exchangeCode(auth, "code", odd as unknown as typeof fetch)).rejects.toThrow("unexpected");
  });
});
