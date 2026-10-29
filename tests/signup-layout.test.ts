import { describe, expect, it } from "vitest";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from "discord.js";
import { signupLayout, SIGNUP_TEXT_LIMIT, type SignupLayoutInput } from "../src/services/signup-layout.js";
import { CLASS_EMOJI_NAMES, ROLE_EMOJI_NAMES, classEmojiMap, type DisplayCharacter } from "../src/services/character-display.js";
import { WOW_SPECIALIZATIONS } from "../src/wow-specializations.js";
import type { CoreRow, SignupRow } from "../src/services/signup-embed.js";

const now = new Date("2026-12-09T12:00:00Z");
const start = new Date("2026-12-10T01:00:00Z");
// Real-length custom emoji tokens (19-digit IDs), so the text budget is tested at its worst.
const emojis = classEmojiMap([...Object.values(CLASS_EMOJI_NAMES), ...Object.values(ROLE_EMOJI_NAMES), ...WOW_SPECIALIZATIONS.map(spec => spec.emojiName)]
  .map((name, index) => ({ id: String(1234567890123456000n + BigInt(index)), name })));
const SPECS: Record<"TANK" | "HEALER" | "DPS", [string, string][]> = {
  TANK: [["Warrior", "Protection"], ["Druid", "Guardian"]],
  HEALER: [["Priest", "Holy"], ["Druid", "Restoration"], ["Paladin", "Holy"], ["Shaman", "Restoration"]],
  DPS: [["Mage", "Frost"], ["Rogue", "Combat"], ["Warlock", "Destruction"], ["Hunter", "Marksmanship"], ["Warrior", "Fury"], ["Shaman", "Enhancement"]]
};
const character = (name: string, role: keyof typeof SPECS, index: number, gear?: { issues: number; hoursAgo: number }): DisplayCharacter => {
  const [className, spec] = SPECS[role][index % SPECS[role].length]!;
  return { name, className, spec, level: 60, readinessSnapshots: gear
    ? [{ itemLevel: 62 + index % 5, inspectedAt: new Date(now.getTime() - gear.hoursAgo * 3_600_000), _count: { findings: gear.issues } }] : [] };
};
const buttons = () => [new ActionRowBuilder<ButtonBuilder>().addComponents(
  ...["TANK", "HEALER", "DPS", "MAYBE", "CANCEL"].map(action => new ButtonBuilder().setCustomId(`raidsignup:r:${action}`).setLabel(action).setStyle(ButtonStyle.Secondary))
), new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId("raidsignup:r:LATE").setLabel("Late").setStyle(ButtonStyle.Secondary))];

// A full raid of the given seats, plus the other answers a large guild produces.
function raid(size: { tanks: number; healers: number; dps: number }, extras = { maybe: 0, waitlist: 0, declined: 0, pending: 0, bench: 0 }, nameLength = 10): SignupLayoutInput {
  const signups: SignupRow[] = [];
  const name = (prefix: string, index: number) => `${prefix}${index}`.padEnd(nameLength, "x");
  for (const [role, count] of [["TANK", size.tanks], ["HEALER", size.healers], ["DPS", size.dps]] as const) {
    for (let index = 0; index < count; index++) {
      const id = `${role}-${index}`;
      signups.push({ memberId: id, characterId: `c-${id}`, character: character(name(role[0]!, index), role, index, index % 3 === 0 ? { issues: index % 2 + 1, hoursAgo: 2 } : undefined),
        displayName: `${name(role[0]!, index)} · Member${index}`, role, status: "SIGNED_UP", late: index === 1 });
    }
  }
  for (let index = 0; index < extras.maybe; index++) signups.push({ memberId: `maybe-${index}`, displayName: name("Maybe", index), role: "DPS", status: "MAYBE" });
  for (let index = 0; index < extras.waitlist; index++) signups.push({ memberId: `wait-${index}`, displayName: name("Wait", index), role: "HEALER", status: "WAITLISTED" });
  for (let index = 0; index < extras.declined; index++) signups.push({ memberId: `no-${index}`, displayName: name("Absent", index), role: "DPS", status: "CANCELLED" });
  const members: CoreRow[] = [
    ...signups.filter(row => row.status === "SIGNED_UP").slice(0, 3).map(row => ({ memberId: row.memberId, characterId: row.characterId ?? null, displayName: row.displayName, role: row.role, bench: false })),
    ...Array.from({ length: extras.pending }, (_, index) => ({ memberId: `pending-${index}`, character: character(name("Pending", index), "DPS", index), displayName: name("Pending", index), role: "DPS" as const, bench: false })),
    ...Array.from({ length: extras.bench }, (_, index) => ({ memberId: `bench-${index}`, displayName: name("Bench", index), role: "HEALER" as const, bench: true }))
  ];
  return {
    lang: "en", now, classEmojis: emojis, signups,
    raid: { id: "r", title: "Raid Night", description: "Please sign up below! Benches will be announced before raid.", status: "PLANNED", scheduledAt: start,
      tankLimit: size.tanks, healerLimit: size.healers, dpsLimit: size.dps, signupsCloseAt: new Date(start.getTime() - 24 * 3_600_000) },
    core: extras.pending || extras.bench ? { name: "Raiders", members } : undefined,
    guild: { name: "Soup Squad", iconUrl: "https://cdn.discordapp.com/icons/1/abc.png" },
    eventUrl: "https://discord.com/events/111111111111111111/222222222222222222"
  };
}

