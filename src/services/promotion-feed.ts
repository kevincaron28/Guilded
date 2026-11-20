import type { Guild as DiscordGuild } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { loadPromotionPlan } from "./promotion.js";

// 8.5 track C5 (feed): the in-game "Ready to promote" panel (addon/Guilded/Modules/Promotion.lua) lists the members the
// bot's promotion rule says are ready: in Discord, a linked character at the starting rank for the rule's days.
// This goes ONLY into an officer's own standings download (never the shared feed, never the officer bridge, which
// re-shares to every guildmate); the officer's companion writes it to the addon as GuildedPromotion.

export interface PromotionFeed {
  updatedAt: string; fromRank: string; minDays: number; /** Minimum level, 0 = none. */ minLevel: number; /** Optional: minutes of voice a week the rule asks for (0 = none), and whether a Discord link is required. */ minVoiceMinutes?: number; requireLink?: boolean;
  /** The only members the officer's addon may offer for promotion: the bot rule says they are ready. */
  ready: string[];
  /** Linked members at the starting rank that are not ready yet (the panel shows them as waiting). */
  waiting: { name: string; daysLeft: number; /** Optional (old addons ignore it): "link" and/or "voice:<have min>:<need min>", comma separated. */ reason?: string }[];
  /** Optional (old addons ignore it; 20 Nov 2026): characters that are alts of a linked main, to move to the Alt rank. `name` is the roster name, `main` the main's display name. */
  alts?: { name: string; main: string }[];
  /** Optional: a member switched mains. The addon gives `to` the rank `from` holds now and moves `from` to the Alt rank (roster names). */
  swaps?: { to: string; from: string }[];
}
export type PromotionFeedDb = Parameters<typeof loadPromotionPlan>[0] & Pick<PrismaClient, "guild">;

export async function promotionForAddon(db: PromotionFeedDb, discordGuild: Pick<DiscordGuild, "id" | "members" | "memberCount">, guildId: string, edition: string, now = new Date()): Promise<PromotionFeed | null> {
  const { plan, rule } = await loadPromotionPlan(db, discordGuild, guildId, edition, now);
  if (!rule.enabled) return null;
  const ready = [...new Set(plan.ready.map((r) => r.addon).filter((name): name is string => Boolean(name)))].slice(0, 100);
  const waiting: PromotionFeed["waiting"] = plan.waiting.flatMap((r) => r.addon ? [{ name: r.addon, daysLeft: r.daysLeft, ...(r.reason ? { reason: r.reason } : {}) }] : []);
  // Characters at the rank nobody has linked yet: the link is what they still need (only when the rule asks for a link).
  if (rule.requireLink) for (const u of plan.unclaimed) if (u.addon) waiting.push({ name: u.addon, daysLeft: 0, reason: "link" });
  waiting.splice(100);
  const alts = plan.alts.flatMap((a) => a.addon ? [{ name: a.addon, main: a.main }] : []).slice(0, 200);
  const swaps = plan.swaps.flatMap((w) => w.newAddon && w.oldAddon ? [{ to: w.newAddon, from: w.oldAddon }] : []).slice(0, 50);
  return { updatedAt: now.toISOString(), fromRank: rule.fromRank, minDays: rule.minDays, minLevel: rule.minLevel ?? 0, minVoiceMinutes: rule.minVoiceMinutes, requireLink: rule.requireLink, ready, waiting, ...(alts.length ? { alts } : {}), ...(swaps.length ? { swaps } : {}) };
}
