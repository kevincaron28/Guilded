import type {
  ChallengeInput, ClassKey, Collection, CollectionCard, DuelInfo, DuelResponse, DuelStatus, Intent, Ladder, LadderBoard, LadderEntry, LadderScope, MatchInfo,
  MatchResponse, OpenedPack, Partner, PlayerView, PulledCard, PveProgress, RankInfo, RankName, RankedChange, RankedStatus, Rarity, StartInput
} from "./types";
import { CLASS_KEYS, RARITIES } from "./types";

// Typed client for the Guilded Clash routes: /api/v1/companion/cards (#626), /api/v1/companion/clash/* (#638) and the
// player-vs-player routes under /api/v1/companion/clash/ (#644: challenge, accept, decline, duels, ranked, leaderboard).
// Every answer is checked before the screens use it; a malformed answer is an error, never a crash.

export class ClashError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** What the screens need. The real client and the sample (mock.ts) both implement it. */
export interface ClashApi {
  readonly sample: boolean;
  collection(): Promise<Collection>;
  openPack(): Promise<OpenedPack>;
  craft(key: string): Promise<Collection>;
  start(input: StartInput): Promise<MatchResponse>;
  match(id: string): Promise<MatchResponse>;
  intent(id: string, intent: Intent): Promise<MatchResponse>;
  concede(id: string): Promise<MatchResponse>;
  matches(): Promise<MatchInfo[]>;
  pve(): Promise<PveProgress>;
  // player-vs-player (#644)
  partners(): Promise<Partner[]>;
  challenge(input: ChallengeInput): Promise<DuelResponse>;
  accept(id: string, cls: ClassKey): Promise<DuelResponse>;
  decline(id: string): Promise<DuelResponse>;
  duels(): Promise<DuelInfo[]>;
  /** One duel; with `since`, the server holds the answer up to 10 s until the version moves (a long poll). */
  duel(id: string, since?: number): Promise<DuelResponse>;
  duelIntent(id: string, intent: Intent): Promise<DuelResponse>;
  duelConcede(id: string): Promise<DuelResponse>;
  ranked(): Promise<RankedStatus>;
  joinRanked(cls: ClassKey): Promise<RankedStatus>;
  leaveRanked(): Promise<{ left: boolean }>;
  leaderboard(scope: LadderScope, season?: string): Promise<Ladder>;
}

const obj = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const str = (v: unknown): string | null => typeof v === "string" ? v : null;
const num = (v: unknown, fallback = 0): number => typeof v === "number" && Number.isFinite(v) ? v : fallback;
const arr = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const rarity = (v: unknown): Rarity => RARITIES.includes(v as Rarity) ? v as Rarity : "common";
const cls = (v: unknown): ClassKey => CLASS_KEYS.includes(v as ClassKey) ? v as ClassKey : "warrior";
const fail = (what: string): never => { throw new Error(`The ${what} answer was not understood.`); };

export function parseCollection(body: unknown): Collection {
  const data = obj(body);
  if (!data || !Array.isArray(data.cards)) return fail("collection");
  const cards = data.cards.flatMap((raw): CollectionCard[] => {
    const c = obj(raw);
    const key = str(c?.key), name = str(c?.name);
    if (!c || !key || !name) return [];
    return [{
      key, name, family: c.family === "badge" ? "badge" : "class", rarity: rarity(c.rarity), rarityLabel: str(c.rarityLabel) ?? String(c.rarity ?? ""),
      set: c.set === "badges" ? "badges" : "classes", flavour: str(c.flavour), owned: c.owned === true, count: num(c.count),
      firstSeenAt: str(c.firstSeenAt), craftCost: typeof c.craftCost === "number" ? c.craftCost : null, artUrl: str(c.artUrl)
    }];
  });
  const packs = obj(data.packs), pity = obj(data.pity), odds = obj(data.odds);
  return {
    cards, owned: num(data.owned), total: num(data.total, cards.length), dust: num(data.dust),
    packs: { ready: num(packs?.ready), max: num(packs?.max, 3), nextAt: str(packs?.nextAt) },
    pity: { epicIn: num(pity?.epicIn), legendaryIn: num(pity?.legendaryIn) },
    odds: odds ? {
      ordinarySlots: (obj(odds.ordinarySlots) ?? {}) as Record<string, number>, rarePlusSlot: (obj(odds.rarePlusSlot) ?? {}) as Record<string, number>,
      packSize: num(odds.packSize, 5), epicPity: num(odds.epicPity), legendaryPity: num(odds.legendaryPity)
    } : null
  };
}

