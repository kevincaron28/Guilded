// The phone talks to the same companion routes as the Windows app.
// Permissions stay on the bot: this file only reads and sends what those routes already allow.

import { parseAlbum, type Album } from "./album";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function apiOrigin(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new ApiError("Enter the Guilded server address.", 400);
  let url: URL;
  try {
    url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch {
    throw new ApiError("That server address is not valid.", 400);
  }
  if (url.username || url.password) throw new ApiError("Do not put a password in the server address.", 400);
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new ApiError("Use https for the server address. http is only allowed on this device.", 400);
  }
  return url.origin;
}

export interface Grant {
  companionCredential: string;
  personal: boolean;
  guildDiscordId: string;
  guildName: string | null;
  gameEdition: string | null;
}

export interface CharacterCard {
  id: string;
  name: string;
  displayName: string | null;
  realm: string;
  className: string;
  spec: string | null;
  level: number | null;
  isMain: boolean;
  edition: string;
  rank: string | null;
  guildName: string;
  serverName: string | null;
  current: boolean;
  cores: { name: string; role: string; bench: boolean; trial: boolean; backup: boolean }[];
}

export interface ReserveView {
  list: { active: boolean; open: boolean; title: string | null; perPlayer: number | null; syncedAt: string | null } | null;
  items: { itemName: string; characters: string[]; mine: boolean }[];
  mineCount: number;
  cores: { name: string; lootMode: string | null; reservesPerPlayer: number | null }[];
}

export interface HubView {
  guildName: string;
  edition: string;
  officer: boolean;
  raidLeader: boolean;
  updatedAt: string | null;
  characters: CharacterCard[];
  reserves: ReserveView;
  battleNet: boolean | null;
  battleTag: string | null;
}

export interface WishCharacter {
  id: string;
  name: string;
  displayName: string | null;
  realm: string;
  className: string;
  isMain: boolean;
  wishlist: { itemName: string; priority: number }[];
}

export interface CoreBoard {
  id: string;
  name: string;
  lootMode: string | null;
  rows: { rank: number; name: string; character: string; role: string; ep: number; gp: number; pr: number; belowMin: boolean; me: boolean }[];
}

export interface ManageView {
  guildName: string;
  edition: string;
  raidLeader: boolean;
  characters: WishCharacter[];
  cores: CoreBoard[];
}

export interface RaidEvent {
  id: string;
  title: string;
  at: string;
  core: string | null;
  note: string;
}

export interface NextRaidView {
  id: string;
  title: string;
  scheduledAt: string;
  core: string | null;
  players: { name: string; role: string }[];
  maybe: string[];
}

export interface StandingRow {
  character: string;
  realm: string;
  main: boolean;
  ep: number;
  gp: number;
  pr: number;
  mine: boolean;
}

export interface StandingsView {
  guildName: string;
  edition: string;
  updatedAt: string | null;
  nextRaid: NextRaidView | null;
  raids: RaidEvent[];
  standings: StandingRow[];
}

