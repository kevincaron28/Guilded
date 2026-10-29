import {
  ContainerBuilder, MessageFlags, SectionBuilder, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder, ThumbnailBuilder,
  escapeMarkdown, type ActionRowBuilder, type ButtonBuilder
} from "discord.js";
import type { RaidRole } from "../generated/prisma/client.js";
import { t, type Lang, type StringKey } from "../i18n.js";
import { characterIcon, characterName, freshGearCheck, type RoleEmojiKey } from "./character-display.js";
import { coreMark, openKindSpots, openSpots, type CoreRow, type SignupEmbedInput, type SignupRow } from "./signup-embed.js";
import type { DpsKind } from "./dps-kind.js";

// The signup post as Discord Components V2, read like a calendar event card: guild header,
// linked title, local time, a two-per-line summary, one block per role with a count badge
// and one class/spec icon per player (DPS split into melee and ranged once specs are known), then late, tentative, waitlist, bench, declined and
// pending. V2 has no side-by-side columns, so the blocks stack. A message holds 4000
// characters of text and 40 components: every heading stays, and long lists end in "+N more".

export const SIGNUP_TEXT_LIMIT = 4000;
export interface SignupLayoutInput extends SignupEmbedInput {
  guild?: { name: string; iconUrl?: string | null } | undefined;
  // The raid's native Discord event ("Interested" turns on Discord's reminders).
  eventUrl?: string | null | undefined;
}

const ROLES: RaidRole[] = ["TANK", "HEALER", "DPS"];
const ROLE_ICON: Record<RaidRole, string> = { TANK: "🛡️", HEALER: "💚", DPS: "⚔️" };
const KIND_ICON: Record<DpsKind, string> = { MELEE: "🗡️", RANGED: "🏹" };
const rowIcon = (row: { role: RaidRole; kind?: DpsKind | null }) => row.role === "DPS" && row.kind ? KIND_ICON[row.kind] : ROLE_ICON[row.role];
const LIST_FLOOR = 200;