export function parseOpenedPack(body: unknown): OpenedPack {
  const data = obj(body);
  if (!data || !Array.isArray(data.cards)) return fail("pack");
  const cards = data.cards.flatMap((raw): PulledCard[] => {
    const c = obj(raw);
    const key = str(c?.key);
    if (!c || !key) return [];
    return [{ key, rarity: rarity(c.rarity), isNew: c.isNew === true, dust: num(c.dust), name: str(c.name) ?? key, rarityLabel: str(c.rarityLabel) ?? String(c.rarity ?? "") }];
  });
  return { cards, dustGained: num(data.dustGained), collection: parseCollection(data.collection) };
}

function parseInfo(raw: unknown): MatchInfo | null {
  const m = obj(raw);
  const id = str(m?.id);
  if (!m || !id) return null;
  const boss = obj(m.boss), rewards = obj(m.rewards);
  return {
    id, kind: m.kind === "pve" ? "pve" : "ai", aiLevel: m.aiLevel === "easy" || m.aiLevel === "hard" ? m.aiLevel : "normal",
    boss: boss && str(boss.id) ? { id: str(boss.id)!, name: str(boss.name) ?? str(boss.id)! } : null,
    status: m.status === "won" || m.status === "lost" || m.status === "draw" ? m.status : "active", reason: str(m.reason),
    round: num(m.round), version: num(m.version), turnSeconds: num(m.turnSeconds), turnDeadlineAt: str(m.turnDeadlineAt),
    createdAt: str(m.createdAt) ?? "", finishedAt: str(m.finishedAt), rewards: rewards ? { dust: num(rewards.dust), packs: num(rewards.packs) } : null
  };
}

/** The view is the server's own projection; the checks here only guard what the screen dereferences. */
export function parseMatchResponse(body: unknown): MatchResponse {
  const data = obj(body);
  const match = parseInfo(data?.match);
  const view = obj(data?.view);
  const me = obj(view?.me), opponent = obj(view?.opponent);
  if (!data || !match || !view || !me || !opponent || !Array.isArray(me.hand) || !Array.isArray(me.board) || !Array.isArray(opponent.board)) return fail("match");
  const v = view as unknown as PlayerView;
  const fixed: PlayerView = {
    ...v, legal: arr(view.legal) as Intent[], zone: obj(view.zone) ? v.zone : null, pending: obj(view.pending) ? v.pending : null,
    me: { ...v.me, cls: cls(me.cls) }, opponent: { ...v.opponent, cls: cls(opponent.cls), handCount: num(opponent.handCount) }
  };
  return { match, view: fixed, events: arr(data.events).filter((e) => obj(e) && typeof (e as { t?: unknown }).t === "string") as MatchResponse["events"], rewards: obj(data.rewards) as MatchResponse["rewards"] };
}

export function parseMatchList(body: unknown): MatchInfo[] {
  const data = obj(body);
  if (!data || !Array.isArray(data.matches)) return fail("match list");
  return data.matches.flatMap((raw) => { const info = parseInfo(raw); return info ? [info] : []; });
}

