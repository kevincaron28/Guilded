import { parseIntent } from "./tcg-match.js";
import { acceptChallenge, challenge, concedeDuel, declineChallenge, duelPartners, getDuel, leaderboard, joinRanked, leaveRanked, listDuels, pollDuel, rankedStatus, submitDuelIntent, type Allows, type DuelDb } from "./tcg-duel.js";

// The player-vs-player routes under /api/v1/companion/clash/ (Guilded Clash stage E). The caller (companion-api.ts) has already
// signed the member in, checked the officer switch and rate-limited the writes; this only validates the request and calls the service.
// Ids travel in the query or the body, so the Worker needs exact paths only.

/** Route (after /api/v1/companion/clash/) and its method. */
export const DUEL_ROUTES: Readonly<Record<string, "GET" | "POST">> = {
  challenge: "POST", accept: "POST", decline: "POST", "challenge/partners": "GET",
  duels: "GET", duel: "GET", "duel/intent": "POST", "duel/concede": "POST",
  ranked: "GET", "ranked/join": "POST", "ranked/leave": "POST", leaderboard: "GET"
};

export interface DuelReply { status: number; body: unknown }
const bad = (error: string): DuelReply => ({ status: 400, body: { error } });
const ok = (body: unknown): DuelReply => ({ status: 200, body });
const validId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 40;

export async function handleDuelRoute(db: DuelDb, route: string, userId: string, query: URLSearchParams, readJson: () => Promise<unknown>, allows: Allows): Promise<DuelReply> {
  if (DUEL_ROUTES[route] === "GET") {
    if (route === "challenge/partners") return ok(await duelPartners(db, userId, allows));
    if (route === "duels") return ok(await listDuels(db, userId));
    if (route === "ranked") return ok(await rankedStatus(db, userId));
    if (route === "leaderboard") {
      const scope = query.get("scope") ?? "global";
      if (scope !== "global" && scope !== "guild" && scope !== "friendly") return bad("scope must be global, guild or friendly.");
      const season = query.get("season") ?? undefined;
      return ok(await leaderboard(db, userId, { scope, ...(season ? { season } : {}) }, allows));
    }
    // duel: one match, optionally a long poll from the last version seen.
    const id = query.get("id") ?? "";
    if (!validId(id)) return bad("id is required.");
    const since = query.get("since");
    if (since !== null) {
      const version = Number(since);
      if (!Number.isInteger(version) || version < 0) return bad("since must be a version number.");
      return ok(await pollDuel(db, userId, id, version, { waitMs: 10_000 }));
    }
    return ok(await getDuel(db, userId, id));
  }
  const body = await readJson().catch(() => null) as { to?: unknown; cls?: unknown; live?: unknown; id?: unknown; action?: unknown } | null;
  if (!body || typeof body !== "object") return bad("A JSON body is required.");
  if (route === "challenge") {
    if (!validId(body.to)) return bad("to (a guildmate) is required.");
    if (body.live !== undefined && typeof body.live !== "boolean") return bad("live must be true or false.");
    return ok(await challenge(db, userId, { to: body.to, cls: body.cls, live: body.live === true }, allows));
  }
  if (route === "ranked/join") return ok(await joinRanked(db, userId, body.cls));
  if (route === "ranked/leave") return ok(await leaveRanked(db, userId));
  if (!validId(body.id)) return bad("id is required.");
  if (route === "accept") return ok(await acceptChallenge(db, userId, body.id, body.cls, allows));
  if (route === "decline") return ok(await declineChallenge(db, userId, body.id));
  if (route === "duel/concede") return ok(await concedeDuel(db, userId, body.id));
  const action = parseIntent(body.action);
  if (!action) return bad("action is not a valid move.");
  return ok(await submitDuelIntent(db, userId, body.id, action));
}
