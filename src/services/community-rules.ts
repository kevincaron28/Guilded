import { randomInt } from "node:crypto";
import { z } from "zod";

export const COMMUNITY_GAMES = ["DISCORD", "WOW", "POE2", "DIABLO4", "OTHER"] as const;
export const lotteryRules = z.object({
  mode: z.enum(["FREE", "POINTS", "WOW_GOLD", "POE_CURRENCY"]),
  prize: z.string().trim().min(1).max(250),
  cost: z.number().int().min(0).max(1_000_000),
  currency: z.string().trim().max(80),
  realm: z.string().trim().max(100),
  winners: z.number().int().min(1).max(20),
  maxTickets: z.number().int().min(1).max(1000)
}).superRefine((rules, ctx) => {
  const invalid = (message: string) => ctx.addIssue({ code: "custom", message });
  if (rules.mode === "FREE" && (rules.cost !== 0 || rules.maxTickets !== 1)) invalid("Gratuit : un billet par membre / Free: one ticket per member.");
  if (rules.mode !== "FREE" && rules.cost < 1) invalid("Prix requis / Ticket price required.");
  if (["WOW_GOLD", "POE_CURRENCY"].includes(rules.mode) && (!rules.currency || !rules.realm)) invalid("Précise monnaie et royaume/ligue / Currency and realm/league required.");
});
export const eventRules = z.object({ capacity: z.number().int().min(1).max(200), points: z.number().int().min(0).max(1000) });
export const challengeRules = z.object({ instructions: z.string().trim().min(1).max(1500), points: z.number().int().min(1).max(1000) });
export const quizRules = z.object({ choices: z.array(z.string().trim().min(1).max(80)).length(4), correct: z.number().int().min(0).max(3), points: z.number().int().min(1).max(1000) });
export type LotteryRules = z.infer<typeof lotteryRules>;
export type Standing = { userId: string; points: number; balance: number };

export function standings(entries: { userId: string; kind: string; amount: number }[]): Standing[] {
  const rows = new Map<string, Standing>();
  for (const entry of entries) {
    const row = rows.get(entry.userId) ?? { userId: entry.userId, points: 0, balance: 0 };
    row.balance += entry.amount;
    if (["AWARD", "REVERSAL"].includes(entry.kind)) row.points += entry.amount;
    rows.set(entry.userId, row);
  }
  return [...rows.values()].sort((a, b) => b.points - a.points || a.userId.localeCompare(b.userId));
}

// Each confirmed ticket has equal odds. A person can win at most one prize.
// Bounds stay below randomInt's range; never use Math.random for a paid draw.
export function drawWinners(entries: { userId: string; quantity: number; status: string }[], count: number, rng = randomInt): string[] {
  if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error("Nombre de gagnants invalide / Invalid winner count.");
  const pool = entries.filter(entry => entry.status === "CONFIRMED").map(entry => ({ ...entry }));
  if (new Set(pool.map(entry => entry.userId)).size !== pool.length) throw new Error("Duplicate participants");
  if (pool.some(entry => !Number.isInteger(entry.quantity) || entry.quantity < 1 || entry.quantity > 1000) || pool.length > 10_000) throw new Error("Invalid ticket pool");
  const winners: string[] = [];
  while (pool.length && winners.length < count) {
    const total = pool.reduce((sum, entry) => sum + entry.quantity, 0);
    let selected = rng(total);
    let index = 0;
    while (selected >= pool[index]!.quantity) selected -= pool[index++]!.quantity;
    winners.push(pool.splice(index, 1)[0]!.userId);
  }
  return winners;
}

export function evidenceReference(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || value.length > 800) throw new Error("Preuve : lien HTTPS requis / Evidence: HTTPS link required.");
  return value;
}

export function assertLotteryGame(game: string, mode: string): void {
  if ((mode === "WOW_GOLD" && game !== "WOW") || (mode === "POE_CURRENCY" && game !== "POE2")) throw new Error("Monnaie incompatible avec ce jeu / Currency does not match this game.");
}