export function parsePve(body: unknown): PveProgress {
  const data = obj(body);
  if (!data || !Array.isArray(data.bosses)) return fail("gauntlet");
  const daily = obj(data.daily), featured = obj(data.featured);
  return {
    bosses: data.bosses.flatMap((raw) => {
      const b = obj(raw);
      const id = str(b?.id);
      if (!b || !id) return [];
      const reward = obj(b.reward);
      return [{ id, name: str(b.name) ?? id, flavour: str(b.flavour) ?? "", cls: cls(b.cls), level: b.level === "easy" || b.level === "hard" ? b.level : "normal",
        health: num(b.health, 20), reward: { dust: num(reward?.dust), packs: num(reward?.packs) }, cleared: b.cleared === true, unlocked: b.unlocked === true,
        paidToday: b.paidToday === true, spotlight: b.spotlight === true }];
    }),
    cleared: num(data.cleared), runs: num(data.runs),
    featured: { week: num(featured?.week), boss: str(featured?.boss) ?? "", note: str(featured?.note) ?? "" },
    daily: {
      day: str(daily?.day) ?? "", packsFromPlay: num(daily?.packsFromPlay), packCap: num(daily?.packCap, 3), packProgress: num(daily?.packProgress), stepsPerPack: num(daily?.stepsPerPack, 3),
      quests: arr(daily?.quests).flatMap((raw) => {
        const q = obj(raw);
        const id = str(q?.id);
        return q && id ? [{ id, text: str(q.text) ?? id, target: num(q.target, 1), progress: num(q.progress), done: q.done === true }] : [];
      })
    },
    wins: num(data.wins), losses: num(data.losses)
  };
}

// ---- player-vs-player (#644) ----

const DUEL_STATUSES: readonly DuelStatus[] = ["pending", "active", "won", "lost", "draw", "declined", "cancelled", "expired"];
const RANK_NAMES: readonly RankName[] = ["Initiate", "Adept", "Veteran", "Elite", "Legend"];

function parseRank(raw: unknown): RankInfo {
  const r = obj(raw);
  const rank = RANK_NAMES.includes(r?.rank as RankName) ? r!.rank as RankName : "Initiate";
  return { rank, division: num(r?.division, 4), label: str(r?.label) ?? rank, starsInDivision: num(r?.starsInDivision), starsToNext: num(r?.starsToNext),
    legend: r?.legend === true, rankFloor: num(r?.rankFloor) };
}
function parseRanked(raw: unknown): RankedChange | null {
  const r = obj(raw);
  if (!r) return null;
  return { rated: r.rated === true, season: str(r.season) ?? "", stars: num(r.stars), starsDelta: num(r.starsDelta), streak: num(r.streak), rank: parseRank(r.rank) };
}

export function parseDuelInfo(raw: unknown): DuelInfo | null {
  const d = obj(raw);
  const id = str(d?.id);
  if (!d || !id) return null;
  const you = obj(d.you), opponent = obj(d.opponent);
  return {
    id, kind: d.kind === "ranked" ? "ranked" : "friendly", status: DUEL_STATUSES.includes(d.status as DuelStatus) ? d.status as DuelStatus : "active", reason: str(d.reason),
    live: d.live === true, direction: d.direction === "incoming" || d.direction === "outgoing" ? d.direction : "match", seat: d.seat === 1 ? 1 : 0, yourTurn: d.yourTurn === true,
    you: { id: str(you?.id) ?? "", cls: str(you?.cls) ?? "" },
    opponent: { id: str(opponent?.id) ?? "", name: str(opponent?.name) ?? "A guildmate", cls: str(opponent?.cls) },
    season: str(d.season), round: num(d.round), version: num(d.version), turnSeconds: num(d.turnSeconds, 86_400), turnDeadlineAt: str(d.turnDeadlineAt),
    expiresAt: str(d.expiresAt), createdAt: str(d.createdAt) ?? "", finishedAt: str(d.finishedAt), rated: d.rated === true,
    clocks: clocksOf(obj(d.clocks))
  };
}

/** A duel answer. The view goes through the same checks as a match against the AI. */
export function parseDuelResponse(body: unknown): DuelResponse {
  const data = obj(body);
  const duel = parseDuelInfo(data?.duel);
  if (!data || !duel) return fail("duel");
  const view = data.view === null || data.view === undefined ? null
    : parseMatchResponse({ match: { id: duel.id }, view: data.view, events: [] }).view;
  return { duel, view, events: arr(data.events).filter((e) => obj(e) && typeof (e as { t?: unknown }).t === "string") as DuelResponse["events"],
    rewards: obj(data.rewards) as DuelResponse["rewards"], ranked: parseRanked(data.ranked) };
}

