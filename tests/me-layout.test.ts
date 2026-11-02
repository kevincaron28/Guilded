import { describe, expect, it } from "vitest";
import { createWebApp, type WebResponse } from "../src/services/web-app.js";
import { hashToken, SESSION_COOKIE, sign } from "../src/services/web-auth.js";
import { ME_GROUPS, meSection, type MeSectionInput } from "../src/services/me-layout.js";
import { memoryWebStore } from "./helpers/memory-web-store.js";

const NOW = new Date("2026-11-02T18:00:00Z");

async function page(sections: MeSectionInput[], target = "/me/") {
  const memory = memoryWebStore().store;
  const account = await memory.upsertAccount({ id: "user1", username: "Tester", displayName: "Tester" }, NOW);
  await memory.createSession(account.id, hashToken("session"), new Date(NOW.getTime() + 60_000));
  const secret = "s".repeat(40);
  const app = createWebApp({ store: memory, auth: { clientId: "1", clientSecret: "x", siteUrl: "https://guilded.kcaron.top", sessionSecret: secret }, allows: () => true, postApplication: async () => null, now: () => NOW, meSections: sections });
  const url = new URL(target, "https://guilded.kcaron.top");
  return (await app.respond({ method: "GET", path: url.pathname, query: url.searchParams, headers: { cookie: `${SESSION_COOKIE}=${sign(secret, "session")}` } })) as WebResponse;
}

const fixed = (html: string) => async () => html;
const sections: MeSectionInput[] = [
  meSection({ id: "profile", group: "overview", render: fixed("<h2>Your player profile</h2><p>Long privacy text</p>"), fold: { en: "Privacy and details", fr: "Confidentialité et détails" } }),
  meSection({ id: "achievements", group: "play", render: fixed('<h2 id="achievements">My achievements</h2><p>list</p>') }),
  meSection({ id: "availability", group: "play", render: fixed("<h2>Who's free?</h2>") }),
  meSection({ id: "roster", group: "guild", render: fixed("<h2>Guild roster</h2>"), officer: true }),
  meSection({ id: "your-data", group: "account", render: fixed("<h2>Your data</h2>") }),
  meSection({ id: "empty", group: "account", render: fixed("") }),
  fixed("<h2>Legacy bare section</h2>")
];

describe("/me/ grouping", () => {
  it("renders the four groups in order with a plain-anchor navigation", async () => {
    const body = (await page(sections)).body;
    const order = ME_GROUPS.map(group => body.indexOf(`id="${group}"`));
    expect(order.every(index => index > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    for (const group of ME_GROUPS) expect(body).toContain(`<a href="#${group}">`);
    expect(body).toContain('class="me-tabs"');
  });

  it("keeps existing anchors and offers the most-used actions at the top", async () => {
    const body = (await page(sections)).body;
    expect(body).toContain('id="achievements"');
    expect(body).toContain('id="my-week"');
    expect(body).toContain('id="sec-achievements"');
    expect(body.indexOf('class="me-quick"')).toBeLessThan(body.indexOf('id="overview"'));
    for (const href of ["/me/battlenet", "#achievements", "/me/availability"]) expect(body).toContain(`href="${href}`);
  });

  it("uses one h2 per group and h3 for sections", async () => {
    const body = (await page(sections)).body;
    expect(body).not.toContain("<h2>Your player profile");
    expect(body).toContain("<h3>Your player profile</h3>");
    expect(body.match(/<h2 id="[a-z]+-title">/g)).toHaveLength(4);
  });

  it("folds long sections, tucks officer tools into a details block and drops empty sections", async () => {
    const body = (await page(sections)).body;
    expect(body).toMatch(/<h3>Your player profile<\/h3><details class="me-fold"><summary>Privacy and details<\/summary><p>Long privacy text/);
    expect(body).toMatch(/<details class="me-officer"><summary>Officer tools<\/summary>.*Guild roster/s);
    expect(body).not.toContain('id="sec-empty"');
  });

  it("places a bare function section in Play", async () => {
    const body = (await page(sections)).body;
    expect(body.indexOf("Legacy bare section")).toBeGreaterThan(body.indexOf('id="play"'));
    expect(body.indexOf("Legacy bare section")).toBeLessThan(body.indexOf('id="guild"'));
  });

  it("omits groups with nothing to show and translates headings", async () => {
    const french = (await page([fixed("<h2>Seul</h2>")], "/me/?lang=fr")).body;
    expect(french).toContain("Jouer");
    expect(french).toContain("Actions rapides");
    expect(french).not.toContain('id="account"');
    expect(french).toContain("Mes candidatures");
  });
});
