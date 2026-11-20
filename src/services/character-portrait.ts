import sharp from "sharp";
import type { PrismaClient } from "../generated/prisma/client.js";
import { characterSlug, type ArmoryClient } from "./blizzard-armory.js";
import type { ScoreCard } from "./score-card.js";

// Character portraits for share cards (20 Nov 2026). A card about a member shows the character's Armory picture, else the member's
// Discord avatar, else the card's own placeholder. Everything here is best effort: any failure falls through, never blocks delivery.
//   - Armory render URLs are predictable from the character id we store (wowId): render.worldofwarcraft.com/forever-us/character/<id % 256>/<id>-<kind>.
//   - Picture choice: a head-and-shoulders square cut from `main-raw.png` (full body, transparent, 1600x1200). `avatar.jpg` is only 84x84, too
//     blurry for the 200 px round portrait, so it is the fallback when the full figure cannot be cut.
//   - The head sits at the top of the figure but not always at its centre (crouching, mounted-style poses), so the cut is centred on the
//     centroid of the opaque pixels in the top 30% of the figure and is 40% of the figure's height wide.

const RENDER_HOST = "render.worldofwarcraft.com";
const MAX_BYTES = 4_000_000;
export const PORTRAIT_SIZE = 256;

export type PortraitKind = "main-raw.png" | "avatar.jpg";
/** The public render URL of a character picture (`id` = the Armory character id = our `wowId`). */
export function portraitUrl(id: bigint | number | string, kind: PortraitKind): string {
  const n = BigInt(id);
  return `https://${RENDER_HOST}/forever-us/character/${n % 256n}/${n}-${kind}`;
}

export async function fetchRenderImage(url: string, timeoutMs = 5000): Promise<Buffer | null> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== RENDER_HOST) return null;
  const response = await fetch(parsed, { redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  return bytes.length && bytes.length <= MAX_BYTES ? bytes : null;
}

/** A square head-and-shoulders PNG from a full-body transparent render, or null when the picture has no figure. */
export async function headAndShoulders(mainRaw: Buffer): Promise<Buffer | null> {
  const { data, info } = await sharp(mainRaw).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  let top = height, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3]! > 40) { if (y < top) top = y; if (y > bottom) bottom = y; }
  const figure = bottom - top;
  if (bottom < 0 || figure < 80) return null;
  const limit = top + figure * 0.3;
  let sum = 0, count = 0;
  for (let y = top; y < limit; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3]! > 40) { sum += x; count++; }
  if (!count) return null;
  const side = Math.min(Math.round(figure * 0.4), width, height);
  const left = Math.max(0, Math.min(width - side, Math.round(sum / count - side / 2)));
  const cutTop = Math.max(0, Math.min(height - side, top - Math.round(figure * 0.04)));
  return sharp(mainRaw).extract({ left, top: cutTop, width: side, height: side }).resize(PORTRAIT_SIZE, PORTRAIT_SIZE).flatten({ background: "#2a2118" }).png().toBuffer();
}

export interface PortraitDeps {
  fetchImage?: (url: string) => Promise<Buffer | null>;
  /** Looks the character up by full name when no id is known (the Battle.net media call). */
  armory?: Pick<ArmoryClient, "fetchForeverCharacterMedia"> | null;
  now?: () => number;
  hitMs?: number; missMs?: number;
}

/** In-memory cache: found pictures for 6 hours, a missing picture for 30 minutes. */
export function createCharacterPortraits(deps: PortraitDeps = {}) {
  const fetchImage = deps.fetchImage ?? fetchRenderImage, now = deps.now ?? Date.now;
  const hitMs = deps.hitMs ?? 6 * 3_600_000, missMs = deps.missMs ?? 30 * 60_000;
  const cache = new Map<string, { at: number; image: Buffer | null }>();

  async function build(id: bigint): Promise<Buffer | null> {
    const full = await fetchImage(portraitUrl(id, "main-raw.png")).catch(() => null);
    const cut = full ? await headAndShoulders(full).catch(() => null) : null;
    if (cut) return cut;
    return await fetchImage(portraitUrl(id, "avatar.jpg")).catch(() => null);
  }

  async function cached(key: string, make: () => Promise<Buffer | null>): Promise<Buffer | null> {
    const hit = cache.get(key);
    if (hit && now() - hit.at < (hit.image ? hitMs : missMs)) return hit.image;
    const image = await make().catch(() => null);
    if (cache.size >= 200) cache.delete(cache.keys().next().value as string);
    cache.set(key, { at: now(), image });
    return image;
  }

  return {
    /** The picture for a known Armory character id. */
    forId: (id: bigint) => cached(`id:${id}`, () => build(id)),
    /** The picture found by exact full name (needs the Battle.net client); null without it. */
    forName: (fullName: string) => {
      const slug = characterSlug(fullName);
      if (!slug || !deps.armory) return Promise.resolve(null);
      return cached(`name:${slug}`, async () => {
        const media = await deps.armory!.fetchForeverCharacterMedia(slug);
        if (!media) return null;
        if (media.id) return build(media.id);
        const url = media.assets["main-raw"] ?? media.assets["avatar-sd"] ?? media.assets["avatar"];
        return url ? await fetchImage(url).catch(() => null) : null;
      });
    }
  };
}
export type CharacterPortraits = ReturnType<typeof createCharacterPortraits>;