export function parseDuelList(body: unknown): DuelInfo[] {
  const data = obj(body);
  if (!data || !Array.isArray(data.duels)) return fail("duel list");
  return data.duels.flatMap((raw) => { const info = parseDuelInfo(raw); return info ? [info] : []; });
}

export function parsePartners(body: unknown): Partner[] {
  const data = obj(body);
  if (!data || !Array.isArray(data.partners)) return fail("guildmate list");
  return data.partners.flatMap((raw) => { const p = obj(raw); const id = str(p?.discordUserId); return p && id ? [{ discordUserId: id, name: str(p.name) ?? "A guildmate" }] : []; });
}

export function parseRankedStatus(body: unknown): RankedStatus {
  const data = obj(body);
  const standing = obj(data?.standing);
  if (!data || !standing) return fail("ranked");
  const queue = obj(data.queue);
  return {
    season: str(data.season) ?? "", seasonEndsAt: str(data.seasonEndsAt) ?? "",
    queue: queue ? { cls: str(queue.cls) ?? "", since: str(queue.since) ?? "", expiresAt: str(queue.expiresAt) ?? "" } : null,
    matched: obj(data.matched) ? parseDuelResponse(data.matched) : null,
    standing: { stars: num(standing.stars), rank: parseRank(standing.rank), streak: num(standing.streak), wins: num(standing.wins), losses: num(standing.losses), games: num(standing.games) },
    active: arr(data.active).flatMap((raw) => { const info = parseDuelInfo(raw); return info ? [info] : []; })
  };
}

function parseEntry(raw: unknown): LadderEntry | null {
  const e = obj(raw);
  const name = str(e?.name);
  if (!e || !name) return null;
  const label = str(e.label);
  return { position: num(e.position), name, you: e.you === true, wins: num(e.wins), losses: num(e.losses),
    ...(typeof e.games === "number" ? { games: e.games } : {}), ...(typeof e.stars === "number" ? { stars: e.stars } : {}),
    ...(label ? { label } : {}), ...(e.legend === true ? { legend: true } : {}) };
}

export function parseLadder(body: unknown): Ladder {
  const data = obj(body);
  if (!data || !Array.isArray(data.boards)) return fail("leaderboard");
  const scope: LadderScope = data.scope === "guild" || data.scope === "friendly" ? data.scope : "global";
  return {
    scope, season: str(data.season) ?? "", weekStart: str(data.weekStart),
    boards: data.boards.flatMap((raw): LadderBoard[] => {
      const b = obj(raw);
      const id = str(b?.id);
      if (!b || !id) return [];
      return [{ id, title: str(b.title) ?? id, entries: arr(b.entries).flatMap((e) => { const entry = parseEntry(e); return entry ? [entry] : []; }), you: parseEntry(b.you) }];
    })
  };
}

/** A duel drawn on the match screen: the same projection, with the opponent's name and the ranked result. */
function clocksOf(c: Record<string, unknown> | null): DuelInfo["clocks"] {
  return c && typeof c.you === "number" && typeof c.opponent === "number" ? { you: c.you, opponent: c.opponent } : null;
}

export function duelAsMatch(res: DuelResponse): MatchResponse | null {
  if (!res.view) return null;
  const d = res.duel;
  const status = d.status === "won" || d.status === "lost" || d.status === "draw" ? d.status : "active";
  return {
    match: { id: d.id, kind: "ai", aiLevel: "normal", boss: null, status, reason: d.reason, round: d.round, version: d.version, turnSeconds: d.turnSeconds,
      turnDeadlineAt: d.turnDeadlineAt, createdAt: d.createdAt, finishedAt: d.finishedAt, rewards: res.rewards ? { dust: res.rewards.dust, packs: res.rewards.packs } : null,
      duel: { kind: d.kind, opponent: d.opponent.name, live: d.live, ranked: res.ranked, clocks: d.clocks } },
    view: res.view, events: res.events, rewards: res.rewards
  };
}

