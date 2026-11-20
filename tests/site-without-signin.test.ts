import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createWebApp } from "../src/services/web-app.js";
import { retiredAvailabilityRoute, retiredToolsRoute } from "../src/services/retired-pages.js";
import { memoryWebStore } from "./helpers/memory-web-store.js";

// The website no longer has account tools. What the companion and the phone app need to sign in stays.

const app = () => createWebApp({ store: memoryWebStore().store, auth: { clientId: "1", clientSecret: "x", siteUrl: "https://guilded.kcaron.top", sessionSecret: "s".repeat(40) },
  allows: () => true, postApplication: async () => null, now: () => new Date("2026-11-14T18:00:00Z"), routes: [retiredToolsRoute, retiredAvailabilityRoute] });
const get = (path: string, query = "") => app().respond({ method: "GET", path, query: new URLSearchParams(query), headers: {} });

describe("retired account tools", () => {
  it.each(["/me/calendar", "/me/reserves", "/me/wishlist", "/me/battlenet", "/me/badges", "/me/artisans", "/me/roster", "/me/roster/review",
    "/me/history", "/me/teams", "/me/groups", "/me/crafters", "/me/handover", "/me/raid-plans", "/me/statistics", "/me/guild-bank", "/me/pair", "/me/achievements.png"])(
    "%s answers with one short page, not an error", async (path) => {
      const response = (await get(path))!;
      expect(response.status).toBe(200);
      expect(response.body).toContain("These tools are not on the website");
      expect((await get(path, "lang=fr"))!.body).toContain("Ces outils ne sont pas sur le site");
    });
  it("leaves the pages the companion, the phone app and the data page need alone", async () => {
    for (const path of ["/me/companion", "/me/connections", "/me/data", "/me/data/delete", "/me/"]) expect((await get(path))?.body ?? "").not.toContain("These tools are not on the website");
  });
});

describe("the sign-in the companion and the phone app use still answers", () => {
  it("/auth/login goes to Discord with the website's own callback", async () => {
    const response = (await get("/auth/login", "return=%2Fme%2Fcompanion%3Frequest%3Dabc"))!;
    expect(response.status).toBe(302);
    const location = new URL(String(response.headers["location"]));
    expect(location.origin + location.pathname).toBe("https://discord.com/oauth2/authorize");
    expect(location.searchParams.get("redirect_uri")).toBe("https://guilded.kcaron.top/auth/callback");
    expect(location.searchParams.get("scope")).toBe("identify");
  });
  it("/auth/callback answers a missing sign-in with a page, not a 404", async () => {
    expect((await get("/auth/callback"))!.status).toBe(400);
  });
  it("only returns to /me/companion afterwards and still allows the companion page", async () => {
    const { safeReturnPath } = await import("../src/services/web-auth.js");
    expect(safeReturnPath("/me/companion?request=abc")).toBe("/me/companion?request=abc");
    expect(safeReturnPath("https://evil.example/")).toBe("/me/");
  });
  it("the site's route list still carries the companion page, connections and data pages, with the retired page first", () => {
    const source = readFileSync(new URL("../src/companion-api.ts", import.meta.url), "utf8");
    const line = source.split(/\r?\n/).find((l) => l.startsWith("  const routes: WebRoute[] = ["))!;
    expect(line.startsWith("  const routes: WebRoute[] = [retiredToolsRoute, signInPage,")).toBe(true);
    for (const name of ["devices.route", "memberData.route"]) expect(line).toContain(name);
    expect(source).toContain('new URL("/me/companion", auth.siteUrl)');
  });
  it("a small sign-in link is back in the menu and /me/ is one basic page", () => {
    const nav = readFileSync(new URL("../site/nav.mjs", import.meta.url), "utf8");
    expect(nav).toMatch(/key: "my-guilded"/);
    const layout = readFileSync(new URL("../src/services/web-layout.ts", import.meta.url), "utf8");
    expect(layout).toContain("Sign in with Discord");
    const api = readFileSync(new URL("../src/companion-api.ts", import.meta.url), "utf8");
    const ids = [...api.matchAll(/meSection\(\{ id: "([a-z-]+)"/g)].map(match => match[1]);
    expect(ids).toEqual(["characters", "connections", "your-data"]);
  });
});
