import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { ACHIEVEMENTS, achievementGameVisible, type AchievementDef } from "../src/services/achievements-catalogue.js";
import { badgeInner, badgeSvg } from "../src/services/achievement-badges.js";
import { DELETE_CONFIRM_WORD, deleteMyDataByCredential } from "../src/services/data-deletion.js";
import { createMemberData } from "../src/services/member-data.js";
import { poeTrackingEnabled } from "../companion/active-games.mjs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("Delete my data: companion credential flow", () => {
  function db(found: "guild" | "personal" | "none") {
    const tx = { member: { findMany: vi.fn(async () => [{ id: "m1" }]), update: vi.fn(async () => ({})) } } as Record<string, unknown>;
    for (const name of ["webAccount", "communityBadgeSharing", "battlegroundReport", "battlegroundConsent", "memberAchievement", "memberMilestone", "recurringRecap", "groupAlert", "webAvailability", "poeLevelReached", "poeMapVisit", "guildMapSighting", "guildHelpCall", "worldPvpWeek", "characterPairing", "characterVerifyCode", "characterVerifyClaim", "companionCredential", "character"]) tx[name] = { deleteMany: vi.fn(async () => ({ count: 1 })) };
    const client = {
      companionCredential: { findFirst: vi.fn(async () => found === "guild" ? { member: { discordUserId: "111111111111111111" } } : null) },
      webCompanionCredential: { findFirst: vi.fn(async () => found === "personal" ? { account: { discordUserId: "222222222222222222" } } : null) },
      $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx))
    };
    return { client, tx, prisma: client as unknown as PrismaClient };
  }
  it("deletes nothing without the confirm word", async () => {
    const f = db("guild");
    expect(await deleteMyDataByCredential(f.prisma, "hash", "delete me")).toBe("confirm");
    expect(await deleteMyDataByCredential(f.prisma, "hash", undefined)).toBe("confirm");
    expect(f.client.$transaction).not.toHaveBeenCalled();
  });
  it("rejects an unknown or revoked credential before anything else", async () => {
    const f = db("none");
    expect(await deleteMyDataByCredential(f.prisma, "hash", DELETE_CONFIRM_WORD)).toBeNull();
    expect(f.client.$transaction).not.toHaveBeenCalled();
  });
  it("erases for a guild credential and for a personal one", async () => {
    for (const kind of ["guild", "personal"] as const) {
      const f = db(kind);
      expect(await deleteMyDataByCredential(f.prisma, "hash", ` ${DELETE_CONFIRM_WORD} `)).toMatchObject({ account: true });
      expect(f.client.$transaction).toHaveBeenCalledTimes(1);
    }
  });
  it("the companion asks for confirmation (native dialog) before calling the bot, and the button is in Settings", () => {
    const main = read("companion-app/main.cjs"), html = read("companion-app/renderer/index.html");
    const start = main.indexOf("async function deleteMyDataEverywhere");
    const body = main.slice(start, main.indexOf("app.on(\"second-instance\"", start));
    expect(body.indexOf("showMessageBoxSync")).toBeGreaterThan(-1);
    expect(body.indexOf("if (choice !== 1) return false")).toBeLessThan(body.indexOf("/api/v1/companion/delete-my-data"));
    expect(body).toContain('confirm: "DELETE"');
    expect(html).toMatch(/id="btnDeleteMyData"[^>]*>Delete my data</);
    expect(read("companion-app/locales/fr.json")).toContain("Supprimer mes données");
    expect(read("companion-app/ipc-security.cjs")).toContain('"delete-my-data"');
  });
});

describe("Delete my data: the /me page", () => {
  const ctx = { t: (en: string) => en, lang: "en", csrf: "tok", account: { discordUserId: "1" } } as never;
  it("shows the button, the one-line explanation and the typed confirm field only when erasing is wired", async () => {
    const withErase = createMemberData(async () => ({}) as never, async () => ({ members: 0, characters: 0, account: false }));
    const html = await withErase.meSection(ctx);
    expect(html).toContain("Delete my data");
    expect(html).toContain("It cannot be undone");
    expect(html).toContain(`name="confirm"`);
    expect(html).toContain('action="/me/data/delete');
    expect(await createMemberData(async () => ({}) as never).meSection(ctx)).not.toContain("Delete my data");
  });
});

describe("PoE2 surfaces follow the active-games switch", () => {
  const poeDef = { ...ACHIEVEMENTS[0]!, id: "poe2-test", game: "poe2" } as AchievementDef;
  it("badges for poe2 are empty while tracking is off and draw when it is on (data is untouched)", () => {
    expect(poeTrackingEnabled([])).toBe(false);
    expect(achievementGameVisible(poeDef)).toBe(false);
    expect(badgeSvg(poeDef, true)).toBe("");
    expect(badgeInner(poeDef, true)).toBe("");
    expect(achievementGameVisible(poeDef, poeTrackingEnabled(["poe2"]))).toBe(true);
    expect(ACHIEVEMENTS.every(def => achievementGameVisible(def))).toBe(true);
  });
  it("the companion keeps PoE2 markup gated behind poe-only, off by default, and showPage refuses the page", () => {
    const html = read("companion-app/renderer/index.html"), app = read("companion-app/renderer/app.js"), css = read("companion-app/renderer/style.css");
    expect(html).toContain('<body class="poe-off">');
    expect(css).toContain("body.poe-off .poe-only{display:none!important}");
    for (const marker of ['data-page="poe"', 'id="page-poe"', 'id="poeSettings"', 'id="poeEnabled"']) { // the Home game card left with redesign PR 5
      const at = html.indexOf(marker);
      expect(at, marker).toBeGreaterThan(-1);
      const open = html.lastIndexOf("<", at), tag = html.slice(open, html.indexOf(">", at));
      const wrapper = marker.startsWith('id="poeEnabled"') ? html.slice(html.lastIndexOf("<label", at), at) : tag;
      expect(wrapper, marker).toContain("poe-only");
    }
    expect(app).toMatch(/POE_PAGES\.has\(name\) && document\.body\.classList\.contains\('poe-off'\)/);
    expect(app).toContain('classList.toggle("poe-off", !all?.focus?.poeTracking)');
  });
});