interface Node { type: number; content?: string; components?: Node[]; accessory?: Node; media?: { url: string } }
function render(input: SignupLayoutInput, withButtons = true) {
  const payload = signupLayout(input, withButtons ? buttons() : []);
  const root = payload.components[0]!.toJSON() as Node;
  const nodes: Node[] = [];
  const walk = (node: Node) => { nodes.push(node); node.components?.forEach(walk); if (node.accessory) walk(node.accessory); };
  walk(root);
  const texts = nodes.filter(node => node.type === 10).map(node => node.content!);
  return { payload, root, nodes, texts, text: texts.join("\n") };
}

describe("raid signup post (Components V2)", () => {
  it.each([
    ["10-player", { tanks: 2, healers: 2, dps: 6 }],
    ["20-player", { tanks: 2, healers: 4, dps: 14 }],
    ["40-player", { tanks: 2, healers: 8, dps: 30 }]
  ] as const)("lays out a full %s raid like an event card within Discord's limits", (_, size) => {
    const input = raid(size, { maybe: 3, waitlist: 2, declined: 4, pending: 5, bench: 2 });
    const { payload, nodes, texts, text } = render(input);
    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    expect(payload).not.toHaveProperty("embeds");
    expect(payload.allowedMentions.parse).toEqual([]);
    expect(texts.join("").length).toBeLessThanOrEqual(SIGNUP_TEXT_LIMIT);
    expect(nodes.length).toBeLessThanOrEqual(40);
    expect(text).not.toMatch(/\+\d+ more/);
    // Header: guild name and icon, title linked to the Discord event, description and lock time.
    expect(texts[0]).toMatch(/^\*\*Soup Squad\*\*\n### \[⚜️ Raid Night\]\(https:\/\/discord\.com\/events\/\d+\/\d+\)\nPlease sign up below!/);
    expect(nodes.find(node => node.type === 11)?.media?.url).toContain("cdn.discordapp.com/icons");
    expect(text).toContain(`Signups lock 24 h before the start (<t:${start.getTime() / 1000 - 86400}:R>).`);
    expect(text).toContain(`**Local time**\n<t:${start.getTime() / 1000}:F> · <t:${start.getTime() / 1000}:R>`);
    const seats = size.tanks + size.healers + size.dps;
    expect(text).toContain(`**Status** Planned · **Raid core** Raiders\n**Attendees** ✅ ${seats}/${seats} · **Avg item level**`);
    // Role blocks with icon, uppercase label and count badge, then one player per line.
    expect(text).toMatch(new RegExp(`<:wow_role_healer:\\d+> \\*\\*\`HEALERS\`\\*\\* \`${size.healers}/${size.healers}\` · FULL\\n>>> `));
    expect(text).toMatch(/\*\*`TANKS`\*\* `2\/2`/);
    expect(text).toMatch(new RegExp(`\\*\\*\`DPS\`\\*\\* \`${size.dps}/${size.dps}\``));
    expect(text).toContain("<:wow_spec_priest_holy:"); // one spec icon per player
    expect(text).toMatch(/H1xxxxxxxx ⏰/);
    expect(text).toContain("`⚠️ 1`");
    expect(text).toContain("⚠️ N: open warnings from the addon's gear check");
    for (const [heading, count] of [["LATE", 3], ["TENTATIVE", 3], ["WAITLIST", 2], ["BENCH", 2], ["DECLINED", 4], ["PENDING", 5]] as const) {
      expect(text).toContain(`**\`${heading}\`** \`${count}\``);
    }
    expect(text).toContain("⭐ ");
    expect(text).toContain("Full roster: /raid roster");
    expect(JSON.stringify(payload.components[0]!.toJSON())).toContain("raidsignup:r:LATE");
  });

  it("shortens long lists with +N more, keeping every heading under the limits", () => {
    const input = raid({ tanks: 4, healers: 10, dps: 40 }, { maybe: 20, waitlist: 15, declined: 30, pending: 60, bench: 20 }, 24);
    const { nodes, texts, text } = render(input);
    expect(texts.join("").length).toBeLessThanOrEqual(SIGNUP_TEXT_LIMIT);
    expect(nodes.length).toBeLessThanOrEqual(40);
    expect(text).toMatch(/\+\d+ more/);
    for (const heading of ["TANKS", "HEALERS", "DPS", "LATE", "TENTATIVE", "WAITLIST", "BENCH", "DECLINED", "PENDING"]) {
      expect(text).toContain(`**\`${heading}\`**`);
    }
    // No custom emoji is cut in half.
    expect(text.match(/<:[a-z_]+:\d{19}>/g)?.length).toBe(text.match(/<:/g)?.length);
    // The visible players and "+N more" add up to the whole role.
    const dps = texts.find(content => content.includes("**`DPS`**"))!;
    const shown = dps.split("\n").filter(line => / D\d+x/.test(line)).length;
    const more = Number(/\+(\d+) more/.exec(dps)?.[1] ?? 0);
    expect(more).toBeGreaterThan(0);
    expect(shown + more).toBe(40);
  });

  it("renders an empty raid with every role block and no other sections", () => {
    const empty: SignupLayoutInput = { ...raid({ tanks: 2, healers: 4, dps: 14 }), signups: [], core: undefined, guild: undefined, eventUrl: null };
    const { texts, text } = render(empty);
    expect(texts[0]).toMatch(/^### ⚜️ Raid Night\n/);
    expect(text).toContain("**Attendees** ✅ 0/20");
    expect(text).not.toContain("Avg item level");
    expect(text.match(/>>> —/g)).toHaveLength(3);
    for (const heading of ["LATE", "TENTATIVE", "WAITLIST", "BENCH", "DECLINED", "PENDING", "⚠️ N"]) expect(text).not.toContain(heading);
  });

  it("writes the post in French", () => {
    const input = { ...raid({ tanks: 2, healers: 4, dps: 14 }, { maybe: 1, waitlist: 1, declined: 1, pending: 1, bench: 1 }), lang: "fr" as const };
    const { text } = render(input);
    expect(text).toContain("**Heure locale**");
    expect(text).toContain("Les inscriptions ferment 24 h avant le début");
    expect(text).toContain("**Statut** Prévu · **Core de raid** Raiders");
    expect(text).toMatch(/\*\*Participants\*\* ✅ 20\/20 · \*\*Niveau d'objet moyen\*\* [\d,]+ \(\d+ vérifiés\)/);
    for (const heading of ["TANKS", "SOIGNEURS", "DPS", "EN RETARD", "PEUT-ÊTRE", "LISTE D'ATTENTE", "BANC", "ABSENTS", "SANS RÉPONSE"]) expect(text).toContain(`**\`${heading}\`**`);
    expect(text).toContain("COMPLET");
    expect(text).toContain("Liste complète : /raid roster");
    expect(text).toContain("alertes de la vérification d'équipement");
    expect(text).not.toMatch(/Signups|Attendees|Full roster|DECLINED|PENDING/);
  });

  it("badges only gear checks from the last 24 hours and counts late players in their seat", () => {
    const signups: SignupRow[] = [
      { memberId: "a", characterId: "a", character: character("Fresh", "TANK", 0, { issues: 3, hoursAgo: 1 }), displayName: "Fresh · A", role: "TANK", status: "SIGNED_UP", late: true },
      { memberId: "b", characterId: "b", character: character("Stale", "TANK", 1, { issues: 2, hoursAgo: 30 }), displayName: "Stale · B", role: "TANK", status: "SIGNED_UP" },
      { memberId: "c", displayName: "No_character", role: "DPS", status: "MAYBE", late: true }
    ];
    const { text } = render({ ...raid({ tanks: 2, healers: 0, dps: 0 }), signups, core: undefined });
    expect(text).toContain("Fresh ⏰ `⚠️ 3`");
    expect(text).toMatch(/<:wow_spec_druid_guardian:\d+> Stale$/m);
    expect(text).not.toContain("⚠️ 2");
    expect(text).toContain("**`TANKS`** `2/2` · FULL");
    expect(text).toContain("**`LATE`** `2`");
    expect(text).toContain("No\\_character"); // names cannot add Discord formatting
    expect(text).not.toContain("OPEN SPOTS"); // only core raids invite the whole guild
    expect(text).toContain("**Avg item level** 62 (1 checked)");
  });

  it("counts open seats on a core raid that is short of players", () => {
    const input = raid({ tanks: 2, healers: 4, dps: 14 }, { maybe: 0, waitlist: 0, declined: 0, pending: 1, bench: 0 });
    const { text } = render({ ...input, raid: { ...input.raid, tankLimit: 3, dpsLimit: 16 } });
    expect(text).toContain("🙋 **`OPEN SPOTS`** `3`\n-# anyone in the guild can sign up to fill\n>>> 🛡️ 1 Tank · ⚔️ 2 DPS");
  });

  it("keeps the closed raid's status and removes the signup buttons", () => {
    const input = raid({ tanks: 2, healers: 4, dps: 14 });
    const { root, text } = render({ ...input, raid: { ...input.raid, status: "COMPLETED" } }, false);
    expect(text).toContain("**Status** Completed");
    expect(text).toContain("Raid ID: r");
    expect(text).not.toContain("Signups lock");
    expect(root.components!.some(node => node.type === 1)).toBe(false);
  });
});
