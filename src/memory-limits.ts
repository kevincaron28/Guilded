import sharp from "sharp";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Options, type ClientOptions } from "discord.js";

/**
 * Memory limits for the 1 GB Oracle VM (audit of 17 November 2026: the bot reached 289 MB two minutes after start and a 494-569 MB peak
 * against a 700 MB cgroup ceiling, with 300 MB pushed to swap).
 *
 * libvips keeps a decoded-picture operation cache (default 50 MB, 100 files, 100 items) and runs one worker thread per core on every
 * resize/composite. Card rendering decodes large paintings, so those defaults sit on top of the card builders' own byte budgets.
 */
export const SHARP_CACHE = { memory: 24, files: 0, items: 32 } as const;
export const SHARP_CONCURRENCY = 1;

/** The bot's own fontconfig file (site/fonts/fonts.conf): the VM has no system fontconfig, and libvips logged an error on every card. */
export const FONTCONFIG_PATH = fileURLToPath(new URL("../site/fonts/fonts.conf", import.meta.url));

/** Points fontconfig at the bot's own config unless the environment already chose one. Must run before the first text render. */
export function applyFontConfig(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (!env.FONTCONFIG_FILE && existsSync(FONTCONFIG_PATH)) env.FONTCONFIG_FILE = FONTCONFIG_PATH;
  return env.FONTCONFIG_FILE;
}

/** Applied once at startup; harmless to repeat. Returns the effective cache settings (for the test and the log line). */
export function applySharpLimits(): ReturnType<typeof sharp.cache> {
  applyFontConfig();
  sharp.concurrency(SHARP_CONCURRENCY);
  return sharp.cache({ ...SHARP_CACHE });
}

/** Sizes of the discord.js caches the bot does not read: a handful of recent messages, no presences (reaction caches stay: invite-channel reads them). */
export const MESSAGE_CACHE_LIMIT = 20;
export const MESSAGE_SWEEP_LIFETIME_SECONDS = 600;
export const MESSAGE_SWEEP_INTERVAL_SECONDS = 300;

export function discordCacheOptions(): Pick<ClientOptions, "makeCache" | "sweepers"> {
  return {
    // The bot reads no cached messages or presences (it fetches what it needs); members, voice states, channels and roles stay at the defaults.
    makeCache: Options.cacheWithLimits({ ...Options.DefaultMakeCacheSettings, MessageManager: MESSAGE_CACHE_LIMIT, PresenceManager: 0 }),
    sweepers: { ...Options.DefaultSweeperSettings, messages: { interval: MESSAGE_SWEEP_INTERVAL_SECONDS, lifetime: MESSAGE_SWEEP_LIFETIME_SECONDS } }
  };
}
