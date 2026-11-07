// The guildmate map (Track M): last-seen positions of guildmates who share, a heat map of where the
// guild plays, and recent calls for help. From GET /api/v1/companion/guild-map, which answers only
// signed-in members of the same guild; nothing here is public or cached on the phone.
//
// Positions are "last seen": they reach the bot when a member's companion uploads (reload or logout).

export interface MapMate {
  character: string; name: string; className: string | null; level: number | null; mine: boolean;
  zone: string; mapId: number; x: number; y: number; continentId: number | null; cx: number | null; cy: number | null; seenAt: string;
}
export interface MapZoneLabel { zone: string; cx: number; cy: number; count: number }
export interface MapContinent { id: number; name: string; cells: [number, number, number][]; max: number; zones: MapZoneLabel[] }
export interface HelpPin {
  character: string; name: string; mine: boolean; zone: string; subzone: string | null; continentId: number | null; cx: number | null; cy: number | null;
  attackers: { name: string; class: string | null; level: number | null }[]; calledAt: string; active: boolean; cleared: boolean;
}
export interface GuildMap { enabled: boolean; sharing: boolean; days: number; mates: MapMate[]; continents: MapContinent[]; calls: HelpPin[] }

export const HEAT_COLS = 24;
export const HEAT_ROWS = 16;

const obj = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const text = (v: unknown): string | null => typeof v === "string" && v ? v : null;
const num = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
const unit = (v: unknown): number | null => { const n = num(v); return n !== null && n >= 0 && n <= 1 ? n : null; };
const int = (v: unknown, min: number, max: number): number | null => { const n = num(v); return n !== null && Number.isInteger(n) && n >= min && n <= max ? n : null; };

/** Defensive: an unreadable row is dropped; a point outside 0..1 counts as "no map position". */
export function parseGuildMap(body: unknown): GuildMap {
  const data = obj(body);
  if (!data || !Array.isArray(data.mates)) throw new Error("The guild map answer was not understood.");
  const mates = data.mates.flatMap((raw): MapMate[] => {
    const m = obj(raw);
    const character = text(m?.character), zone = text(m?.zone), seenAt = text(m?.seenAt), x = unit(m?.x), y = unit(m?.y), mapId = num(m?.mapId);
    if (!m || !character || !zone || !seenAt || x === null || y === null || mapId === null) return [];
    const cx = unit(m.cx), cy = unit(m.cy);
    const placed = cx !== null && cy !== null;
    return [{ character, name: text(m.name) ?? character, className: text(m.className), level: num(m.level), mine: m.mine === true, zone, mapId, x, y,
      continentId: placed ? num(m.continentId) : null, cx: placed ? cx : null, cy: placed ? cy : null, seenAt }];
  });
  const continents = (Array.isArray(data.continents) ? data.continents : []).flatMap((raw): MapContinent[] => {
    const c = obj(raw);
    const id = num(c?.id), name = text(c?.name);
    if (!c || id === null || !name) return [];
    const cells = (Array.isArray(c.cells) ? c.cells : []).flatMap((cell): [number, number, number][] => {
      if (!Array.isArray(cell)) return [];
      const col = int(cell[0], 0, HEAT_COLS - 1), row = int(cell[1], 0, HEAT_ROWS - 1), count = int(cell[2], 1, 1_000_000);
      return col !== null && row !== null && count !== null ? [[col, row, count]] : [];
    });
    const zones = (Array.isArray(c.zones) ? c.zones : []).flatMap((z): MapZoneLabel[] => {
      const row = obj(z);
      const zone = text(row?.zone), cx = unit(row?.cx), cy = unit(row?.cy);
      return row && zone && cx !== null && cy !== null ? [{ zone, cx, cy, count: num(row.count) ?? 0 }] : [];
    });
    return [{ id, name, cells, max: Math.max(1, ...cells.map((cell) => cell[2])), zones }];
  });
  const calls = (Array.isArray(data.calls) ? data.calls : []).flatMap((raw): HelpPin[] => {
    const c = obj(raw);
    const character = text(c?.character), calledAt = text(c?.calledAt);
    if (!c || !character || !calledAt) return [];
    const cx = unit(c.cx), cy = unit(c.cy);
    const placed = cx !== null && cy !== null;
    const attackers = (Array.isArray(c.attackers) ? c.attackers : []).flatMap((a) => {
      const row = obj(a);
      const name = text(row?.name);
      return row && name ? [{ name, class: text(row.class), level: num(row.level) }] : [];
    }).slice(0, 3);
    return [{ character, name: text(c.name) ?? character, mine: c.mine === true, zone: text(c.zone) ?? "?", subzone: text(c.subzone),
      continentId: placed ? num(c.continentId) : null, cx: placed ? cx : null, cy: placed ? cy : null, attackers, calledAt,
      active: c.active === true, cleared: c.cleared === true }];
  });
  return { enabled: data.enabled !== false, sharing: data.sharing !== false, days: num(data.days) ?? 28, mates, continents, calls };
}

