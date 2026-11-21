import { describe, expect, it } from "vitest";
import { createWebApp, type WebResponse } from "../src/services/web-app.js";
import { hashToken, SESSION_COOKIE, sign } from "../src/services/web-auth.js";
import { meSection } from "../src/services/me-layout.js";
import { charactersMeSection } from "../src/services/me-characters.js";
import { createMemberData } from "../src/services/member-data.js";
import { createDevicePages } from "../src/services/companion-devices.js";
import { RETIRED_TOOLS } from "../src/services/retired-pages.js";
import { memoryWebStore } from "./helpers/memory-web-store.js";

const NOW = new Date("2026-11-15T18:00:00Z");
const snapshot = { publicProfile: false, guilds: [], devices: [], characters: [], recentSignups: [], recapSchedules: [], battlegroundConsents: [], battlegroundReports: [], limited: false };

async function get(target: string, signedIn: boolean, lang = "en"): Promise<WebResponse> {
  const memory = memoryWebStore().store;
  const account = await memory.upsertAccount({ id: "user1", username: "Tester", displayName: "Tester" }, NOW);
  await memory.createSession(account.id, hashToken("session"), new Date(NOW.getTime() + 60_000));
  const secret = "s".repeat(40);
  const devices = createDevicePages({} as never), memberData = createMemberData(async () => snapshot);
  const app = createWebApp({ store: memory, auth: { clientId: "1", clientSecret: "x", siteUrl: "https://guildedwow.com", sessionSecret: secret }, allows: () => true, postApplication: async () => null, now: () => NOW,
    routes: [devices.route, memberData.route],
    meSections: [
      meSection({ id: "characters", group: "overview", render: charactersMeSection(async () => ({ battleNet: false, companion: true, characters: 1, lastSynced: NOW }), async () => [{ id: "c1", name: "Aria", isMain: true, trust: "confirmed" as const, level: 12, className: "Mage", race: null, serverName: "Test Guild", inGuild: true, guildRank: "Officer", armoryName: "Aria" }]) }),
      meSection({ id: "connections", group: "account", render: devices.meSection }),
      meSection({ id: "your-data", group: "account", render: memberData.meSection })
    ] });
  const url = new URL(target, "https://guildedwow.com");
  url.searchParams.set("lang", lang);
  return (await app.respond({ method: "GET", path: url.pathname, query: url.searchParams, headers: signedIn ? { cookie: `${SESSION_COOKIE}=${sign(secret, "session")}` } : {} })) as WebResponse;
}

const hrefs = (html: string) => [...html.matchAll(/href="([^"#]*)/g)].map(match => match[1]!.replace(/^https?:\/\/[^/]+/, "").split("?")[0]!);

describe("the basic /me/ page", () => {
  it("lists characters, devices, data with the delete page link, applications and the player card", async () => {
    const body = (await get("/me/", true)).body;
    expect(body).toContain("Aria");
    expect(body).toContain("confirmed");
    expect(body).toContain("/me/connections");
    expect(body).toContain("/me/data");
    expect(body).toContain('href="/delete-my-data/?lang=en"');
    expect(body).toContain('id="applications"');
    expect(body).toContain('id="looking-for-a-guild"');
    expect(body).toContain("Sign out");
  });
  it("links to no retired page, here or on /me/data", async () => {
    for (const path of ["/me/", "/me/data"]) {
      const response = await get(path, true);
      expect(response.status).toBe(200);
      for (const href of hrefs(response.body)) expect(RETIRED_TOOLS.test(href), `${path} links to ${href}`).toBe(false);
    }
    expect((await get("/me/data", true, "fr")).body).toContain("/delete-my-data/");
  });
  it("asks a signed-out visitor to sign in and shows no account data", async () => {
    const response = await get("/me/", false);
    expect([200, 401, 302, 303]).toContain(response.status);
    expect(response.body).not.toContain("Aria");
    expect(response.body).not.toContain("My applications");
    if (response.status !== 302 && response.status !== 303) expect(response.body).toContain("/auth/login");
  });
});