type Db = Pick<PrismaClient, "character" | "armoryRosterEntry">;
const ci = (name: string) => ({ equals: name, mode: "insensitive" as const });

/** The Armory character id of a guild character by name (a linked character first, then the Armory roster mirror). */
export async function findCharacterWowId(db: Db, guildId: string, name: string, discordUserId?: string): Promise<bigint | null> {
  const wanted = name.trim();
  if (!wanted) return null;
  const rows = await db.character.findMany({
    where: { guildId, wowId: { not: null }, OR: [{ name: ci(wanted) }, { displayName: ci(wanted) }] },
    select: { wowId: true, member: { select: { discordUserId: true } } }, take: 5
  });
  const mine = rows.find((row) => discordUserId && row.member?.discordUserId === discordUserId) ?? (rows.length === 1 ? rows[0] : undefined);
  if (mine?.wowId) return mine.wowId;
  const entry = await db.armoryRosterEntry.findFirst({ where: { guildId, name: ci(wanted) }, select: { wowId: true } });
  return entry?.wowId ?? null;
}

export interface PortraitSources {
  /** The Armory picture of the promoted/featured character (bytes), or null. */
  armory: () => Promise<Buffer | null>;
  /** The member's Discord avatar (bytes), or null. */
  discord: () => Promise<Buffer | null>;
}

/** Card portrait order: Armory character picture -> Discord avatar -> none (the card draws its own placeholder). Never throws. */
export async function pickPortrait(sources: PortraitSources): Promise<{ image: Buffer; source: "armory" | "discord" } | null> {
  const armory = await sources.armory().catch(() => null);
  if (armory) return { image: armory, source: "armory" };
  const discord = await sources.discord().catch(() => null);
  return discord ? { image: discord, source: "discord" } : null;
}

/**
 * Puts the best portrait on a card about a member's character. The Armory picture replaces whatever portrait an earlier step set
 * (withDiscordMember's avatar); without one the existing portrait (the Discord avatar) stays.
 */
export async function withCharacterPortrait(card: ScoreCard, sources: PortraitSources): Promise<ScoreCard> {
  const found = await pickPortrait({ armory: sources.armory, discord: async () => (card.portrait ? Buffer.from(card.portrait, "base64") : await sources.discord()) });
  return found ? { ...card, portrait: found.image.toString("base64") } : card;
}

/** The two sources for a delivered card: the Armory by name (id from the database, else the media call) and the guild member's avatar. */
export function portraitSourcesFor(db: Db, portraits: CharacterPortraits, guildId: string, characterName: string, discordUserId: string, discordAvatar: () => Promise<Buffer | null>): PortraitSources {
  return {
    armory: async () => {
      const id = await findCharacterWowId(db, guildId, characterName, discordUserId).catch(() => null);
      return (id ? await portraits.forId(id) : null) ?? await portraits.forName(characterName);
    },
    discord: discordAvatar
  };
}

/** Rebuilds a queued promotion post's text from its stored card with the current wording (so cards queued before a wording change use it). */
export function refreshPromotionText(payload: Record<string, unknown>, userId: string, lang: "en" | "fr", congratsText: (who: string, rank: string, lang: "en" | "fr") => string): void {
  const card = payload["card"] as { promotion?: { rank?: unknown } } | undefined;
  const rank = card?.promotion?.rank;
  if (typeof rank !== "string" || !rank) return;
  const content = congratsText(`<@${userId}>`, rank, lang);
  const message = payload["message"] as Record<string, unknown> | undefined;
  if (message && typeof message === "object") message["content"] = content;
  const only = payload["cardOnly"] as Record<string, unknown> | undefined;
  if (only && typeof only === "object") only["content"] = content;
}
