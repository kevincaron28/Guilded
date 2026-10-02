import { describe, expect, it, vi } from "vitest";
import { WOW_SPECIALIZATIONS, canonicalSpecialization } from "../src/wow-specializations.js";
import { SPECS } from "../src/wow-data.js";
import { characterDisplayLine, classEmojiMap, loadClassEmojis } from "../src/services/character-display.js";
import { buildSignupEmbed } from "../src/services/signup-embed.js";
import { coreRosterEmbed } from "../src/services/raid-core.js";

const now = new Date("2026-10-01T18:00:00Z");
const priestIcon = "<:wow_pretre:1550000000000000001>";
const discIcon = "<:wow_spec_priest_disc:1550000000000000002>";
const palHolyIcon = "<:wow_spec_pal_holy:1550000000000000003>";
const icons = { Priest: priestIcon, "Priest:Discipline": discIcon, "Paladin:Holy": palHolyIcon };
const priest = { name: "Ray", className: "Priest", spec: "Discipline", level: 13, readinessSnapshots: [{ itemLevel: 4.2, inspectedAt: now }] };

describe("character specialization icons", () => {
  it("covers every selectable specialization with unique names and class-scoped keys", () => {
    expect(WOW_SPECIALIZATIONS).toHaveLength(41);
    expect(new Set(WOW_SPECIALIZATIONS.map(s => s.emojiName)).size).toBe(41);
    for (const [className, names] of Object.entries(SPECS)) {
      for (const name of names) {
        const spec = WOW_SPECIALIZATIONS.find(s => s.className === className && s.name === name);
        expect(spec, `${className}: ${name}`).toBeDefined();
        expect(canonicalSpecialization(spec!.className, spec!.french)).toBe(spec);
        expect(spec!.emojiName).toMatch(/^[a-z0-9_]{2,32}$/);
      }
    }
  });
  it("resolves French names and Classic aliases without confusing classes or raid roles", () => {
    expect(canonicalSpecialization("Priest", "Sacré")?.key).toBe("Priest:Holy");
    expect(canonicalSpecialization("Paladin", "sacre")?.key).toBe("Paladin:Holy");
    expect(canonicalSpecialization("Druid", "Combat farouche")?.name).toBe("Feral");
    expect(canonicalSpecialization("Rogue", "Combat")?.name).toBe("Combat");
    expect(canonicalSpecialization("Rogue", "Outlaw")?.name).toBe("Outlaw");
    expect(canonicalSpecialization("Priest", "Protection")).toBeUndefined();
    expect(canonicalSpecialization("Priest", "HEALER")).toBeUndefined();
    expect(canonicalSpecialization(undefined, "Holy")).toBeUndefined();
  });
  it("shows two icons and localized specialization text for the selected character", () => {
    expect(characterDisplayLine("Ray", priest, "fr", icons, now)).toBe(`${priestIcon} ${discIcon} Ray · Prêtre — Discipline · niv. 13 · ilvl 4,2`);
    expect(characterDisplayLine("Duude", { className: "Paladin", spec: "Sacré" }, "en", icons, now)).toContain(`${palHolyIcon} Duude · Paladin — Holy`);
  });
  it("keeps text when icons are unavailable and marks missing specs without guessing", () => {
    expect(characterDisplayLine("Ray", priest, "fr", {}, now)).toContain("Ray · Prêtre — Discipline");
    expect(characterDisplayLine("Ray", { ...priest, spec: null }, "fr", icons, now)).toContain(`${priestIcon} Ray · Prêtre — spé à préciser`);
    expect(characterDisplayLine("Ray", { ...priest, spec: "Custom build" }, "fr", icons, now)).toContain(`${priestIcon} Ray · Prêtre — Custom build`);
    expect(characterDisplayLine("Ray", { ...priest, spec: "Holy" }, "fr", icons, now)).not.toContain(palHolyIcon);
  });
  it("shows the signup's selected spec and each primary/backup's independent spec", () => {
    const raid = { id: "raid", title: "Raid", description: null, scheduledAt: now, status: "PLANNED" as const, tankLimit: null, healerLimit: null, dpsLimit: null };
    const signup = buildSignupEmbed({ lang: "fr", now, raid, classEmojis: icons, signups: [{ memberId: "m", displayName: "Ray", character: priest, role: "HEALER", status: "SIGNED_UP" }] }).toJSON();
    expect(signup.fields?.some(f => f.value.includes(`${priestIcon} ${discIcon} Ray`))).toBe(true);
    const core = coreRosterEmbed({ name: "Core", description: null, members: [{ member: { displayName: "Kevin" }, role: "HEALER", bench: false,
      character: priest, backups: [{ role: "HEALER", character: { name: "Duude", className: "Paladin", spec: "Sacré" } }] }] }, "EPGP", "fr", icons, now).toJSON();
    expect(core.fields?.some(f => f.value.includes(`${priestIcon} ${discIcon} Kevin · Ray`))).toBe(true);
    expect(core.fields?.some(f => f.value.includes(`${palHolyIcon} Kevin · Duude · Paladin — Sacré`))).toBe(true);
  });
  it("loads app spec icons once across concurrent requests and merges server class icons", async () => {
    const appList = new Map([["a", { id: "1550000000000000002", name: "wow_spec_priest_disc" }]]);
    const fetch = vi.fn(async () => appList);
    const application = { emojis: { fetch, cache: appList } };
    const server = new Map([["c", { id: "1550000000000000001", name: "wow_pretre" }]]);
    const guild = { client: { application }, emojis: { fetch: async () => server, cache: server } };
    const catalogs = await Promise.all([loadClassEmojis(guild as never), loadClassEmojis(guild as never), loadClassEmojis(guild as never)]);
    expect(fetch).toHaveBeenCalledTimes(1);
    for (const catalog of catalogs) expect(catalog).toEqual({ Priest: priestIcon, "Priest:Discipline": discIcon });
  });
  it("falls back to cached app icons if their REST request fails", async () => {
    const cache = new Map([["a", { id: "1550000000000000002", name: "wow_spec_priest_disc" }]]);
    const guild = { client: { application: { emojis: { fetch: async () => { throw new Error("Offline"); }, cache } } } };
    expect(await loadClassEmojis(guild as never)).toEqual({ "Priest:Discipline": discIcon });
    expect(await loadClassEmojis(guild as never)).toEqual({ "Priest:Discipline": discIcon });
    expect(classEmojiMap([{ id: "1550000000000000003", name: "wow_spec_pal_holy", available: false }])).toEqual({});
  });
  it("keeps both emoji tokens complete when a large signup roster is clipped", () => {
    const raid = { id: "raid", title: "Raid", description: null, scheduledAt: now, status: "PLANNED" as const, tankLimit: null, healerLimit: null, dpsLimit: null };
    const signups = ["SIGNED_UP", "MAYBE", "WAITLISTED"].flatMap(status => Array.from({ length: 100 }, (_, i) => ({ memberId: `${status}${i}`, displayName: "Long-character-and-realm-name-" + i, character: priest, role: "HEALER" as const, status })));
    const embed = buildSignupEmbed({ lang: "fr", now, raid, classEmojis: icons, signups }).toJSON();
    for (const field of embed.fields ?? []) {
      expect(field.value.length).toBeLessThanOrEqual(1024);
      expect(field.value.replaceAll(priestIcon, "").replaceAll(discIcon, "")).not.toContain("<:");
    }
    expect(JSON.stringify(embed)).toContain(discIcon);
    expect((embed.title?.length ?? 0) + (embed.description?.length ?? 0) + (embed.footer?.text.length ?? 0) + (embed.fields ?? []).reduce((n, f) => n + f.name.length + f.value.length, 0)).toBeLessThanOrEqual(6000);
  });
});
