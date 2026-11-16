import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, type ButtonInteraction, type Client } from "discord.js";
import { z } from "zod";
import type { PrismaClient } from "../generated/prisma/client.js";
import { asLang, t, type Lang } from "../i18n.js";
import { hostedPilot } from "../hosted-pilot.js";
import { markGuildChanged } from "./standings-feed.js";
import { CLOSE_TEXT, GAME_STATE_TEXT, type CloseReason } from "./invite-expiry-text.js";

// Invite request expiry (9.3.5). Owner report: five people asked for an invite and were re-invited every day for days
// (they had changed their minds or joined another guild) because a request never went away. A request now ends when:
//   1. the requester leaves the Discord server (handleRequesterLeft);
//   2. the requester answers "No, cancel" to the one confirmation DM, or does not answer in time;
//   3. an officer removes it in the addon.
// The addon reports what the game answered to each /ginvite and how many invites were sent (applyInviteReports). After
// EXPIRY.maxInvites invites with no join, or EXPIRY.maxAgeDays days with no join, the requester gets ONE DM
// (reply to their own request: its opt-in) and the request closes after EXPIRY.graceDays more days with no "Yes".
// Requests that were already old when this shipped get the same DM flow once; none is closed instantly.
// Officer switches: /mod invites settings expiry:false (no automatic closing at all), expirydm:false (no DM: a request
// that reached the limit closes straight away instead).

/** The only place the numbers live. */
export const EXPIRY = { maxInvites: 3, maxAgeDays: 4, graceDays: 3, dmPerSweep: 10 } as const;
const DAY_MS = 86_400_000;

export const KEEP_PREFIX = "invite:keep:";
export const DROP_PREFIX = "invite:drop:";

export { CLOSE_TEXT, GAME_STATE_TEXT, type CloseReason };

type Database = Pick<PrismaClient, "inviteRequest" | "guildSettings">;

/** Closes every open request of one member in one Discord server. Returns how many were closed. */
export async function closeRequestsOf(database: Pick<PrismaClient, "inviteRequest">, where: { guildId?: string; discordGuildId?: string; discordUserId: string }, reason: CloseReason, now = new Date()): Promise<number> {
  const result = await database.inviteRequest.updateMany({
    where: { status: "PENDING", discordUserId: where.discordUserId, ...(where.guildId ? { guildId: where.guildId } : {}), ...(where.discordGuildId ? { guild: { discordId: where.discordGuildId } } : {}) },
    data: { status: "CLOSED", closedAt: now, closeReason: reason, cleanupAt: now, cleanedAt: null }
  });
  return result.count;
}

/** GuildMemberRemove: whoever leaves the Discord server has no open request there any more. */
export async function handleRequesterLeft(database: Pick<PrismaClient, "inviteRequest" | "guildSettings">, discordGuildId: string, discordUserId: string): Promise<number> {
  const rows = await database.guildSettings.findMany({ where: { guild: { discordId: discordGuildId } }, select: { guildId: true } });
  // Leaving always cancels, even with the expiry switch off: the person is no longer there to be invited.
  const closed = await closeRequestsOf(database, { discordGuildId, discordUserId }, "left_discord");
  if (closed) for (const row of rows) markGuildChanged(row.guildId);
  return closed;
}

// What an officer's addon says about the invites it sent (companion export "inviteReports"): per request id, how many
// invites were sent in game, what the game last answered, and whether the officer removed the row.
const reportSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{8,40}$/),
  sent: z.number().int().min(0).max(999).default(0),
  state: z.enum(["declined", "inguild", "notfound"]).nullish(),
  removed: z.boolean().optional(),
  at: z.number().int().min(1_600_000_000).max(4_102_444_800)
});
export type InviteReport = z.infer<typeof reportSchema>;
export function parseInviteReports(rows: readonly unknown[] | undefined): InviteReport[] {
  return (rows ?? []).flatMap((row) => { const parsed = reportSchema.safeParse(row); return parsed.success ? [parsed.data] : []; }).slice(0, 60);
}

