import type { PrismaClient } from "../generated/prisma/client.js";
import type { GameEdition } from "./game-edition.js";
import type { Lang } from "../i18n.js";

// Member-announced world-buff drops ("Onyxia head in Stormwind at 20:15"). Players enter
// every drop; nothing here is scheduled or inferred. Classic Era has these turn-in buffs;
// Forever uses a Classic baseline, so it gets them too until its own list is confirmed.
export const WORLD_BUFFS = {
  ONYXIA: { en: "Rallying Cry of the Dragonslayer (Onyxia)", fr: "Cri de ralliement du tueur de dragons (Onyxia)" },
  NEFARIAN: { en: "Rallying Cry of the Dragonslayer (Nefarian)", fr: "Cri de ralliement du tueur de dragons (Nefarian)" },
  ZANDALAR: { en: "Spirit of Zandalar", fr: "Esprit des Zandalar" },
  WARCHIEF: { en: "Warchief's Blessing", fr: "Bénédiction du chef de guerre" }
} as const;
export type WorldBuff = keyof typeof WORLD_BUFFS;
export const WORLD_BUFF_EDITIONS: readonly GameEdition[] = ["classic-era", "forever"];
export const MAX_AHEAD_MS = 7 * 24 * 3_600_000;
// A drop stays listed a little after its time (late turn-ins); older ones are deleted.
export const LISTED_AFTER_MS = 30 * 60_000;
const PRUNE_AFTER_MS = 6 * 3_600_000;
const LIST_LIMIT = 15;

export const isWorldBuff = (value: string): value is WorldBuff => Object.hasOwn(WORLD_BUFFS, value);
export const worldBuffLabel = (buff: string, lang: Lang) => isWorldBuff(buff) ? WORLD_BUFFS[buff][lang] : buff;
export const worldBuffsSupported = (edition: GameEdition) => WORLD_BUFF_EDITIONS.includes(edition);

// Checked before anything is saved or posted (the command checks before its public reply).
export function validateDrop(buff: string, dropsAt: Date, now = new Date()): void {
  if (!isWorldBuff(buff)) throw new Error("Unknown world buff / Buff mondial inconnu.");
  if (dropsAt.getTime() <= now.getTime()) throw new Error("Pick a time in the future. / Choisissez une heure à venir.");
  if (dropsAt.getTime() - now.getTime() > MAX_AHEAD_MS) throw new Error("Drops can be announced up to 7 days ahead. / Annonces jusqu'à 7 jours à l'avance.");
}

export interface WorldBuffDropRow { id: string; buff: string; dropsAt: Date; location: string | null; note: string | null; createdBy: string }

export function worldBuffLine(drop: WorldBuffDropRow, lang: Lang): string {
  const at = Math.floor(drop.dropsAt.getTime() / 1000);
  const where = drop.location ? ` · ${drop.location}` : "";
  const note = drop.note ? ` — ${drop.note}` : "";
  return `📯 **${worldBuffLabel(drop.buff, lang)}** <t:${at}:t> (<t:${at}:R>)${where}${note} · <@${drop.createdBy}>`;
}

type Db = Pick<PrismaClient, "worldBuffDrop">;

export function createWorldBuffService(database: Db) {
  return {
    async add(input: { guildId: string; buff: string; dropsAt: Date; location?: string | null; note?: string | null; createdBy: string }, now = new Date()) {
      validateDrop(input.buff, input.dropsAt, now);
      await database.worldBuffDrop.deleteMany({ where: { guildId: input.guildId, dropsAt: { lt: new Date(now.getTime() - PRUNE_AFTER_MS) } } });
      return database.worldBuffDrop.create({
        data: {
          guildId: input.guildId, buff: input.buff, dropsAt: input.dropsAt, createdBy: input.createdBy,
          location: input.location?.trim().slice(0, 60) || null, note: input.note?.trim().slice(0, 120) || null
        }
      });
    },
    upcoming(guildId: string, now = new Date(), limit = LIST_LIMIT) {
      return database.worldBuffDrop.findMany({
        where: { guildId, dropsAt: { gt: new Date(now.getTime() - LISTED_AFTER_MS) } },
        orderBy: { dropsAt: "asc" }, take: limit
      });
    },
    // The announcer can withdraw their own drop; raid leaders can remove any.
    async remove(guildId: string, id: string, userId: string, canRemoveAny: boolean) {
      const drop = await database.worldBuffDrop.findFirst({ where: { id, guildId } });
      if (!drop) throw new Error("That drop was not found. / Annonce introuvable.");
      if (drop.createdBy !== userId && !canRemoveAny) throw new Error("Only who announced it or a raid leader can remove it. / Seul l'auteur ou un chef de raid peut la retirer.");
      await database.worldBuffDrop.delete({ where: { id: drop.id } });
      return drop;
    }
  };
}
