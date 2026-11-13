import { describe, expect, it } from "vitest";
import { createWebApp } from "../src/services/web-app.js";
import { retiredAvailabilityRoute } from "../src/services/retired-pages.js";
import { memoryWebStore } from "./helpers/memory-web-store.js";

const NOW = new Date("2026-11-13T18:00:00Z");
const app = () => createWebApp({ store: memoryWebStore().store, auth: { clientId: "1", clientSecret: "x", siteUrl: "https://guilded.kcaron.top", sessionSecret: "s".repeat(40) },
  allows: () => true, postApplication: async () => null, now: () => NOW, routes: [retiredAvailabilityRoute] });

describe("the retired Who's free? page", () => {
  it.each(["/me/availability", "/me/availability/"])("%s redirects permanently to the account page instead of a 404", async (path) => {
    const response = (await app().respond({ method: "GET", path, query: new URLSearchParams(), headers: {} }))!;
    expect(response.status).toBe(301);
    expect(response.headers["location"]).toBe("/me/?lang=en");
  });
  it("redirects the French address to the French account page and ignores other paths", async () => {
    const fr = (await app().respond({ method: "GET", path: "/me/availability", query: new URLSearchParams("lang=fr"), headers: {} }))!;
    expect(fr.status).toBe(301);
    expect(String(fr.headers["location"])).toBe("/me/?lang=fr");
    const other = await app().respond({ method: "GET", path: "/me/availability-extra", query: new URLSearchParams(), headers: {} });
    expect(other?.status).not.toBe(301);
  });
});
