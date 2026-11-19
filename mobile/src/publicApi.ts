import { ApiError, getJsonBounded } from "./api";

// Public, read-only data: the same ratings and guild pages the website shows. No credential is sent.

export interface BoardCharacter { rank: number; name: string; realm: string | null; className: string | null; role: string | null; points: number }
export interface BoardGuild { rank: number; id: string; name: string; slug: string | null; points: number; rated: number }
export interface BoardBracket { key: string; name: string; characters: BoardCharacter[]; guilds: BoardGuild[] }
export interface SeasonChoice { id: string; label: string }
export interface Boards { season: string; seasonId: string; seasons: SeasonChoice[]; brackets: BoardBracket[] }

export interface DuelPlayer { rank: number | null; name: string; realm: string | null; className: string | null; level: number | null; guild: string | null; rating: number; ranked: boolean; wins: number; losses: number; winRate: number; streak: number }
export interface Duels { season: string; seasons: SeasonChoice[]; duels: number; players: DuelPlayer[] }

export interface PublicRosterRow { name: string; className: string; role: "TANK" | "HEALER" | "DPS"; bench: boolean; trial: boolean }
export interface PublicRankingRow { name: string; ep: number; gp: number; pr: number; belowMin: boolean }
export interface PublicCore {
  name: string; description: string | null; schedule: string | null; lootMode: string;
  roster: PublicRosterRow[]; ranking: PublicRankingRow[];
}
export interface PublicGuild { slug: string; name: string; intro: string | null; edition: string | null; cores: PublicCore[]; dungeonPage: string | null }

const obj = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const arr = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const str = (v: unknown): string | null => typeof v === "string" && v ? v : null;
const num = (v: unknown): number => typeof v === "number" && Number.isFinite(v) ? v : 0;

export function parseSeasons(value: unknown): SeasonChoice[] {
  return arr(value).flatMap((raw) => { const s = obj(raw); return s && str(s.id) ? [{ id: str(s.id)!, label: str(s.label) ?? str(s.id)! }] : []; });
}

export function parseBoards(body: unknown): Boards {
  const data = obj(body);
  if (!data) throw new Error("The boards answer was not understood.");
  return {
    season: str(data.season) ?? "", seasonId: str(data.seasonId) ?? "", seasons: parseSeasons(data.seasons),
    brackets: arr(data.brackets).flatMap((raw) => {
      const b = obj(raw);
      if (!b || !str(b.key)) return [];
      return [{
        key: str(b.key)!, name: str(b.name) ?? str(b.key)!,
        characters: arr(b.characters).flatMap((r) => { const c = obj(r); return c && str(c.name) ? [{ rank: num(c.rank), name: str(c.name)!, realm: str(c.realm), className: str(c.className), role: str(c.role), points: num(c.points) }] : []; }),
        guilds: arr(b.guilds).flatMap((r) => { const g = obj(r); return g && str(g.id) && str(g.name) ? [{ rank: num(g.rank), id: str(g.id)!, name: str(g.name)!, slug: str(g.slug), points: num(g.points), rated: num(g.rated) }] : []; })
      }];
    })
  };
}

/** The duel ladder (GET /leaderboards/duels.json). The server answers 404 until the ladder opens (1 December 2026). */
export function parseDuels(body: unknown): Duels {
  const data = obj(body);
  if (!data) throw new Error("The duels answer was not understood.");
  return {
    season: str(data.season) ?? "", seasons: parseSeasons(data.seasons), duels: num(data.duels),
    players: arr(data.players).flatMap((raw) => {
      const p = obj(raw);
      if (!p || !str(p.name)) return [];
      return [{ rank: typeof p.rank === "number" ? p.rank : null, name: str(p.name)!, realm: str(p.realm), className: str(p.className), level: typeof p.level === "number" ? p.level : null, guild: str(p.guild),
        rating: num(p.rating), ranked: p.ranked === true, wins: num(p.wins), losses: num(p.losses), winRate: num(p.winRate), streak: num(p.streak) }];
    })
  };
}

export interface RaidGuildRow { rank: number; name: string; slug: string | null; bosses: number; worldFirsts: number; lastKillAt: string | null }
export interface RaidFirst { instance: string; boss: string; difficulty: string | null; guild: string; killedAt: string | null }
export interface RaidBoard { opensAt: string | null; open: boolean; totalKills: number; guilds: RaidGuildRow[]; firsts: RaidFirst[] }