/** Continents to offer as tabs: the heat map's, plus any that only a guildmate dot or a help pin is on. */
export function continentTabs(map: GuildMap): { id: number; name: string }[] {
  const tabs = map.continents.map((c) => ({ id: c.id, name: c.name }));
  const known = new Set(tabs.map((tab) => tab.id));
  for (const row of [...map.mates, ...map.calls]) {
    if (row.continentId !== null && !known.has(row.continentId)) { known.add(row.continentId); tabs.push({ id: row.continentId, name: `Map ${row.continentId}` }); }
  }
  return tabs;
}

/** 0..1 heat strength for a cell; square root so one busy zone does not wash out the rest. */
export function heatLevel(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  return Math.min(1, Math.sqrt(count / max));
}

/** "5 min ago", "3 h ago", "2 d ago". */
export function timeAgo(iso: string, now: number, lang: "en" | "fr"): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  const ago = (value: string) => lang === "fr" ? `il y a ${value}` : `${value} ago`;
  if (minutes < 1) return lang === "fr" ? "à l'instant" : "just now";
  if (minutes < 60) return ago(`${minutes} min`);
  const hours = Math.round(minutes / 60);
  if (hours < 48) return ago(`${hours} h`);
  return ago(`${Math.round(hours / 24)} ${lang === "fr" ? "j" : "d"}`);
}

const CLASS_COLORS: Record<string, string> = {
  WARRIOR: "#c69b6d", PALADIN: "#f48cba", HUNTER: "#aad372", ROGUE: "#fff468", PRIEST: "#ffffff", SHAMAN: "#0070dd",
  MAGE: "#3fc7eb", WARLOCK: "#8788ee", DRUID: "#ff7c0a", DEATHKNIGHT: "#c41e3a", MONK: "#00ff98", DEMONHUNTER: "#a330c9", EVOKER: "#33937f"
};
/** Class colour by English class name or token ("Death Knight", "DEATHKNIGHT"); a neutral gold otherwise. */
export function classColor(className: string | null): string {
  if (!className) return "#d5ad57";
  return CLASS_COLORS[className.replace(/[\s_-]/g, "").toUpperCase()] ?? "#d5ad57";
}

/** The attackers line of a help pin: "Thug (60 Rogue), Bo (58)". */
export function attackersLine(pin: HelpPin): string {
  return pin.attackers.map((a) => {
    const detail = [a.level !== null && a.level > 0 ? String(a.level) : null, a.class ? a.class.charAt(0) + a.class.slice(1).toLowerCase() : null].filter(Boolean).join(" ");
    return detail ? `${a.name} (${detail})` : a.name;
  }).join(", ");
}

/** Sample map for the preview guild. Made-up continent and zones: no game map art or real coordinates. */
export function sampleGuildMap(now = Date.now()): GuildMap {
  const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
  const cells: [number, number, number][] = [[5, 4, 6], [6, 4, 9], [6, 5, 4], [12, 9, 3], [13, 9, 7], [17, 12, 2], [4, 11, 1]];
  return {
    enabled: true, sharing: true, days: 28,
    mates: [
      { character: "Aldric Vane", name: "Aldric Vane", className: "Warrior", level: 42, mine: true, zone: "Sample Hills", mapId: 1, x: 0.4, y: 0.5, continentId: 1, cx: 0.26, cy: 0.3, seenAt: ago(12) },
      { character: "Mira Holt", name: "Mira Holt", className: "Priest", level: 38, mine: false, zone: "Sample Marsh", mapId: 2, x: 0.6, y: 0.3, continentId: 1, cx: 0.55, cy: 0.58, seenAt: ago(95) },
      { character: "Tobin Reed", name: "Tobin Reed", className: "Mage", level: 51, mine: false, zone: "Sample Coast", mapId: 3, x: 0.2, y: 0.7, continentId: 1, cx: 0.72, cy: 0.78, seenAt: ago(60 * 26) }
    ],
    continents: [{ id: 1, name: "Sample continent", cells, max: 9, zones: [
      { zone: "Sample Hills", cx: 0.26, cy: 0.28, count: 19 }, { zone: "Sample Marsh", cx: 0.55, cy: 0.6, count: 10 }, { zone: "Sample Coast", cx: 0.72, cy: 0.79, count: 2 }
    ] }],
    calls: [{ character: "Mira Holt", name: "Mira Holt", mine: false, zone: "Sample Marsh", subzone: "Old Mill", continentId: 1, cx: 0.56, cy: 0.6,
      attackers: [{ name: "Raider One", class: "ROGUE", level: 44 }], calledAt: ago(3), active: true, cleared: false }]
  };
}