export interface SignInStart {
  requestId: string;
  confirm: string;
  expiresAt: string;
  url: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function bool(value: unknown): boolean {
  return value === true;
}
function text(value: unknown, max = 200): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function messageOf(body: unknown, fallback: string): string {
  const message = str(record(body)?.error);
  return message && message.length < 400 ? message : fallback;
}

export function parseGrant(body: unknown): Grant | null {
  const row = record(body);
  const companionCredential = str(row?.companionCredential);
  if (!row || !companionCredential || companionCredential.length < 16 || companionCredential.length > 200) return null;
  const personal = row.personal === true;
  const guildDiscordId = str(row.guildDiscordId) ?? "";
  if (!personal && !/^\d{5,30}$/.test(guildDiscordId)) return null;
  return {
    companionCredential,
    personal,
    guildDiscordId: personal ? "" : guildDiscordId,
    guildName: str(row.wowGuildName),
    gameEdition: str(row.gameEdition)
  };
}

function parseCharacter(value: unknown): CharacterCard | null {
  const row = record(value);
  const id = str(row?.id);
  const name = str(row?.name);
  if (!row || !id || !name) return null;
  const guild = record(row.guild);
  const cores = Array.isArray(row.cores) ? row.cores.flatMap((entry) => {
    const core = record(entry);
    const coreName = str(core?.name);
    if (!core || !coreName) return [];
    return [{ name: coreName, role: text(core.role, 20), bench: bool(core.bench), trial: bool(core.trial), backup: bool(core.backup) }];
  }) : [];
  return {
    id, name,
    displayName: str(row.displayName),
    realm: text(row.realm, 80),
    className: text(row.className, 40),
    spec: str(row.spec),
    level: num(row.level),
    isMain: bool(row.isMain),
    edition: text(row.edition, 40),
    rank: str(row.rank),
    guildName: text(guild?.name, 80),
    serverName: str(guild?.serverName),
    current: bool(guild?.current),
    cores
  };
}

function parseReserves(value: unknown): ReserveView {
  const row = record(value);
  const list = record(row?.list);
  const items = Array.isArray(row?.items) ? row.items.flatMap((entry) => {
    const item = record(entry);
    const itemName = str(item?.itemName);
    if (!item || !itemName) return [];
    const characters = Array.isArray(item.characters) ? item.characters.flatMap((name) => typeof name === "string" && name.trim() ? [name.trim().slice(0, 80)] : []).slice(0, 40) : [];
    return [{ itemName, characters, mine: bool(item.mine) }];
  }).slice(0, 500) : [];
  const cores = Array.isArray(row?.cores) ? row.cores.flatMap((entry) => {
    const core = record(entry);
    const name = str(core?.name);
    if (!core || !name) return [];
    return [{ name, lootMode: str(core.lootMode), reservesPerPlayer: num(core.reservesPerPlayer) }];
  }) : [];
  return {
    list: list ? {
      active: bool(list.active),
      open: bool(list.open),
      title: str(list.title),
      perPlayer: num(list.perPlayer),
      syncedAt: str(list.syncedAt)
    } : null,
    items,
    mineCount: num(row?.mineCount) ?? items.filter((item) => item.mine).length,
    cores
  };
}

export function parseHub(body: unknown): HubView {
  const row = record(body);
  if (!row || !record(row.guild)) throw new ApiError("The guild hub answer was not usable.", 502);
  const guild = record(row.guild)!;
  const me = record(row.me);
  const link = record(row.link);
  return {
    guildName: text(guild.name, 80) || "Guild",
    edition: text(guild.edition, 40),
    officer: bool(me?.officer),
    raidLeader: bool(me?.raidLeader),
    updatedAt: str(row.updatedAt),
    characters: Array.isArray(row.characters) ? row.characters.flatMap((entry) => {
      const character = parseCharacter(entry);
      return character ? [character] : [];
    }) : [],
    reserves: parseReserves(row.reserves),
    battleNet: link ? bool(link.battleNet) : null,
    battleTag: link ? str(link.battleTag) : null
  };
}

function parseWish(value: unknown): WishCharacter | null {
  const row = record(value);
  const id = str(row?.id);
  const name = str(row?.name);
  if (!row || !id || !name) return null;
  const wishlist = Array.isArray(row.wishlist) ? row.wishlist.flatMap((entry) => {
    const wish = record(entry);
    const itemName = str(wish?.itemName);
    const priority = num(wish?.priority);
    if (!wish || !itemName || priority === null || priority < 1 || priority > 3) return [];
    return [{ itemName, priority }];
  }).slice(0, 100) : [];
  return {
    id, name, wishlist,
    displayName: str(row.displayName),
    realm: text(row.realm, 80),
    className: text(row.className, 40),
    isMain: bool(row.isMain)
  };
}

export function parseManage(body: unknown): ManageView {
  const row = record(body);
  if (!row) throw new ApiError("The guild tools answer was not usable.", 502);
  const me = record(row.me);
  const cores = Array.isArray(row.cores) ? row.cores.flatMap((entry) => {
    const core = record(entry);
    const id = str(core?.id);
    const name = str(core?.name);
    if (!core || !id || !name) return [];
    const effective = record(core.effective);
    const rows = Array.isArray(core.leaderboard) ? core.leaderboard.flatMap((standing) => {
      const line = record(standing);
      const player = str(line?.name);
      if (!line || !player) return [];
      return [{
        rank: num(line.rank) ?? 0,
        name: player,
        character: text(line.character, 80),
        role: text(line.role, 20),
        ep: num(line.ep) ?? 0,
        gp: num(line.gp) ?? 0,
        pr: num(line.pr) ?? 0,
        belowMin: bool(line.belowMin),
        me: bool(line.me)
      }];
    }).slice(0, 200) : [];
    return [{ id, name, lootMode: str(effective?.lootMode), rows }];
  }) : [];
  return {
    guildName: text(row.guildName, 80),
    edition: text(row.edition, 40),
    raidLeader: bool(me?.raidLeader),
    characters: Array.isArray(row.characters) ? row.characters.flatMap((entry) => {
      const character = parseWish(entry);
      return character ? [character] : [];
    }) : [],
    cores
  };
}

function parseRaid(value: unknown): RaidEvent | null {
  const row = record(value);
  const id = str(row?.id);
  const title = str(row?.title);
  const at = str(row?.at);
  if (!row || !id || !title || !at || Number.isNaN(Date.parse(at))) return null;
  return { id, title: title.slice(0, 80), at, core: str(row.core), note: text(row.note, 400) };
}

export function parseStandings(body: unknown): StandingsView {
  const row = record(body);
  if (!row) throw new ApiError("The standings answer was not usable.", 502);
  const next = record(row.nextRaid);
  const players = Array.isArray(next?.players) ? next.players.flatMap((entry) => {
    const player = record(entry);
    const name = str(player?.name);
    if (!player || !name) return [];
    return [{ name, role: text(player.role, 20) }];
  }).slice(0, 80) : [];
  const standings = Array.isArray(row.standings) ? row.standings.flatMap((entry) => {
    const line = record(entry);
    const character = str(line?.character);
    if (!line || !character) return [];
    return [{
      character,
      realm: text(line.realm, 80),
      main: bool(line.main),
      ep: num(line.ep) ?? 0,
      gp: num(line.gp) ?? 0,
      pr: num(line.pr) ?? 0,
      mine: false
    }];
  }) : [];
  standings.sort((a, b) => b.pr - a.pr || a.character.localeCompare(b.character));
  return {
    guildName: text(row.wowGuildName, 80),
    edition: text(row.gameEdition, 40),
    updatedAt: str(row.updatedAt),
    nextRaid: next && str(next.id) && str(next.title) && str(next.scheduledAt) ? {
      id: str(next.id)!,
      title: str(next.title)!.slice(0, 80),
      scheduledAt: str(next.scheduledAt)!,
      core: str(next.core),
      players,
      maybe: Array.isArray(next.maybe) ? next.maybe.flatMap((name) => typeof name === "string" ? [name.slice(0, 80)] : []).slice(0, 40) : []
    } : null,
    raids: Array.isArray(row.raids) ? row.raids.flatMap((entry) => {
      const raid = parseRaid(entry);
      return raid ? [raid] : [];
    }).slice(0, 50) : [],
    standings: standings.slice(0, 200)
  };
}

export function withMine(rows: StandingRow[], characters: { name: string; realm: string }[]): StandingRow[] {
  const keys = new Set<string>();
  for (const character of characters) {
    keys.add(character.name.toLowerCase());
    if (character.realm) keys.add(`${character.name}-${character.realm}`.toLowerCase());
  }
  return rows.map((row) => ({ ...row, mine: keys.has(row.character.toLowerCase()) }));
}

/** A Discord event link the standings note already carried. Other links are left as text. */
export function discordEventLink(note: string): string | null {
  const match = /https:\/\/discord\.com\/events\/\d+\/\d+/.exec(note);
  return match ? match[0] : null;
}

export class GuildedClient {
  constructor(readonly origin: string, private readonly credential: string | null = null) {}