/** Raid progress (GET /leaderboards/raids.json): guilds by bosses killed, and the world first on each boss. Boss names are English. */
export function parseRaids(body: unknown): RaidBoard {
  const data = obj(body);
  if (!data) throw new Error("The raid progress answer was not understood.");
  return {
    opensAt: str(data.opensAt), open: data.open === true, totalKills: num(data.totalKills),
    guilds: arr(data.guilds).flatMap((raw) => { const g = obj(raw); return g && str(g.name) ? [{ rank: num(g.rank), name: str(g.name)!, slug: str(g.slug), bosses: num(g.bosses), worldFirsts: num(g.worldFirsts), lastKillAt: str(g.lastKillAt) }] : []; }),
    firsts: arr(data.firsts).flatMap((raw) => { const f = obj(raw); return f && str(f.boss) && str(f.guild) ? [{ instance: str(f.instance) ?? "", boss: str(f.boss)!, difficulty: str(f.difficulty), guild: str(f.guild)!, killedAt: str(f.killedAt) }] : []; })
  };
}
export const fetchRaids = async (origin: string): Promise<RaidBoard> => parseRaids(await getJson(`${origin}/leaderboards/raids.json`));

const ROLES = new Set(["TANK", "HEALER", "DPS"]);
export function parsePublicGuild(body: unknown): PublicGuild {
  const data = obj(body);
  if (!data || !str(data.slug) || !str(data.name)) throw new Error("The guild answer was not understood.");
  return {
    slug: str(data.slug)!, name: str(data.name)!, intro: str(data.intro), edition: str(data.edition), dungeonPage: str(data.dungeonPage),
    cores: arr(data.cores).flatMap((raw) => {
      const c = obj(raw);
      if (!c || !str(c.name)) return [];
      return [{
        name: str(c.name)!, description: str(c.description), schedule: str(c.schedule), lootMode: str(c.lootMode) ?? "",
        roster: arr(c.roster).flatMap((r) => { const m = obj(r); return m && str(m.name) ? [{ name: str(m.name)!, className: str(m.className) ?? "", role: (ROLES.has(String(m.role)) ? m.role : "DPS") as PublicRosterRow["role"], bench: m.bench === true, trial: m.trial === true }] : []; }),
        ranking: arr(c.ranking).flatMap((r) => { const m = obj(r); return m && str(m.name) ? [{ name: str(m.name)!, ep: num(m.ep), gp: num(m.gp), pr: num(m.pr), belowMin: m.belowMin === true }] : []; })
      }];
    })
  };
}

const getJson = getJsonBounded;

export const fetchBoards = async (origin: string, lang: "en" | "fr", season?: string): Promise<Boards> =>
  parseBoards(await getJson(`${origin}/leaderboards/boards.json?lang=${lang}${season ? `&season=${encodeURIComponent(season)}` : ""}`));
/** Null while the duel ladder is not open yet (the server answers 404). */
export const fetchDuels = async (origin: string, lang: "en" | "fr", season?: string): Promise<Duels | null> => {
  try { return parseDuels(await getJson(`${origin}/leaderboards/duels.json?lang=${lang}${season ? `&when=${encodeURIComponent(season)}` : ""}`)); }
  catch (error) { if (error instanceof ApiError && error.status === 404) return null; throw error; }
};
export const fetchPublicGuild = async (origin: string, slug: string): Promise<PublicGuild> => parsePublicGuild(await getJson(`${origin}/g/${encodeURIComponent(slug)}/guild.json`));

/** WoW class colours, so names read like the game. */
export function classColor(className: string | null): string {
  const key = (className ?? "").toLowerCase().replace(/[^a-z]/g, "");
  return ({ warrior: "#c79c6e", paladin: "#f58cba", hunter: "#abd473", rogue: "#fff569", priest: "#ffffff", shaman: "#0070de", mage: "#69ccf0", warlock: "#9482c9", druid: "#ff7d0a",
    deathknight: "#c41f3b", monk: "#00ff96", demonhunter: "#a330c9", evoker: "#33937f" } as Record<string, string>)[key] ?? "#f3f0e7";
}

/** Characters per class across a guild's cores (each character once), biggest first: a class mix from the public page. */
export function classMix(guild: PublicGuild): { className: string; count: number }[] {
  const seen = new Map<string, string>();
  for (const core of guild.cores) for (const m of core.roster) if (!seen.has(m.name.toLowerCase())) seen.set(m.name.toLowerCase(), m.className || "Unknown");
  const counts = new Map<string, number>();
  for (const className of seen.values()) counts.set(className, (counts.get(className) ?? 0) + 1);
  return [...counts].map(([className, count]) => ({ className, count })).sort((a, b) => b.count - a.count || a.className.localeCompare(b.className));
}
