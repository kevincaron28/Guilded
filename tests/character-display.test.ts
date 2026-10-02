import { describe, expect, it } from "vitest";
import { CLASS_EMOJI_NAMES, canonicalClass, characterDisplayLine, classEmojiMap, loadClassEmojis } from "../src/services/character-display.js";
import { buildSignupEmbed } from "../src/services/signup-embed.js";
import { coreRosterEmbed } from "../src/services/raid-core.js";
import { clipRosterLines } from "../src/services/roster-embed-limits.js";

const now = new Date("2026-10-01T18:00:00Z");
const priest = { className: "Priest", level: 13, readinessSnapshots: [{ itemLevel: 4.2, inspectedAt: new Date("2026-10-01T12:00:00Z") }] };
const icons = { Priest: "<:wow_pretre:1550000000000000001>", Paladin: "<:wow_paladin:1550000000000000002>" };
const raid = { id: "raid", title: "Raid", description: null, scheduledAt: now, status: "PLANNED" as const, tankLimit: null, healerLimit: null, dpsLimit: null };

describe("character class and equipment display", () => {
  it("recognizes all classes and French names, without guessing unknown classes", () => {
    for (const name of Object.keys(CLASS_EMOJI_NAMES)) expect(canonicalClass(name.toUpperCase().replaceAll(" ", ""))).toBe(name);
    expect(canonicalClass("Prêtre")).toBe("Priest");
    expect(canonicalClass("Chevalier de la mort")).toBe("Death Knight");
    expect(canonicalClass("Imaginary")).toBeUndefined();
  });
  it("shows class text with or without an emoji, and distinguishes character level from item level", () => {
    expect(characterDisplayLine("Ray", priest, "fr", icons, now)).toBe(`${icons.Priest} Ray · Prêtre — spé à préciser · niv. 13 · ilvl 4,2`);
    expect(characterDisplayLine("Ray", priest, "en", {}, now)).toBe("Ray · Priest — spec not set · lvl 13 · ilvl 4.2");
    expect(characterDisplayLine("Legacy player", null, "fr", icons, now)).toBe("Legacy player");
  });
  it("does not turn unknown, invalid or future gear into a claimed equipment score", () => {
    for (const itemLevel of [null, 0, -1, NaN, Infinity]) expect(characterDisplayLine("Ray", { ...priest, readinessSnapshots: [{ itemLevel, inspectedAt: now }] }, "fr", {}, now)).toContain("ilvl —");
    expect(characterDisplayLine("Ray", { ...priest, readinessSnapshots: [] }, "fr", {}, now)).toContain("ilvl —");
    expect(characterDisplayLine("Ray", { ...priest, readinessSnapshots: [{ itemLevel: 42, inspectedAt: new Date(now.getTime() + 86400000) }] }, "fr", {}, now)).toContain("ilvl —");
  });
  it("flags old inspection values and explains them in the signup footer", () => {
    const old = { ...priest, readinessSnapshots: [{ itemLevel: 4.2, inspectedAt: new Date("2026-09-29T12:00:00Z") }] };
    const embed = buildSignupEmbed({ lang: "fr", now, raid, signups: [{ memberId: "m", displayName: "Ray", character: old, role: "HEALER", status: "SIGNED_UP" }] }).toJSON();
    expect(embed.fields?.find(f => f.name.startsWith("💚"))?.value).toContain("ilvl 4,2*");
    expect(embed.footer?.text).toContain("plus de 24 h");
  });
  it("decorates confirmed, maybe, waitlisted and unanswered core characters", () => {
    const rows = ["SIGNED_UP", "MAYBE", "WAITLISTED"].map((status, i) => ({ memberId: String(i), displayName: `Ray${i}`, character: priest, role: "HEALER" as const, status }));
    const embed = buildSignupEmbed({ lang: "fr", now, raid, signups: rows, classEmojis: icons, core: { name: "Core", members: [{ memberId: "missing", displayName: "Missing", character: priest, role: "HEALER", bench: false }] } }).toJSON();
    for (const name of ["Ray0", "Ray1", "Ray2", "Missing"]) expect(embed.fields?.some(f => f.value.includes(`${icons.Priest} ${name} · Prêtre`))).toBe(true);
  });
  it("shows each core primary and backup's own class and inspection", () => {
    const embed = coreRosterEmbed({ name: "Core", description: null, members: [{ member: { displayName: "Kevin" }, role: "HEALER", bench: false,
      character: { name: "Ray", ...priest }, backups: [{ role: "HEALER", character: { name: "Duude", className: "Paladin", level: 13, readinessSnapshots: [{ itemLevel: 4.6, inspectedAt: now }] } }] }] }, "EPGP", "fr", icons, now).toJSON();
    expect(embed.fields?.find(f => f.name.startsWith("💚"))?.value).toContain("Ray · Prêtre — spé à préciser · niv. 13 · ilvl 4,2");
    expect(embed.fields?.find(f => f.name.startsWith("🔁"))?.value).toContain(`${icons.Paladin} Kevin · Duude · Paladin — spé à préciser · niv. 13 · ilvl 4,6`);
  });
  it("uses available server emojis and falls back to the cached catalog when REST fails", async () => {
    const list = [{ id: "1550000000000000001", name: "wow_pretre", available: true }, { id: "1550000000000000002", name: "wow_paladin", available: false }];
    expect(classEmojiMap(list)).toEqual({ Priest: icons.Priest });
    const guild = { emojis: { fetch: async () => { throw new Error("Offline"); }, cache: new Map(list.map(e => [e.id, e])) } };
    expect(await loadClassEmojis(guild as never)).toEqual({ Priest: icons.Priest });
  });
  it("keeps expanded rosters within all embed limits and never slices emoji tokens", () => {
    const rows = ["SIGNED_UP", "MAYBE", "WAITLISTED"].flatMap(status => ["TANK", "HEALER", "DPS"].flatMap(role => Array.from({ length: 45 }, (_, i) => ({ memberId: `${status}${role}${i}`, displayName: `Long-player-name-${i} — Long-Realm`, character: priest, role: role as "DPS", status }))));
    const core = { name: "Big Core", members: Array.from({ length: 90 }, (_, i) => ({ memberId: `missing${i}`, displayName: `Missing-character-${i} — Long-Realm`, character: priest, role: "DPS" as const, bench: i % 2 === 0 })) };
    const embed = buildSignupEmbed({ lang: "fr", now, raid, signups: rows, core, classEmojis: icons }).toJSON();
    const textLength = (embed.title?.length ?? 0) + (embed.footer?.text.length ?? 0) + (embed.fields ?? []).reduce((n, f) => n + f.name.length + f.value.length, 0);
    expect(textLength).toBeLessThanOrEqual(6000);
    for (const field of embed.fields ?? []) {
      expect(field.value.length).toBeLessThanOrEqual(1024);
      expect(field.value.replaceAll(icons.Priest, "")).not.toContain("<:wow_");
    }
    expect(clipRosterLines([icons.Priest + " Too long"], 10)).toBe("… +1");
  });
});
