import { EmbedBuilder, escapeMarkdown } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { Lang } from "../i18n.js";
import { groupSize } from "./dungeon-group.js";
import { parseLevelRange } from "./group-alerts.js";

// The PvP group finder (8.5/9.0): the same machinery as the dungeon group finder (DungeonGroup rows of kind PVP, the `dgrp:`
// buttons, waitlist, voice, 24-hour expiry, alerts), posted one message per group in the pvp-groups channel. This file is
// the pure part (form parsing, the "who's looking" list); the Discord side is commands/pvp-group.ts.

export const PVP_DEFAULT_SIZE = 10;
/** A leader may keep this many open PvP groups at once, so the channel stays readable. */
export const PVP_OPEN_PER_LEADER = 2;

export interface PvpForm { title: string; size: number; minLevel: number | null; maxLevel: number | null }

/** Pure: the create form. Title 3-80 characters; size 2-40 (default 10); levels like "10-19", "60" or "55+" (optional). */
export function parsePvpForm(input: { title: string; size?: string | null; levels?: string | null }): PvpForm {
  const title = input.title.trim().replace(/\s+/g, " ");
  if (title.length < 3 || title.length > 80) throw new Error("A group title must be 3 to 80 characters / Le titre doit compter de 3 à 80 caractères.");
  const asked = Number((input.size ?? "").trim());
  const size = groupSize("PVP", Number.isFinite(asked) && asked > 0 ? asked : PVP_DEFAULT_SIZE);
  const range = parseLevelRange(input.levels);
  return { title, size, minLevel: range?.min ?? null, maxLevel: range?.max ?? null };
}

export interface PvpGroupView {
  id: string; title: string; size: number; createdAt: Date; started: boolean;
  members: string[]; waiting: string[]; link: string | null; minLevel: number | null; maxLevel: number | null;
}

const levelText = (min: number | null, max: number | null) => min === null && max === null ? "" : (min ?? 1) === (max ?? 80) ? String(min) : (max ?? 80) >= 80 ? `${min}+` : `${min ?? 1}-${max}`;

/** Pure: one line per group for "who's looking", "my groups" and "upcoming". */
export function pvpGroupLine(group: PvpGroupView, lang: Lang): string {
  const fr = lang === "fr";
  const names = group.members.slice(0, 8).map(name => escapeMarkdown(name)).join(", ") + (group.members.length > 8 ? ` +${group.members.length - 8}` : "");
  const levels = levelText(group.minLevel, group.maxLevel);
  const head = `⚔️ **${escapeMarkdown(group.title)}** · ${group.members.length}/${group.size}${levels ? ` · ${fr ? "niv." : "lvl"} ${levels}` : ""}${group.started ? ` · ${fr ? "démarré" : "started"}` : ""}`;
  const rest = [names ? `${fr ? "Dans le groupe" : "In"}: ${names}` : (fr ? "Personne encore" : "Nobody yet"),
    group.waiting.length ? `${fr ? "En attente" : "Waiting"}: ${group.waiting.slice(0, 5).map(name => escapeMarkdown(name)).join(", ")}${group.waiting.length > 5 ? "…" : ""}` : "",
    group.link ? (fr ? `[Rejoindre sur le message](${group.link})` : `[Join on the post](${group.link})`) : ""].filter(Boolean).join(" · ");
  return `${head}\n${rest}`;
}

/** Pure: the ephemeral "who's looking" answer. */
export function lookingEmbed(groups: readonly PvpGroupView[], lang: Lang): EmbedBuilder {
  const fr = lang === "fr";
  const embed = new EmbedBuilder().setColor(0xd4a017).setTitle(fr ? "⚔️ Qui cherche un groupe JcJ" : "⚔️ Who's looking for a PvP group");
  if (!groups.length) return embed.setDescription(fr ? "Personne ne cherche pour l'instant. Appuyez sur **Créer** pour lancer un groupe : un message avec les boutons Tank/Soigneur/DPS est publié dans le salon des groupes." : "Nobody is looking right now. Press **Create** to start a group: one post with the Tank/Healer/DPS buttons goes up in the groups channel.");
  const lines: string[] = [];
  let used = 0;
  for (const group of groups.slice(0, 10)) {
    const line = pvpGroupLine(group, lang);
    if (used + line.length + 2 > 3800) { lines.push("…"); break; }
    lines.push(line); used += line.length + 2;
  }
  const people = new Set(groups.flatMap(group => [...group.members, ...group.waiting])).size;
  return embed.setDescription(lines.join("\n\n")).setFooter({ text: fr ? `${groups.length} groupe(s) ouvert(s) · ${people} joueur(s) · les groupes expirent après 24 h · /dungeon alerts pour être prévenu`
    : `${groups.length} open group(s) · ${people} player(s) · groups expire after 24 h · /dungeon alerts to get pinged` });
}

type FinderDb = Pick<PrismaClient, "dungeonGroup">;

/** Open or started PvP finder groups with their rosters, newest first. `memberId` limits to groups that member is in or leads. */
export async function loadPvpGroups(db: FinderDb, guildId: string, discordGuildId: string, memberId: string | null = null): Promise<PvpGroupView[]> {
  const rows = await db.dungeonGroup.findMany({
    where: { guildId, kind: { in: ["PVP", "WORLDPVP"] }, status: { in: ["OPEN", "STARTED"] }, ...(memberId ? { OR: [{ leaderId: memberId }, { signups: { some: { memberId } } }] } : {}) },
    include: { signups: { include: { member: { select: { displayName: true } } }, orderBy: { joinedAt: "asc" } } }, orderBy: { createdAt: "desc" }, take: 25 });
  return rows.map(row => ({
    id: row.id, title: row.title, size: row.maxSize, createdAt: row.createdAt, started: row.status === "STARTED",
    members: row.signups.filter(s => s.status === "SIGNED_UP").map(s => s.member.displayName), waiting: row.signups.filter(s => s.status === "WAITLISTED").map(s => s.member.displayName),
    link: row.signupChannelId && row.signupMessageId ? `https://discord.com/channels/${discordGuildId}/${row.signupChannelId}/${row.signupMessageId}` : null,
    minLevel: row.minLevel, maxLevel: row.maxLevel }));
}