/** What the match screen calls. A match against the AI uses the ClashApi itself; a duel goes through its own routes. */
export interface MatchDriver {
  match(id: string): Promise<MatchResponse>;
  intent(id: string, intent: Intent): Promise<MatchResponse>;
  concede(id: string): Promise<MatchResponse>;
}
const asMatch = (res: DuelResponse): MatchResponse => duelAsMatch(res) ?? fail("duel");
export function duelDriver(api: ClashApi): MatchDriver {
  return {
    match: async (id) => asMatch(await api.duel(id)),
    intent: async (id, intent) => asMatch(await api.duelIntent(id, intent)),
    concede: async (id) => asMatch(await api.duelConcede(id))
  };
}

/** The live client: the member's companion credential, never sent anywhere but their Guilded server. */
export class ClashClient implements ClashApi {
  readonly sample = false;
  constructor(private readonly origin: string, private readonly credential: string, private readonly lang: "en" | "fr" = "en") {}

  private async call(path: string, body?: unknown): Promise<unknown> {
    const url = new URL(path, this.origin);
    url.searchParams.set("lang", this.lang);
    const headers: Record<string, string> = { accept: "application/json", "x-companion-credential": this.credential };
    if (body !== undefined) headers["content-type"] = "application/json";
    let response: Response;
    try {
      response = await fetch(url, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw new ClashError("Guilded could not be reached. Check the connection.", 0);
    }
    const text = await response.text();
    let parsed: unknown;
    try { parsed = text ? JSON.parse(text) as unknown : null; } catch { parsed = null; }
    if (!response.ok) {
      const message = str(obj(parsed)?.error) ?? (response.status === 404 ? "This Guilded server does not have the card game yet." : "That did not work. Try again.");
      throw new ClashError(message, response.status);
    }
    return parsed;
  }

  async collection() { return parseCollection(await this.call("/api/v1/companion/cards")); }
  async openPack() { return parseOpenedPack(await this.call("/api/v1/companion/cards/open", {})); }
  async craft(key: string) { return parseCollection(await this.call("/api/v1/companion/cards/craft", { card: key })); }
  async start(input: StartInput) { return parseMatchResponse(await this.call("/api/v1/companion/clash/start", input)); }
  async match(id: string) { return parseMatchResponse(await this.call(`/api/v1/companion/clash/match?id=${encodeURIComponent(id)}`)); }
  async intent(id: string, intent: Intent) { return parseMatchResponse(await this.call("/api/v1/companion/clash/intent", { id, action: intent })); }
  async concede(id: string) { return parseMatchResponse(await this.call("/api/v1/companion/clash/concede", { id })); }
  async matches() { return parseMatchList(await this.call("/api/v1/companion/clash/matches")); }
  async pve() { return parsePve(await this.call("/api/v1/companion/clash/pve")); }

  private clash(route: string, query?: Record<string, string>) {
    const q = query ? `?${new URLSearchParams(query).toString()}` : "";
    return `/api/v1/companion/clash/${route}${q}`;
  }
  async partners() { return parsePartners(await this.call(this.clash("challenge/partners"))); }
  async challenge(input: ChallengeInput) { return parseDuelResponse(await this.call(this.clash("challenge"), input)); }
  async accept(id: string, cls: ClassKey) { return parseDuelResponse(await this.call(this.clash("accept"), { id, cls })); }
  async decline(id: string) { return parseDuelResponse(await this.call(this.clash("decline"), { id })); }
  async duels() { return parseDuelList(await this.call(this.clash("duels"))); }
  async duel(id: string, since?: number) { return parseDuelResponse(await this.call(this.clash("duel", since === undefined ? { id } : { id, since: String(since) }))); }
  async duelIntent(id: string, intent: Intent) { return parseDuelResponse(await this.call(this.clash("duel/intent"), { id, action: intent })); }
  async duelConcede(id: string) { return parseDuelResponse(await this.call(this.clash("duel/concede"), { id })); }
  async ranked() { return parseRankedStatus(await this.call(this.clash("ranked"))); }
  async joinRanked(cls: ClassKey) { return parseRankedStatus(await this.call(this.clash("ranked/join"), { cls })); }
  async leaveRanked() { const body = obj(await this.call(this.clash("ranked/leave"), {})); return { left: body?.left === true }; }
  async leaderboard(scope: LadderScope, season?: string) { return parseLadder(await this.call(this.clash("leaderboard", season ? { scope, season } : { scope }))); }
}
