// Public, read-only data: the same ratings and guild pages the website shows. No credential is sent.

export interface BoardCharacter { rank: number; name: string; realm: string | null; className: string | null; role: string | null; points: number }
export interface BoardGuild { rank: number; id: string; name: string; slug: string | null; points: number; rated: number }
export interface BoardBracket { key: string; name: string; characters: BoardCharacter[]; guilds: BoardGuild[] }
export interface Boards { season: string; brackets: BoardBracket[] }

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

export function parseBoards(body: unknown): Boards {
  const data = obj(body);
  if (!data) throw new Error("The boards answer was not understood.");
  return {
    season: str(data.season) ?? "",
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

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(response.status === 404 ? "Not found." : `The server answered ${response.status}.`);
  return response.json();
}

export const fetchBoards = async (origin: string, lang: "en" | "fr"): Promise<Boards> => parseBoards(await getJson(`${origin}/leaderboards/boards.json?lang=${lang}`));
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