  private async call(path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; body: unknown }> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (init.body !== undefined) headers["content-type"] = "application/json";
    if (this.credential) headers["x-companion-credential"] = this.credential;
    let response: Response;
    try {
      response = await fetch(new URL(path, this.origin), {
        method: init.method ?? "GET",
        headers,
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined
      });
    } catch {
      throw new ApiError("Guilded could not be reached. Check the connection and the server address.", 0);
    }
    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try { body = JSON.parse(text) as unknown; } catch { body = null; }
    }
    return { status: response.status, body };
  }

  async startSignIn(): Promise<SignInStart> {
    const { status, body } = await this.call("/api/v1/companion/sign-in", { method: "POST", body: {} });
    if (status !== 200) throw new ApiError(messageOf(body, "Discord sign-in could not start."), status);
    const row = record(body);
    const requestId = str(row?.requestId);
    const confirm = str(row?.confirm);
    const expiresAt = str(row?.expiresAt);
    const url = str(row?.url);
    if (!requestId || !confirm || !expiresAt || !url) throw new ApiError("Discord sign-in returned an unexpected answer.", status);
    const page = new URL(url);
    if (page.origin !== this.origin || page.pathname !== "/me/companion") {
      throw new ApiError("The sign-in page was not on the configured Guilded server.", status);
    }
    return { requestId, confirm, expiresAt, url: page.href };
  }

  async pollSignIn(requestId: string): Promise<Grant | "pending"> {
    const { status, body } = await this.call("/api/v1/companion/sign-in/poll", { method: "POST", body: { requestId } });
    if (status === 202) return "pending";
    if (status !== 200) throw new ApiError(messageOf(body, "This sign-in expired. Start again."), status);
    const grant = parseGrant(body);
    if (!grant) throw new ApiError("Discord sign-in returned an unexpected answer.", status);
    return grant;
  }

  async pair(code: string, guildDiscordId?: string): Promise<Grant> {
    const payload: { code: string; guildDiscordId?: string } = { code: code.trim() };
    if (guildDiscordId?.trim()) payload.guildDiscordId = guildDiscordId.trim();
    const { status, body } = await this.call("/api/v1/addon-pairings", { method: "POST", body: payload });
    if (status !== 200) throw new ApiError(messageOf(body, "That pairing code was not accepted."), status);
    const grant = parseGrant(body);
    if (!grant) throw new ApiError("Pairing returned an unexpected answer.", status);
    return grant;
  }

  async logout(guildDiscordId: string): Promise<void> {
    try {
      await this.call("/api/v1/companion/logout", { method: "POST", body: guildDiscordId ? { guildDiscordId } : {} });
    } catch {
      // The phone still forgets the credential if the server cannot be reached.
    }
  }

  async hub(guildDiscordId: string): Promise<HubView> {
    const { status, body } = await this.call(`/api/v1/hub?guild=${encodeURIComponent(guildDiscordId)}`);
    if (status === 404) throw new ApiError("This Guilded address does not publish the guild hub yet. Characters and reserves show up after /api/v1/hub is forwarded.", 404);
    if (status !== 200) throw new ApiError(messageOf(body, "Characters could not be loaded."), status);
    return parseHub(body);
  }

  async manage(guildDiscordId: string): Promise<ManageView> {
    const { status, body } = await this.call(`/api/v1/manage?guild=${encodeURIComponent(guildDiscordId)}`);
    if (status !== 200) throw new ApiError(messageOf(body, "The wishlist could not be loaded."), status);
    return parseManage(body);
  }

  async standings(guildDiscordId: string): Promise<StandingsView> {
    const { status, body } = await this.call(`/api/v1/standings?guild=${encodeURIComponent(guildDiscordId)}`);
    if (status !== 200) throw new ApiError(messageOf(body, "Raids and standings could not be loaded."), status);
    return parseStandings(body);
  }

  async album(lang: "en" | "fr"): Promise<Album> {
    const { status, body } = await this.call(`/api/v1/companion/achievements?lang=${lang}`);
    if (status === 404) throw new ApiError("This Guilded address does not publish the badge album yet.", 404);
    if (status !== 200) throw new ApiError(messageOf(body, "The album could not be loaded."), status);
    return parseAlbum(body);
  }

  async setWishlist(guildDiscordId: string, characterId: string, item: string, priority: number): Promise<string> {
    return this.change(guildDiscordId, { action: "wishlist.set", characterId, item, priority });
  }

  async removeWishlist(guildDiscordId: string, characterId: string, item: string): Promise<string> {
    return this.change(guildDiscordId, { action: "wishlist.remove", characterId, item });
  }

  private async change(guildDiscordId: string, change: unknown): Promise<string> {
    const { status, body } = await this.call("/api/v1/manage", { method: "POST", body: { guildDiscordId, change } });
    if (status !== 200) throw new ApiError(messageOf(body, "That change was not saved."), status);
    return str(record(body)?.message) ?? "Saved.";
  }
}