/** Applies reports from an officer's upload. Idempotent: counts only grow, an answer counts only when newer than the stored one. */
export async function applyInviteReports(database: Pick<PrismaClient, "inviteRequest">, guildId: string, reports: readonly InviteReport[], now = new Date()): Promise<number> {
  if (!reports.length) return 0;
  const rows = await database.inviteRequest.findMany({ where: { guildId, id: { in: reports.map((report) => report.id) } },
    select: { id: true, status: true, invitesSent: true, gameState: true, gameStateAt: true, lastInviteAt: true } });
  const byId = new Map(rows.map((row) => [row.id, row]));
  let changed = 0;
  for (const report of reports) {
    const row = byId.get(report.id);
    if (!row) continue;
    const at = new Date(report.at * 1000);
    const data: { cleanupAt?: Date; invitesSent?: number; lastInviteAt?: Date; gameState?: string | null; gameStateAt?: Date; status?: string; closedAt?: Date; closeReason?: string } = {};
    if (report.sent > row.invitesSent) { data.invitesSent = report.sent; data.lastInviteAt = at; }
    if (!row.gameStateAt || at >= row.gameStateAt) {
      const next = report.state ?? null;
      if (next !== row.gameState) { data.gameState = next; data.gameStateAt = at; }
    }
    if (report.removed && row.status === "PENDING") { data.status = "CLOSED"; data.closedAt = now; data.closeReason = "officer_removed"; data.cleanupAt = now; }
    if (Object.keys(data).length) { await database.inviteRequest.update({ where: { id: row.id }, data }); changed += 1; }
  }
  if (changed) markGuildChanged(guildId);
  return changed;
}

interface DueRow { id: string; discordUserId: string; displayName: string; guildId: string; createdAt: Date; invitesSent: number; expiryBaseAt: Date | null; expiryBaseSent: number; confirmAskedAt: Date | null }

/** Whether a waiting request has reached a limit: 3 invites since it started (or was kept), or 4 days since then. */
export function limitReached(row: Pick<DueRow, "createdAt" | "invitesSent" | "expiryBaseAt" | "expiryBaseSent">, now: Date): boolean {
  const base = row.expiryBaseAt ?? row.createdAt;
  return row.invitesSent - row.expiryBaseSent >= EXPIRY.maxInvites || now.getTime() - base.getTime() >= EXPIRY.maxAgeDays * DAY_MS;
}

export function confirmRow(lang: Lang, requestId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${KEEP_PREFIX}${requestId}`).setLabel(t(lang, "invite.keepButton")).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${DROP_PREFIX}${requestId}`).setLabel(t(lang, "invite.dropButton")).setStyle(ButtonStyle.Secondary));
}

type SweepClient = Pick<Client, "guilds" | "users">;
export interface SweepResult { asked: number; closed: number }

/**
 * One pass over every server that runs the invite queue (every 30 minutes). Asks once, closes after the grace period.
 * Never throws for one server's trouble; the caller reports an unexpected error.
 */
export async function sweepInviteExpiry(client: SweepClient, database: Database, now = new Date()): Promise<SweepResult> {
  const servers = await database.guildSettings.findMany({
    where: { inviteQueueEnabled: true, inviteExpiryEnabled: true },
    select: { guildId: true, language: true, inviteExpiryDmEnabled: true, guild: { select: { id: true, discordId: true, name: true } } }
  });
  const total: SweepResult = { asked: 0, closed: 0 };
  for (const server of servers) {
    if (!hostedPilot.allows(server.guild.discordId)) continue;
    let touched = 0;
    // Asked long enough ago with no answer: closed.
    const grace = new Date(now.getTime() - EXPIRY.graceDays * DAY_MS);
    const lapsed = await database.inviteRequest.updateMany({ where: { guildId: server.guildId, status: "PENDING", confirmAskedAt: { lte: grace } }, data: { status: "CLOSED", closedAt: now, closeReason: "no_answer", cleanupAt: now, cleanedAt: null } });
    touched += lapsed.count; total.closed += lapsed.count;
    // Not yet asked and past a limit.
    const waiting = await database.inviteRequest.findMany({ where: { guildId: server.guildId, status: "PENDING", confirmAskedAt: null }, orderBy: { createdAt: "desc" }, take: 500,
      select: { id: true, discordUserId: true, displayName: true, guildId: true, createdAt: true, invitesSent: true, expiryBaseAt: true, expiryBaseSent: true, confirmAskedAt: true } });
    const due = waiting.filter((row) => limitReached(row, now));
    const lang = asLang(server.language);
    const discordGuild = due.length ? await client.guilds.fetch(server.guild.discordId).catch(() => null) : null;
    const seen = new Set<string>();
    let asked = 0;
    for (const row of due) {
      if (seen.has(row.discordUserId)) continue; // newest request first: one question per member
      if (!server.inviteExpiryDmEnabled) {
        const count = await closeRequestsOf(database, { guildId: server.guildId, discordUserId: row.discordUserId }, "expired", now);
        touched += count; total.closed += count; seen.add(row.discordUserId);
        continue;
      }
      if (asked >= EXPIRY.dmPerSweep) break; // the rest next time: no burst of DMs on the first pass after a deploy
      seen.add(row.discordUserId);
      // A member who is no longer in the server (the leave was missed) is closed, not asked.
      const inServer = discordGuild ? await discordGuild.members.fetch(row.discordUserId).then(() => true, (error: unknown) => (error as { code?: number } | null)?.code === 10007 ? false : true) : true;
      if (!inServer) { const count = await closeRequestsOf(database, { guildId: server.guildId, discordUserId: row.discordUserId }, "left_discord", now); touched += count; total.closed += count; continue; }
      // Marked as asked first, so a failure after the send never asks twice. A closed-DM member gets the same grace, then closes.
      const marked = await database.inviteRequest.updateMany({ where: { guildId: server.guildId, discordUserId: row.discordUserId, status: "PENDING", confirmAskedAt: null }, data: { confirmAskedAt: now } });
      if (!marked.count) continue;
      asked += 1; total.asked += 1; touched += marked.count;
      try {
        const user = await client.users.fetch(row.discordUserId);
        await user.send({ content: t(lang, "invite.stillWant", { server: server.guild.name, name: row.displayName, days: String(EXPIRY.graceDays) }), components: [confirmRow(lang, row.id)], allowedMentions: { parse: [] } });
      } catch { /* DMs closed: skipped quietly */ }
    }
    if (touched) markGuildChanged(server.guildId);
  }
  return total;
}

