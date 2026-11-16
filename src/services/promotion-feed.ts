import type { Guild as DiscordGuild } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { loadPromotionPlan } from "./promotion.js";

// 8.5 track C5 (feed): the in-game "Ready to promote" panel (addon/Guilded/Modules/Promotion.lua) lists the members the
// bot's promotion rule says are ready: in Discord, a linked character at the starting rank for the rule's days.
// This goes ONLY into an officer's own standings download (never the shared feed, never the officer bridge, which
// re-shares to every guildmate); the officer's companion writes it to the addon as GuildedPromotion.

export interface PromotionFeed {
  updatedAt: string; fromRank: string; minDays: number; /** Minimum level, 0 = none. */ minLevel: number;
  /** The only members the officer's addon may offer for promotion: the bot rule says they are ready. */
  ready: string[];
  /** Linked members at the starting rank that are not ready yet (the panel shows them as waiting). */
  waiting: { name: string; daysLeft: number }[];
}
export type PromotionFeedDb = Parameters<typeof loadPromotionPlan>[0] & Pick<PrismaClient, "guild">;

export async function promotionForAddon(db: PromotionFeedDb, discordGuild: Pick<DiscordGuild, "id" | "members" | "memberCount">, guildId: string, edition: string, now = new Date()): Promise<PromotionFeed | null> {
  const { plan, rule } = await loadPromotionPlan(db, discordGuild, guildId, edition, now);
  if (!rule.enabled) return null;
  const ready = [...new Set(plan.ready.map((r) => r.addon).filter((name): name is string => Boolean(name)))].slice(0, 100);
  const waiting = plan.waiting.flatMap((r) => r.addon ? [{ name: r.addon, daysLeft: r.daysLeft }] : []).slice(0, 100);
  return { updatedAt: now.toISOString(), fromRank: rule.fromRank, minDays: rule.minDays, minLevel: rule.minLevel ?? 0, ready, waiting };
}
