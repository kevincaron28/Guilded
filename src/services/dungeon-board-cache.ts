import { addonDungeonBoard } from "./dungeon-stats.js";
import { feedDungeonBoard } from "./dungeon-board-feed.js";

// The dungeon board of the companion standings feed (the season ladders, every character's per-dungeon details, role scores and
// guidance: about 1.4 MB of JSON for the main guild). Building it scores every run of the season, which took 5-15 s of CPU, and the
// standings feed read it again after every change of the guild (an upload every few minutes), so the standings rebuild went past its
// 10 s budget about 19 times in 3 hours (20 Nov 2026). It only depends on dungeon runs, seasons and names, none of which an
// EP/GP, bank, raid or craft change touches, so it is kept per guild:
//  - the first read after a start builds it (nobody has an older one to be served);
//  - a read after it was marked stale (a dungeon import, `invalidateDungeonBoard`) or older than `maxAgeMs` is answered with the kept
//    board at once while ONE rebuild runs in the background; when that rebuild finds different content, `onChanged` tells the feed
//    (markGuildChanged), so waiting companions fetch the new board a moment later.
// A rebuild that finds the same content keeps the very same object, so its JSON (made once per object by the feed) is reused too.

type Board = Awaited<ReturnType<typeof addonDungeonBoard>>;
type BoardDb = Parameters<typeof addonDungeonBoard>[0];
interface Entry { board: Board; json: string; builtAt: number; stale: boolean; retryAt: number; refreshing?: Promise<void> | undefined }

export interface DungeonBoardCacheOptions {
  /** A kept board older than this is rebuilt in the background on the next read (default 10 min: covers changes that report nothing, such as names and weekly resets). */
  maxAgeMs?: number;
  /** After a failed background rebuild, the next attempt waits this long (default 60 s). */
  retryMs?: number;
  now?: () => number;
  build?: (database: BoardDb, guildId: string) => Promise<Board>;
  log?: (message: string) => void;
}

export function createDungeonBoardCache(options: DungeonBoardCacheOptions = {}) {
  const maxAgeMs = options.maxAgeMs ?? 600_000;
  const retryMs = options.retryMs ?? 60_000;
  const now = options.now ?? Date.now;
  // Without the fields nobody reads (dungeon-board-feed.ts).
  const build = options.build ?? (async (database, guildId) => feedDungeonBoard(await addonDungeonBoard(database, guildId)));
  const log = options.log ?? ((message: string) => console.info(message));
  const entries = new Map<string, Entry>();
  const firstBuilds = new Map<string, Promise<Board>>();

  async function timedBuild(database: BoardDb, guildId: string, reason: string): Promise<{ board: Board; json: string }> {
    const started = now();
    const board = await build(database, guildId);
    const json = JSON.stringify(board);
    // Watched in production: how long the board takes to build and how large it is.
    log(`Dungeon board for guild ${guildId} built in ${now() - started} ms (${json.length} bytes, ${reason}).`);
    return { board, json };
  }

  function refresh(database: BoardDb, guildId: string, entry: Entry, onChanged: () => void, reason: string) {
    if (entry.refreshing) return;
    entry.refreshing = timedBuild(database, guildId, reason).then(({ board, json }) => {
      const changed = json !== entry.json;
      if (changed) { entry.board = board; entry.json = json; }
      entry.builtAt = now(); entry.stale = false; entry.retryAt = 0;
      if (changed) onChanged();
    }, (error: unknown) => {
      entry.retryAt = now() + retryMs;
      console.warn(`Dungeon board rebuild failed; the previous board is kept (${error instanceof Error ? error.message : String(error)}).`);
    }).finally(() => { entry.refreshing = undefined; });
  }

  return {
    /** The guild's dungeon board: the kept one at once when there is one (rebuilt in the background when it is stale), else built now. */
    async get(database: BoardDb, guildId: string, onChanged: () => void = () => undefined): Promise<Board> {
      const entry = entries.get(guildId);
      if (entry) {
        const t = now();
        if ((entry.stale || t - entry.builtAt >= maxAgeMs || t < entry.builtAt) && t >= entry.retryAt) refresh(database, guildId, entry, onChanged, entry.stale ? "dungeon data changed" : "refresh");
        return entry.board;
      }
      let first = firstBuilds.get(guildId);
      if (!first) {
        first = timedBuild(database, guildId, "first read").then(({ board, json }) => {
          if (!entries.has(guildId)) entries.set(guildId, { board, json, builtAt: now(), stale: false, retryAt: 0 });
          return board;
        }).finally(() => { firstBuilds.delete(guildId); });
        firstBuilds.set(guildId, first);
      }
      return first;
    },
    /** Dungeon runs, seasons or the names on them changed: the next read rebuilds the board in the background. */
    invalidate(guildId: string) { const entry = entries.get(guildId); if (entry) entry.stale = true; },
    clear() { entries.clear(); firstBuilds.clear(); }
  };
}

export const dungeonBoardCache = createDungeonBoardCache();
export function invalidateDungeonBoard(guildId: string): void { dungeonBoardCache.invalidate(guildId); }