/** The DM's Yes / No buttons. Only the member who asked may answer. */
export async function handleInviteConfirmButton(interaction: ButtonInteraction, database: Pick<PrismaClient, "inviteRequest" | "guildSettings">): Promise<void> {
  const keep = interaction.customId.startsWith(KEEP_PREFIX);
  const requestId = interaction.customId.slice((keep ? KEEP_PREFIX : DROP_PREFIX).length);
  const row = await database.inviteRequest.findUnique({ where: { id: requestId }, select: { id: true, guildId: true, discordUserId: true, status: true, invitesSent: true } });
  const settings = row ? await database.guildSettings.findUnique({ where: { guildId: row.guildId }, select: { language: true } }) : null;
  const lang = asLang(settings?.language);
  if (!row) { await interaction.update({ content: t(lang, "invite.alreadyClosed"), components: [] }).catch(() => undefined); return; }
  if (row.discordUserId !== interaction.user.id) { await interaction.reply({ content: t(lang, "invite.notYours"), flags: MessageFlags.Ephemeral }); return; }
  if (row.status !== "PENDING") { await interaction.update({ content: t(lang, "invite.alreadyClosed"), components: [] }).catch(() => undefined); return; }
  const now = new Date();
  if (keep) {
    // Yes: both counters restart (all of the member's open requests in this server).
    const mine = await database.inviteRequest.findMany({ where: { guildId: row.guildId, discordUserId: row.discordUserId, status: "PENDING" }, select: { id: true, invitesSent: true } });
    for (const request of mine) await database.inviteRequest.update({ where: { id: request.id }, data: { confirmAskedAt: null, expiryBaseAt: now, expiryBaseSent: request.invitesSent } });
  } else {
    await closeRequestsOf(database, { guildId: row.guildId, discordUserId: row.discordUserId }, "member_cancelled", now);
  }
  markGuildChanged(row.guildId);
  await interaction.update({ content: t(lang, keep ? "invite.kept" : "invite.dropped"), components: [] }).catch(() => undefined);
}

/** Officer view (/mod invites list closed:true): the latest closed requests and why they closed. */
export function formatClosedInvites(rows: readonly { displayName: string; discordUserId: string; closedAt: Date | null; closeReason: string | null; invitesSent: number; gameState: string | null }[]): string {
  if (!rows.length) return "No closed requests.";
  const lines = rows.slice(0, 15).map((row) => {
    const reason = CLOSE_TEXT[row.closeReason as CloseReason] ?? row.closeReason ?? "closed";
    const extra = [row.invitesSent ? `${row.invitesSent} invite${row.invitesSent === 1 ? "" : "s"} sent` : "", row.gameState ? GAME_STATE_TEXT[row.gameState] ?? "" : ""].filter(Boolean).join(", ");
    return `• **${row.displayName}** — <@${row.discordUserId}>${row.closedAt ? ` <t:${Math.floor(row.closedAt.getTime() / 1000)}:R>` : ""}: ${reason}${extra ? ` (${extra})` : ""}`;
  });
  return `${rows.length} closed request${rows.length === 1 ? "" : "s"} (latest first):\n${lines.join("\n")}${rows.length > 15 ? `\n…and ${rows.length - 15} more` : ""}`;
}