function clip(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, Math.max(0, limit - 1))}…`;
}

interface Block { heading: string; note?: string; items: string[]; separator: string }

// Whole entries only, never half an emoji token; what is cut becomes "+N more".
function fit(items: string[], separator: string, budget: number, lang: Lang): string {
  if (!items.length) return "—";
  const full = items.join(separator);
  if (full.length <= budget) return full;
  const more = (count: number) => t(lang, "signup.more", { count });
  let text = "";
  let kept = 0;
  for (const item of items) {
    const next = text ? `${text}${separator}${item}` : item;
    if (kept + 1 === items.length || next.length + separator.length + more(items.length - kept - 1).length > budget) break;
    text = next;
    kept++;
  }
  return text ? `${text}${separator}${more(items.length - kept)}` : more(items.length);
}

// Shares the room between lists: a short list keeps all of it, the longest ones split the rest.
function allocate(sizes: number[], total: number): number[] {
  const budget = sizes.map(() => 0);
  let open = sizes.map((_, index) => index);
  let left = Math.max(0, total);
  while (open.length) {
    const share = Math.floor(left / open.length);
    const small = open.filter(index => sizes[index]! <= share);
    if (!small.length) {
      for (const index of open) budget[index] = share;
      break;
    }
    for (const index of small) { budget[index] = sizes[index]!; left -= sizes[index]!; }
    open = open.filter(index => sizes[index]! > share);
  }
  return budget;
}

export function signupLayout(input: SignupLayoutInput, buttons: ActionRowBuilder<ButtonBuilder>[]) {
  const { lang, raid, signups, core } = input;
  const now = input.now ?? new Date();
  const emojis = input.classEmojis ?? {};
  const mark = coreMark(core);
  const unix = (date: Date) => Math.floor(date.getTime() / 1000);
  const byName = (a: { displayName: string }, b: { displayName: string }) => a.displayName.localeCompare(b.displayName);
  const roleIcon = (role: RaidRole) => emojis[`ROLE:${role}` as RoleEmojiKey] ?? ROLE_ICON[role];
  // A linked character shows by its name alone, as in game; otherwise the member's label.
  const player = (row: SignupRow | CoreRow, withRole = false, lateMark = true) => {
    const icon = characterIcon(row.character, emojis);
    const issues = freshGearCheck(row.character, now)?.issues ?? 0;
    const name = row.character?.name ? characterName({ name: row.character.name, displayName: row.character.displayName ?? null }) : row.displayName;
    return `${"bench" in row ? "" : mark(row.memberId, row.characterId)}${withRole ? `${rowIcon(row)} ` : ""}${icon ? `${icon} ` : ""}`
      + `${escapeMarkdown(clip(name, 64))}${lateMark && "late" in row && row.late ? " ⏰" : ""}${issues ? ` \`⚠️ ${issues}\`` : ""}`;
  };

  const active = signups.filter(s => s.status !== "CANCELLED");
  const signed = signups.filter(s => s.status === "SIGNED_UP");
  const caps: Record<RaidRole, number | null> = { TANK: raid.tankLimit, HEALER: raid.healerLimit, DPS: raid.dpsLimit };
  const kindCaps: Record<DpsKind, number | null> = { MELEE: raid.meleeLimit ?? null, RANGED: raid.rangedLimit ?? null };
  // The DPS block splits once a limit is set or any DPS player's spec tells melee from ranged.
  const dps = signed.filter(s => s.role === "DPS");
  const splitDps = kindCaps.MELEE !== null || kindCaps.RANGED !== null || dps.some(s => s.kind);
  const seats = ROLES.every(role => caps[role] !== null) ? ROLES.reduce((sum, role) => sum + caps[role]!, 0) : null;

  // Header: guild, linked title, the officer's description and the signup deadline.
  const title = `⚜️ ${clip(raid.title, 200)}`;
  const header = [
    input.guild ? `**${escapeMarkdown(clip(input.guild.name, 100))}**` : "",
    `### ${input.eventUrl ? `[${title.replace(/[[\]]/g, "")}](${input.eventUrl})` : title}`,
    raid.description ? clip(raid.description, 500) : "",
    raid.status === "PLANNED" && raid.signupsCloseAt
      ? `-# 🔒 ${t(lang, "signup.lock", { hours: Math.max(0, Math.round((raid.scheduledAt.getTime() - raid.signupsCloseAt.getTime()) / 3_600_000)), when: `<t:${unix(raid.signupsCloseAt)}:R>` })}`
      : ""
  ].filter(Boolean).join("\n");

  // Local time, then a compact summary two facts per line.
  const checks = signed.map(row => freshGearCheck(row.character, now)).filter(check => check !== null);
  const facts: [string, string][] = [[t(lang, "signup.status"), t(lang, `status.${raid.status}` as const)]];
  if (core) facts.push([t(lang, "signup.core"), escapeMarkdown(clip(core.name, 80))]);
  facts.push([t(lang, "signup.attendees"), `✅ ${signed.length}${seats !== null ? `/${seats}` : ""}`]);
  if (splitDps) facts.push([t(lang, "role.DPS"), `${ROLE_ICON.DPS} ${dps.length}${caps.DPS !== null ? `/${caps.DPS}` : ""}`]);
  if (checks.length) {
    const average = checks.reduce((sum, check) => sum + check.itemLevel, 0) / checks.length;
    facts.push([t(lang, "signup.itemLevel"), t(lang, "signup.itemLevelValue", {
      value: average.toLocaleString(lang === "fr" ? "fr-CA" : "en-US", { maximumFractionDigits: 1 }), count: checks.length
    })]);
  }
  const pairs: string[] = [];
  for (let index = 0; index < facts.length; index += 2) {
    pairs.push(facts.slice(index, index + 2).map(([label, value]) => `**${label}** ${value}`).join(" · "));
  }
  const summary = [`**${t(lang, "signup.localTime")}**`, `<t:${unix(raid.scheduledAt)}:F> · <t:${unix(raid.scheduledAt)}:R>`, "", ...pairs].join("\n");

  // One block per role, a player per line; the counts include late players, who keep their seat.
  const badge = (icon: string, label: string, count: string) => `${icon} **\`${label}\`** \`${count}\``;
  const block = (icon: string, key: StringKey, players: SignupRow[], cap: number | null): Block => ({
    heading: `${badge(icon, t(lang, key), cap !== null ? `${players.length}/${cap}` : String(players.length))}${cap !== null && players.length >= cap ? ` · ${t(lang, "signup.full")}` : ""}`,
    items: [...players].sort(byName).map(p => player(p)), separator: "\n"
  });
  const roleBlocks: Block[] = ROLES.flatMap(role => {
    const players = signed.filter(s => s.role === role);
    if (role !== "DPS" || !splitDps) return [block(roleIcon(role), `signup.column.${role}` as const, players, caps[role])];
    const unknown = players.filter(p => !p.kind);
    return [
      block(KIND_ICON.MELEE, "signup.column.MELEE", players.filter(p => p.kind === "MELEE"), kindCaps.MELEE),
      block(KIND_ICON.RANGED, "signup.column.RANGED", players.filter(p => p.kind === "RANGED"), kindCaps.RANGED),
      ...(unknown.length ? [block(roleIcon(role), "signup.column.DPS_UNKNOWN", unknown, null)] : [])
    ];
  });

  // The other answers flow on shared lines, which keeps long lists compact.
  const listBlocks: Block[] = [];
  const list = (icon: string, key: StringKey, rows: string[], note?: string, count = rows.length) => {
    if (rows.length) listBlocks.push({ heading: badge(icon, t(lang, key), String(count)), ...(note ? { note } : {}), items: rows, separator: " · " });
  };
  list("⏰", "signup.section.late", active.filter(s => s.late).sort(byName).map(s => player(s, true, false)));
  list("❔", "signup.section.tentative", active.filter(s => s.status === "MAYBE").sort(byName).map(s => player(s, true)));
  // The store returns waitlisted players in order.
  list("🕒", "signup.section.waitlist", active.filter(s => s.status === "WAITLISTED").map(s => player(s, true)), t(lang, "signup.waitlistOrder"));
  const answered = new Set(signups.map(s => s.memberId));
  const coreMembers = [...(core?.members ?? [])].sort(byName);
  list("🪑", "signup.section.bench", coreMembers.filter(m => m.bench && !answered.has(m.memberId)).map(m => player(m, true)));
  list("🚫", "signup.section.declined", signups.filter(s => s.status === "CANCELLED").sort(byName).map(s => player(s)));
  list("⏳", "signup.section.pending", coreMembers.filter(m => !m.bench && !answered.has(m.memberId)).map(m => player(m, true)));
  // Not enough core members for tonight: anyone in the guild can take the free seats.
  const free = core && raid.status === "PLANNED" ? openSpots(caps, signups) : [];
  const freeKinds = core && raid.status === "PLANNED" ? openKindSpots(kindCaps, signups) : [];
  list("🙋", "signup.section.openSpots", [...free.map(spot => `${ROLE_ICON[spot.role]} ${spot.open} ${t(lang, `role.${spot.role}` as const)}`),
    ...freeKinds.map(spot => `${KIND_ICON[spot.kind]} ${spot.open} ${t(lang, `role.${spot.kind}` as const)}`)],
    t(lang, "signup.openSpotsNote"), free.reduce((sum, spot) => sum + spot.open, 0));

  const footer = [
    raid.status === "PLANNED" ? t(lang, "signup.footer.open") : t(lang, "signup.footer.closed", { id: raid.id }),
    core ? t(lang, "signup.coreLegend") : "",
    [...signups, ...(core?.members ?? [])].some(row => freshGearCheck(row.character, now)?.issues) ? t(lang, "signup.issuesLegend") : "",
    t(lang, "signup.fullRoster")
  ].filter(Boolean).map(line => `-# ${line}`).join("\n");

  // Every heading and the "+N more" of a fully cut list always fit. The role blocks come
  // first; each other list keeps room for a few names before they take the rest.
  const blocks = [...roleBlocks, ...listBlocks];
  const lead = (block: Block) => `${block.heading}${block.note ? `\n-# ${block.note}` : ""}\n>>> `;
  const reserve = (block: Block) => block.items.length ? t(lang, "signup.more", { count: block.items.length }).length : 1;
  const wanted = (block: Block) => Math.max(0, block.items.join(block.separator).length - reserve(block));
  const room = SIGNUP_TEXT_LIMIT - [header, summary, footer].reduce((sum, text) => sum + text.length, 0)
    - blocks.reduce((sum, block) => sum + lead(block).length + reserve(block), 0);
  const roleExtra = allocate(roleBlocks.map(wanted), room - listBlocks.reduce((sum, block) => sum + Math.min(wanted(block), LIST_FLOOR), 0));
  const extra = [...roleExtra, ...allocate(listBlocks.map(wanted), room - roleExtra.reduce((sum, value) => sum + value, 0))];
  const texts = blocks.map((block, index) => `${lead(block)}${fit(block.items, block.separator, reserve(block) + extra[index]!, lang)}`);

  const container = new ContainerBuilder().setAccentColor(0xd4af37);
  const headerText = new TextDisplayBuilder().setContent(header);
  if (input.guild?.iconUrl) {
    container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(headerText)
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(input.guild.iconUrl).setDescription(clip(input.guild.name, 100))));
  } else container.addTextDisplayComponents(headerText);
  const divider = () => new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(summary))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(...texts.slice(0, roleBlocks.length).map(text => new TextDisplayBuilder().setContent(text)));
  if (listBlocks.length) {
    container.addSeparatorComponents(divider())
      .addTextDisplayComponents(...texts.slice(roleBlocks.length).map(text => new TextDisplayBuilder().setContent(text)));
  }
  container.addSeparatorComponents(divider()).addTextDisplayComponents(new TextDisplayBuilder().setContent(footer));
  if (buttons.length) container.addActionRowComponents(...buttons);
  return { components: [container], flags: MessageFlags.IsComponentsV2 as const, allowedMentions: { parse: [] } };
}
