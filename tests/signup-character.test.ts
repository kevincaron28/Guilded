import { describe, expect, it, vi } from "vitest";
import { ownedSignupCharacter } from "../src/services/signup-character.js";
import { buildSignupEmbed } from "../src/services/signup-embed.js";
import { channelSpec, categoryNames } from "../src/setup-names.js";
import { PermissionFlagsBits as F } from "discord.js";
import { reportChannelOverwrites } from "../src/services/report-channel-permissions.js";

describe("character identities in signups", () => {
  const characters = [{ id: "a", name: "Ann", realm: "Quebec", memberId: "m" }, { id: "b", name: "Ann", realm: "Toronto", memberId: "m" }];
  const findMany = vi.fn().mockResolvedValue(characters);
  const database = { character: { findMany } };
  it("uses an owned ID or an unambiguous name and realm, never another player's character", async () => {
    expect((await ownedSignupCharacter(database as never, "g", "m", "b")).realm).toBe("Toronto");
    expect((await ownedSignupCharacter(database as never, "g", "m", "Ann-Quebec")).id).toBe("a");
    await expect(ownedSignupCharacter(database as never, "g", "m", "Ann")).rejects.toThrow(/royaume/);
    await expect(ownedSignupCharacter(database as never, "g", "m", "foreign")).rejects.toThrow(/Choisis ton personnage/);
    await expect(ownedSignupCharacter(database as never, "g", "m")).rejects.toThrow(/Choisis ton personnage/);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { memberId: "m", member: { guildId: "g" } } }));
  });
  it("marks only the primary character or an approved backup as belonging to the core", () => {
    const input = { lang: "fr" as const, raid: { id: "r", title: "Raid", description: null, status: "PLANNED" as const, scheduledAt: new Date(), tankLimit: null, healerLimit: null, dpsLimit: null },
      core: { name: "Alpha", members: [{ memberId: "m", characterId: "main", backupCharacterIds: ["backup"], displayName: "Main", role: "DPS" as const, bench: false }] },
      signups: [{ memberId: "m", characterId: "unlisted-alt", displayName: "Alt — Quebec", role: "DPS" as const, status: "SIGNED_UP" }] };
    expect(buildSignupEmbed(input).data.fields?.find(field => field.name.startsWith("⚔️"))?.value).toBe("Alt — Quebec");
    for (const characterId of ["main", "backup"]) {
      expect(buildSignupEmbed({ ...input, signups: [{ ...input.signups[0]!, characterId }] }).data.fields?.find(field => field.name.startsWith("⚔️"))?.value).toBe("⭐ Alt — Quebec");
    }
  });
  it("gives the WoW weekly report a managed read-only destination and recognizes the previous raid category", () => {
    expect(channelSpec("weeklyReportChannelId", "fr")).toMatchObject({ name: "bilan-hebdo-wow", access: "readonly", category: "raid" });
    expect(categoryNames("raid")).toContain("⚔️ Raids");
    expect(categoryNames("raid")).toContain("⚔️ Raids WoW");
  });
  it("preserves game visibility without copying open discussion permissions into the report", () => {
    const result = reportChannelOverwrites([{ id: "guild", type: 0, allow: 0n, deny: F.ViewChannel }, { id: "wow", type: 0, allow: F.ViewChannel | F.ReadMessageHistory | F.SendMessages, deny: 0n }], "guild", ["officer"]);
    expect(result.find(o => o.id === "guild")!.deny & F.ViewChannel).toBe(F.ViewChannel);
    expect(result.find(o => o.id === "guild")!.deny & F.SendMessages).toBe(F.SendMessages);
    expect(result.find(o => o.id === "wow")!.allow & F.SendMessages).toBe(0n);
    expect(result.find(o => o.id === "wow")!.allow & F.ViewChannel).toBe(F.ViewChannel);
    expect(result.find(o => o.id === "officer")!.allow).toBe(F.SendMessages);
  });
});
