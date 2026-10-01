import { EmbedBuilder } from "discord.js";
import type { RaidRole, RaidStatus } from "@prisma/client";
import { t, type Lang } from "../i18n.js";

// The live raid signup post: who signed up in each role (with the count and
// "FULL" when a role is at its limit), who is maybe or waiting, and for a
// core raid which players are core mains (⭐), on the bench (🪑) or still
// missing. Pure, so it can be tested without Discord.

export interface SignupRow { memberId: string; characterId?: string | null; displayName: string; role: RaidRole; status: string; }
export interface CoreRow { memberId: string; characterId?: string | null; backupCharacterIds?: string[]; displayName: string; role: RaidRole; bench: boolean; }

export interface SignupEmbedInput {
  lang: Lang;
  raid: {
    id: string; title: string; description: string | null; status: RaidStatus; scheduledAt: Date;
    tankLimit: number | null; healerLimit: number | null; dpsLimit: number | null;
  };
  signups: SignupRow[];
  core?: { name: string; members: CoreRow[] } | undefined;
}

const ROLES: RaidRole[] = ["TANK", "HEALER", "DPS"];
const ROLE_ICON: Record<RaidRole, string> = { TANK: "🛡️", HEALER: "💚", DPS: "⚔️" };
const FIELD_MAX = 1000;

function clip(lines: string[]): string {
  let text = "";
  for (let i = 0; i < lines.length; i++) {
    const next = text ? `${text}\n${lines[i]}` : lines[i] ?? "";
    if (next.length > FIELD_MAX - 20) return `${text}\n… +${lines.length - i}`;
    text = next;
  }
  return text || "—";
}

// Free slots per role on a raid with slot caps (roles without a cap are left out).
export function openSpots(caps: Record<RaidRole, number | null>, signups: { role: RaidRole; status: string }[]): { role: RaidRole; open: number }[] {
  return ROLES.flatMap((role) => {
    const cap = caps[role];
    if (cap === null) return [];
    const open = cap - signups.filter((s) => s.status === "SIGNED_UP" && s.role === role).length;
    return open > 0 ? [{ role, open }] : [];
  });
}

export function buildSignupEmbed(input: SignupEmbedInput): EmbedBuilder {
  const { lang, raid, signups, core } = input;
  const roleName = (role: RaidRole) => t(lang, `role.${role}` as const);
  const mains = new Set(core?.members.filter((m) => !m.bench).map((m) => m.memberId));
  const bench = new Set(core?.members.filter((m) => m.bench).map((m) => m.memberId));
  const mark = (memberId: string, characterId?: string | null) => {
    const spot = core?.members.find(member => member.memberId === memberId);
    if (characterId && spot && spot.characterId !== characterId && !spot.backupCharacterIds?.includes(characterId)) return "";
    return mains.has(memberId) ? "⭐ " : bench.has(memberId) ? "🪑 " : "";
  };
  const caps: Record<RaidRole, number | null> = { TANK: raid.tankLimit, HEALER: raid.healerLimit, DPS: raid.dpsLimit };
  const signed = signups.filter((s) => s.status === "SIGNED_UP");
  const byName = (a: SignupRow, b: SignupRow) => a.displayName.localeCompare(b.displayName);

  const embed = new EmbedBuilder()
    .setTitle(`⚜️ ${raid.title}`)
    .addFields(
      { name: t(lang, "signup.status"), value: t(lang, `status.${raid.status}` as const), inline: true },
      { name: t(lang, "signup.start"), value: `<t:${Math.floor(raid.scheduledAt.getTime() / 1000)}:F>`, inline: true },
      { name: t(lang, "signup.total"), value: String(signed.length), inline: true }
    )
    .setFooter({ text: raid.status === "PLANNED" ? t(lang, "signup.footer.open") : t(lang, "signup.footer.closed", { id: raid.id }) });
  if (raid.description) embed.setDescription(raid.description);

  for (const role of ROLES) {
    const players = signed.filter((s) => s.role === role).sort(byName);
    const cap = caps[role];
    const full = cap !== null && players.length >= cap;
    const count = cap !== null ? `${players.length}/${cap}` : String(players.length);
    embed.addFields({
      name: `${ROLE_ICON[role]} ${roleName(role)} ${count}${full ? ` · ${t(lang, "signup.full")}` : ""}`,
      value: clip(players.map((p) => `${mark(p.memberId, p.characterId)}${p.displayName}`)),
      inline: true
    });
  }

  const listOf = (status: string, showRole: boolean) => signups.filter((s) => s.status === status).sort(byName)
    .map((s) => `${mark(s.memberId, s.characterId)}${s.displayName}${showRole ? ` (${roleName(s.role)})` : ""}`);
  const maybe = listOf("MAYBE", true);
  const waitlist = signups.filter((s) => s.status === "WAITLISTED")
    .map((s) => `${mark(s.memberId, s.characterId)}${s.displayName} (${roleName(s.role)})`); // the store returns waitlisted players in order
  if (maybe.length) embed.addFields({ name: t(lang, "signup.maybe"), value: clip(maybe), inline: false });
  if (waitlist.length) embed.addFields({ name: t(lang, "signup.waitlist"), value: clip(waitlist), inline: false });

  if (core) {
    const answered = new Set(signups.map((s) => s.memberId));
    const missing = core.members.filter((m) => !m.bench && !answered.has(m.memberId)).sort((a, b) => a.displayName.localeCompare(b.displayName));
    const benchFree = core.members.filter((m) => m.bench && !answered.has(m.memberId)).sort((a, b) => a.displayName.localeCompare(b.displayName));
    embed.addFields({ name: t(lang, "signup.core"), value: `**${core.name}** — ${t(lang, "signup.coreLegend")}`, inline: false });
    if (missing.length) embed.addFields({ name: t(lang, "signup.coreMissing", { count: missing.length }), value: clip(missing.map((m) => `${m.displayName} (${roleName(m.role)})`)), inline: false });
    if (benchFree.length) embed.addFields({ name: t(lang, "signup.benchFree", { count: benchFree.length }), value: clip(benchFree.map((m) => `🪑 ${m.displayName} (${roleName(m.role)})`)), inline: false });
    // Not enough core members for tonight: anyone in the guild can take the free slots.
    const free = raid.status === "PLANNED" ? openSpots(caps, signups) : [];
    if (free.length) {
      embed.addFields({ name: t(lang, "signup.openSpots"), value: free.map((spot) => `${ROLE_ICON[spot.role]} ${spot.open} ${roleName(spot.role)}`).join(" · "), inline: false });
    }
  }
  return embed;
}
