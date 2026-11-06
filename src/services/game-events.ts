import type { GameEventBoard, OfficialGameEvent, Prisma, PrismaClient } from "../generated/prisma/client.js";
import { EmbedBuilder, escapeMarkdown } from "discord.js";
import { enqueueDiscordJob } from "./discord-jobs.js";
import { retryTransientTransaction, SHORT_TRANSACTION } from "./transaction-retry.js";
import { createHash } from "node:crypto";
import { BRAND } from "../brand.js";
import { isEditionActive } from "../../companion/active-editions.mjs";
import { POE_ENABLED } from "../../companion/active-games.mjs";

export const EVENT_GAMES = ["WOW_FOREVER", "WOW_CLASSIC_ERA", "WOW_CLASSIC_TBC", "WOW_CLASSIC_MISTS", "WOW_RETAIL", "POE2"] as const;
export const EVENT_GAME_LABELS: Record<typeof EVENT_GAMES[number], string> = {
  WOW_FOREVER: "WoW Forever", WOW_CLASSIC_ERA: "WoW Classic Era", WOW_CLASSIC_TBC: "WoW Classic TBC",
  WOW_CLASSIC_MISTS: "WoW Classic Mists", WOW_RETAIL: "WoW Retail", POE2: "Path of Exile 2"
};
// Forever-only focus (companion/active-editions.mjs, companion/active-games.mjs): the games a board may
// show or be set up with. Saved boards and events of other games are kept, just not offered or drawn.
const EVENT_GAME_EDITION: Record<string, string> = { WOW_FOREVER: "forever", WOW_CLASSIC_ERA: "classic-era", WOW_CLASSIC_TBC: "classic-tbc", WOW_CLASSIC_MISTS: "classic-mists", WOW_RETAIL: "retail" };
export const isEventGameActive = (game: string): boolean => game === "POE2" ? POE_ENABLED : isEditionActive(EVENT_GAME_EDITION[game] ?? "");
export const activeEventGames = (): (typeof EVENT_GAMES[number])[] => EVENT_GAMES.filter(isEventGameActive);
export function eventGameLabel(game: string): string { return EVENT_GAME_LABELS[game as typeof EVENT_GAMES[number]] ?? game; }
export const EVENT_REGIONS = ["GLOBAL", "NA", "EU", "KR", "TW"] as const;
export const EVENT_STATES = ["SCHEDULED", "TBA", "POSTPONED", "CANCELLED", "REACHED"] as const;
export const REMINDER_MINUTES = [1440, 60, 0];
// Visual milestones rewrite the pinned board. A role is named only on the 1h and
// live reminders, and only when that offset is still in the saved opt-in config.
export const COUNTDOWN_PING_MINUTES = [60, 0] as const;
export function countdownRolePing(minutes: number, offsets: readonly number[], roleId: string | null): string | null {
  if (!roleId || !offsets.includes(minutes) || !(COUNTDOWN_PING_MINUTES as readonly number[]).includes(minutes)) return null;
  return roleId;
}
export const REMINDER_GRACE_MS = 15 * 60_000;
// One global advisory lock. Callers hold a pooled connection until the lock is
// free, so acquisition and execution stay short. Discord HTTP stays outside.
export const EVENT_TRANSACTION_OPTIONS = SHORT_TRANSACTION;
export const EVENT_BOARD_REPAIR_MS = 5 * 60_000;
export const eventEmbedsHash = (embeds: EmbedBuilder[]) => createHash("sha256").update(JSON.stringify(embeds.map(embed => embed.toJSON()))).digest("hex");
export class GameEventInputError extends Error {}
export const eventText = (fr: boolean, en: string, french: string) => fr ? french : en;
export const eventLock = (tx: Prisma.TransactionClient) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('guilded-game-events'))`;

/** Explicit offsets only; reject impossible dates rather than normalizing February 30. */
export function parseEventInstant(value: string): Date {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):00(Z|[+-]\d{2}:\d{2})$/.exec(value);
  const date = new Date(value);
  if (!match || !Number.isFinite(date.getTime()) || Number(match[2]) > 23 || Number(match[3]) > 59 ||
      new Date(`${match[1]}T00:00:00Z`).toISOString().slice(0, 10) !== match[1]) {
    throw new GameEventInputError("Use YYYY-MM-DDTHH:MM:00Z or an explicit UTC offset. / Utilisez une date ISO avec fuseau explicite.");
  }
  return date;
}

export function officialEventSource(game: string, value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new GameEventInputError("Invalid official URL. / Lien officiel invalide."); }
  const hosts = EVENT_GAMES.includes(game as typeof EVENT_GAMES[number]) && game.startsWith("WOW_") ? ["news.blizzard.com", "worldofwarcraft.blizzard.com"]
    : game === "POE2" ? ["www.pathofexile.com", "pathofexile.com", "pathofexile2.com", "www.pathofexile2.com"] : [];
  if (url.protocol !== "https:" || !hosts.includes(url.hostname) || url.username || url.password || url.port || value.length > 220 || /[<>\s()]/.test(value)) {
    throw new GameEventInputError("Use an official Blizzard or Path of Exile HTTPS announcement (max 220 characters). / Utilisez une annonce officielle HTTPS (220 caractères maximum).");
  }
  return url.href;
}

export type EventInput = Pick<OfficialGameEvent, "id" | "game" | "region" | "titleEn" | "titleFr" | "dateLabelEn" | "dateLabelFr" | "sourceUrl" | "state" | "startsAt">;
export function validateEvent(input: EventInput, now = new Date()): EventInput {
  if (!/^[a-z0-9-]{1,60}$/.test(input.id) || !EVENT_GAMES.includes(input.game as typeof EVENT_GAMES[number]) ||
      !EVENT_REGIONS.includes(input.region as typeof EVENT_REGIONS[number]) || !EVENT_STATES.includes(input.state as typeof EVENT_STATES[number])) {
    throw new GameEventInputError("Invalid event ID, game, region or state. / Événement, jeu, région ou état invalide.");
  }
  for (const text of [input.titleEn, input.titleFr]) if (!text.trim() || text.length > 80 || /[\r\n]/.test(text)) throw new GameEventInputError("Titles: 1–80 characters. / Titres : 1–80 caractères.");
  for (const text of [input.dateLabelEn, input.dateLabelFr]) if (text.length > 100 || /[\r\n]/.test(text)) throw new GameEventInputError("Date labels: 100 characters maximum. / Dates : 100 caractères maximum.");
  const timed = ["SCHEDULED", "REACHED"].includes(input.state);
  if (timed !== (input.startsAt !== null) || (input.startsAt && (!Number.isFinite(input.startsAt.getTime()) || (input.state === "REACHED" && input.startsAt > now)))) {
    throw new GameEventInputError("Scheduled/reached events need a verified instant; TBA/postponed/cancelled must have no instant. / Une date vérifiée est requise uniquement pour les événements planifiés ou atteints.");
  }
  const { id, game, region, titleEn, titleFr, dateLabelEn, dateLabelFr, state, startsAt } = input;
  return { id, game, region, titleEn, titleFr, dateLabelEn, dateLabelFr, state, startsAt, sourceUrl: officialEventSource(game, input.sourceUrl) };
}

export async function saveOfficialEvent(database: PrismaClient, input: EventInput, actorId: string, now = new Date()) {
  const data = validateEvent(input, now);
  return retryTransientTransaction(() => database.$transaction(async tx => {
    await eventLock(tx);
    const old = await tx.officialGameEvent.findUnique({ where: { id: data.id } });
    if ((!old || old.archived) && await tx.officialGameEvent.count({ where: { archived: false } }) >= 12) throw new GameEventInputError("Archive an event first (12 visible events maximum). / Archivez un événement (12 maximum).");
    const changed = old && (old.state !== data.state || old.startsAt?.getTime() !== data.startsAt?.getTime() || old.game !== data.game || old.region !== data.region || old.archived);
    return tx.officialGameEvent.upsert({ where: { id: data.id }, create: { ...data, updatedBy: actorId },
      update: { ...data, archived: false, updatedBy: actorId, ...(changed ? { scheduleVersion: { increment: 1 } } : {}) } });
  }, EVENT_TRANSACTION_OPTIONS));
}

export function visibleEvent(event: OfficialGameEvent, board: Pick<GameEventBoard, "games" | "region">): boolean {
  return !event.archived && board.games.includes(event.game) && (event.region === "GLOBAL" || event.region === board.region);
}
export function effectiveEventState(event: Pick<OfficialGameEvent, "state" | "startsAt">, now: Date): string {
  return event.state === "SCHEDULED" && event.startsAt && event.startsAt <= now ? "REACHED" : event.state;
}
/** Same public card as SHARE_CARD. Discord omits it if the image cannot load. */
export const COUNTDOWN_ART = "https://guilded.kcaron.top/images/social/guilded-card.png";
/** How long the pinned board keeps the launch banner after the scheduled instant. */
export const LAUNCH_BANNER_MS = 6 * 60 * 60_000;
const DISTANT_PURPLE = 0x8b5cf6;
const FINAL_GOLD = 0xf59e0b;
const CAVEAT_EN = "Times display in your local timezone. Timers refresh about once a minute. Reaching the scheduled time does not confirm servers are online.";
const CAVEAT_FR = "Les heures s’affichent dans votre fuseau. Les compteurs s’actualisent environ chaque minute. L’heure prévue atteinte ne confirme pas que les serveurs sont en ligne.";

// One cell per beat, far to near. The bar only advances, and it is quantized to
// the minute so a board does not edit every second.
export const COUNTDOWN_MILESTONES = [
  { id: "7d", minutes: 7 * 1440 }, { id: "3d", minutes: 3 * 1440 }, { id: "1d", minutes: 1440 },
  { id: "12h", minutes: 12 * 60 }, { id: "6h", minutes: 6 * 60 }, { id: "1h", minutes: 60 },
  { id: "30m", minutes: 30 }, { id: "10m", minutes: 10 }, { id: "5m", minutes: 5 }, { id: "1m", minutes: 1 },
  { id: "live", minutes: 0 }
] as const;
export type CountdownMilestoneId = "horizon" | typeof COUNTDOWN_MILESTONES[number]["id"];
export type CountdownVoice = { readonly title: string; readonly tagline: string; readonly line: string };
type VoicePack = { readonly en: readonly CountdownVoice[]; readonly fr: readonly CountdownVoice[] };
const voice = (title: string, tagline: string, line: string): CountdownVoice => ({ title, tagline, line });

const WARCRAFT_VOICES = {
  horizon: {
    en: [
      voice("The road to the gate", "Azeroth keeps its own hours.", "⚔️ Sharpen your steel. The road is still long."),
      voice("Banners on the horizon", "Somewhere, a hearthstone is already warm.", "⚔️ Name your company. The gate can wait a little longer.")
    ],
    fr: [
      voice("La route vers la porte", "Azeroth suit sa propre heure.", "⚔️ Aiguisez vos lames. La route est encore longue."),
      voice("Des bannières à l’horizon", "Quelque part, une pierre de foyer est déjà tiède.", "⚔️ Choisissez votre groupe. La porte peut attendre encore un peu.")
    ]
  },
  "7d": {
    en: [
      voice("Seven days to the gate", "The first horn sounds across the realm.", "⚔️ One week. Set your hearth and gather your guild."),
      voice("A week until the crossing", "The maps are out. The stories are not.", "⚔️ Seven days. Decide who stands beside you.")
    ],
    fr: [
      voice("Sept jours devant la porte", "Le premier cor traverse le royaume.", "⚔️ Une semaine. Posez votre foyer et rassemblez la guilde."),
      voice("Une semaine avant le passage", "Les cartes sont sorties. Les récits, pas encore.", "⚔️ Sept jours. Décidez qui se tient à vos côtés.")
    ]
  },
  "3d": {
    en: [
      voice("Three days. The realm leans in.", "Packs are buckled. Alts stay home.", "⚔️ Three days. The gate is starting to remember you."),
      voice("Seventy-two hours", "Sleep now, if you still can.", "⚔️ Three days. Tell your guild where to stand.")
    ],
    fr: [
      voice("Trois jours. Le royaume retient son souffle.", "Les sacs sont bouclés. Les autres personnages restent au foyer.", "⚔️ Trois jours. La porte commence à se souvenir de vous."),
      voice("Soixante-douze heures", "Dormez maintenant, si vous le pouvez encore.", "⚔️ Trois jours. Dites à la guilde où se placer.")
    ]
  },
  "1d": {
    en: [
      voice("Tomorrow, the gate opens", "Azeroth will not sleep, so you might.", "⚡ One day. Be the person your raid can find."),
      voice("One sunrise left", "The torches are already on the road.", "⚡ Tomorrow. Check your addons before your nerves.")
    ],
    fr: [
      voice("Demain, la porte s’ouvre", "Azeroth ne dormira pas. Vous, peut-être.", "⚡ Un jour. Soyez la personne que le raid peut trouver."),
      voice("Une aube encore", "Les torches sont déjà sur la route.", "⚡ Demain. Vérifiez l’addon avant les nerfs.")
    ]
  },
  "12h": {
    en: [voice("Twelve hours. The watch begins.", "Half a turn of the sun, then the gate.", "⚡ Twelve hours. The afternoon belongs to the launch.")],
    fr: [voice("Douze heures. La veille commence.", "Un demi-tour de soleil, puis la porte.", "⚡ Douze heures. L’après-midi appartient au lancement.")]
  },
  "6h": {
    en: [voice("Six hours. Armor on.", "The sky over the gate turns gold.", "⚡ Six hours. Log in early, or live with the queue.")],
    fr: [voice("Six heures. L’armure est mise.", "Le ciel au-dessus de la porte vire à l’or.", "⚡ Six heures. Connectez-vous tôt, ou vivez avec la file d’attente.")]
  },
  "1h": {
    en: [voice("Final countdown", "You can hear the portcullis.", "🔥 Final countdown. Be in Discord. Be at the character screen.")],
    fr: [voice("Dernière ligne droite", "On entend la herse.", "🔥 Dernière ligne droite. Soyez dans Discord, à l’écran du personnage.")]
  },
  "30m": {
    en: [voice("Thirty minutes", "The chain on the gate is taut.", "🔥 Final countdown. Thirty minutes. No more alts.")],
    fr: [voice("Trente minutes", "La chaîne de la porte est tendue.", "🔥 Dernière ligne droite. Trente minutes. Plus d’autres personnages.")]
  },
  "10m": {
    en: [voice("Ten minutes", "Hands on the gate.", "🔥 Final countdown. Ten minutes. Whisper your raid leader now.")],
    fr: [voice("Dix minutes", "Les mains sur la porte.", "🔥 Dernière ligne droite. Dix minutes. Un mot à votre chef de raid.")]
  },
  "5m": {
    en: [voice("Five minutes", "The horn is at the lips.", "🔥 Final countdown. Five minutes. This is the breath before.")],
    fr: [voice("Cinq minutes", "Le cor est aux lèvres.", "🔥 Dernière ligne droite. Cinq minutes. Le souffle d’avant.")]
  },
  "1m": {
    en: [voice("One minute", "Hold. Then step.", "🔥 Final countdown. Sixty seconds. See you on the other side.")],
    fr: [voice("Une minute", "Tenez. Puis avancez.", "🔥 Dernière ligne droite. Soixante secondes. On se retrouve de l’autre côté.")]
  },
  live: {
    en: [voice("THE GATES ARE OPEN", "Step through. The realm is waiting.", "⚜️ The gates are open. Find your people and cross.")],
    fr: [voice("LES PORTES SONT OUVERTES", "Franchissez le seuil. Le royaume vous attend.", "⚜️ Les portes sont ouvertes. Retrouvez les vôtres et passez.")]
  }
} satisfies Record<CountdownMilestoneId, VoicePack>;

const POE_VOICES = {
  horizon: {
    en: [voice("The atlas can wait", "Wraeclast does not rush. You might.", "⚔️ Pack light. The coast is still quiet.")],
    fr: [voice("L’atlas peut attendre", "Wraeclast ne se presse pas. Vous, peut-être.", "⚔️ Voyagez léger. La côte est encore calme.")]
  },
  "7d": {
    en: [voice("Seven days on the coast", "The first exile is already packing.", "⚔️ One week. Choose a league start you can love.")],
    fr: [voice("Sept jours sur la côte", "Le premier exil fait déjà ses bagages.", "⚔️ Une semaine. Choisissez un départ de ligue que vous aimerez.")]
  },
  "3d": {
    en: [voice("Three days to exile", "Gems are socketed. Sleep is not.", "⚔️ Three days. The strand is almost underfoot.")],
    fr: [voice("Trois jours avant l’exil", "Les gemmes sont serties. Le sommeil, non.", "⚔️ Trois jours. La grève est presque sous vos pieds.")]
  },
  "1d": {
    en: [voice("Tomorrow, the strand", "One more night before the boat.", "⚡ One day. Be the exile your party can find.")],
    fr: [voice("Demain, la grève", "Une nuit encore avant le bateau.", "⚡ Un jour. Soyez l’exil que votre groupe peut trouver.")]
  },
  "12h": {
    en: [voice("Twelve hours to the beach", "The lighthouse is already lit.", "⚡ Twelve hours. The afternoon belongs to the landing.")],
    fr: [voice("Douze heures avant la grève", "Le phare est déjà allumé.", "⚡ Douze heures. L’après-midi appartient à l’arrivée.")]
  },
  "6h": {
    en: [voice("Six hours. Boots on.", "The tide is turning toward Wraeclast.", "⚡ Six hours. Log in before the coast fills.")],
    fr: [voice("Six heures. Les bottes sont lacées.", "La marée tourne vers Wraeclast.", "⚡ Six heures. Connectez-vous avant que la côte se remplisse.")]
  },
  "1h": {
    en: [voice("Final countdown", "You can hear the surf.", "🔥 Final countdown. Be in Discord. Be at the character screen.")],
    fr: [voice("Dernière ligne droite", "On entend le ressac.", "🔥 Dernière ligne droite. Soyez dans Discord, à l’écran du personnage.")]
  },
  "30m": {
    en: [voice("Thirty minutes", "The boat does not wait.", "🔥 Final countdown. Thirty minutes. No more practice characters.")],
    fr: [voice("Trente minutes", "Le bateau n’attend pas.", "🔥 Dernière ligne droite. Trente minutes. Plus de personnages d’essai.")]
  },
  "10m": {
    en: [voice("Ten minutes", "Hands on the rail.", "🔥 Final countdown. Ten minutes. Tell your party where you land.")],
    fr: [voice("Dix minutes", "Les mains sur le bastingage.", "🔥 Dernière ligne droite. Dix minutes. Dites au groupe où vous débarquez.")]
  },
  "5m": {
    en: [voice("Five minutes", "The horn is at the lips.", "🔥 Final countdown. Five minutes. This is the breath before.")],
    fr: [voice("Cinq minutes", "Le cor est aux lèvres.", "🔥 Dernière ligne droite. Cinq minutes. Le souffle d’avant.")]
  },
  "1m": {
    en: [voice("One minute", "Hold. Then step off the boat.", "🔥 Final countdown. Sixty seconds. See you on the sand.")],
    fr: [voice("Une minute", "Tenez. Puis quittez le bateau.", "🔥 Dernière ligne droite. Soixante secondes. On se retrouve sur le sable.")]
  },
  live: {
    en: [voice("THE FIRST STEP IS YOURS", "The strand is under your boots.", "⚜️ Wraeclast is open. Find your people and walk.")],
    fr: [voice("LE PREMIER PAS EST À VOUS", "La grève est sous vos bottes.", "⚜️ Wraeclast est ouvert. Retrouvez les vôtres et avancez.")]
  }
} satisfies Record<CountdownMilestoneId, VoicePack>;

export function countdownMinutes(startsAt: Date, now: Date): number {
  return Math.ceil((startsAt.getTime() - now.getTime()) / 60_000);
}
export function countdownMilestone(minutes: number): CountdownMilestoneId {
  if (minutes <= 0) return "live";
  let matched: CountdownMilestoneId = "horizon";
  for (const step of COUNTDOWN_MILESTONES) if (step.minutes > 0 && minutes <= step.minutes) matched = step.id;
  return matched;
}
export function countdownBar(minutes: number): string {
  const width = COUNTDOWN_MILESTONES.length;
  if (minutes <= 0) return `[${"█".repeat(width)}]`;
  const filled = COUNTDOWN_MILESTONES.filter(step => step.minutes > 0 && minutes <= step.minutes).length;
  return `[${"█".repeat(filled)}${"░".repeat(width - filled)}]`;
}
export function countdownColor(milestone: CountdownMilestoneId): number {
  if (milestone === "1h" || milestone === "30m" || milestone === "10m" || milestone === "5m" || milestone === "1m") return FINAL_GOLD;
  return milestone === "horizon" ? DISTANT_PURPLE : BRAND.color;
}
function pickVoice(voices: readonly CountdownVoice[], seed: string, milestone: string, now: Date): CountdownVoice {
  const index = voices.length === 1 ? 0 : createHash("sha256").update(`${seed}:${milestone}:${Math.floor(now.getTime() / 3_600_000)}`).digest()[0]! % voices.length;
  return voices[index] ?? voices[0]!;
}
export function countdownVoice(event: Pick<OfficialGameEvent, "id" | "game">, milestone: CountdownMilestoneId, fr: boolean, now: Date): CountdownVoice {
  const pack = (event.game === "POE2" ? POE_VOICES : WARCRAFT_VOICES)[milestone];
  const picked = pickVoice(fr ? pack.fr : pack.en, event.id, milestone, now);
  if (milestone !== "live" || event.game === "WOW_FOREVER" || event.game === "POE2") return picked;
  return { ...picked, title: eventText(fr, "THE REALM IS OPEN", "LE ROYAUME EST OUVERT"), line: eventText(fr, "⚜️ It is time. Find your people and cross.", "⚜️ C’est l’heure. Retrouvez les vôtres et passez.") };
}
export function eventCountdown(startsAt: Date, fr: boolean, now: Date, event: Pick<OfficialGameEvent, "id" | "game"> = { id: "launch", game: "WOW_FOREVER" }): string {
  const minutes = countdownMinutes(startsAt, now);
  if (minutes <= 0) return "";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor(minutes % 1440 / 60);
  const remainingMinutes = minutes % 60;
  const clock = `${days}${fr ? "j" : "d"} ${String(hours).padStart(2, "0")}h ${String(remainingMinutes).padStart(2, "0")}m`;
  const line = countdownVoice(event, countdownMilestone(minutes), fr, now).line;
  return `⏳ **${clock}** · ${eventText(fr, "to go", "à patienter")}\n\`${countdownBar(minutes)}\`\n${line}`;
}

// Only the periodically edited board gets a numeric countdown. One-off reminders
// retain Discord's relative timestamp so an old notification never freezes a timer.
export function eventDetails(event: OfficialGameEvent, fr: boolean, now: Date, countdown = false): string {
  const state = effectiveEventState(event, now);
  const labels: Record<string, string> = {
    SCHEDULED: eventText(fr, "Scheduled", "Planifié"), TBA: eventText(fr, "TBA", "À confirmer"),
    POSTPONED: eventText(fr, "Postponed", "Reporté"), CANCELLED: eventText(fr, "Cancelled", "Annulé"), REACHED: eventText(fr, "Scheduled time reached", "Heure prévue atteinte")
  };
  const time = event.startsAt && ["SCHEDULED", "REACHED"].includes(state)
    ? `<t:${Math.floor(event.startsAt.getTime() / 1000)}:F> · <t:${Math.floor(event.startsAt.getTime() / 1000)}:R>`
    : escapeMarkdown(fr ? event.dateLabelFr : event.dateLabelEn).slice(0, 100);
  const timer = countdown && state === "SCHEDULED" && event.startsAt ? eventCountdown(event.startsAt, fr, now, event) : "";
  return `${timer || `**${labels[state]}**`}${time ? `\n${time}` : ""}\n[${eventText(fr, "Official source", "Source officielle")}](${event.sourceUrl})`;
}

type Spotlight = { event: OfficialGameEvent; minutes: number; milestone: CountdownMilestoneId };
function boardSpotlight(events: OfficialGameEvent[], board: Pick<GameEventBoard, "games" | "region">, now: Date): Spotlight | null {
  const visible = events.filter(event => visibleEvent(event, board));
  const next = visible.filter(event => effectiveEventState(event, now) === "SCHEDULED" && event.startsAt)
    .sort((a, b) => a.startsAt!.getTime() - b.startsAt!.getTime())[0];
  if (next?.startsAt) {
    const minutes = countdownMinutes(next.startsAt, now);
    return { event: next, minutes, milestone: countdownMilestone(minutes) };
  }
  const opened = visible.filter(event => event.startsAt && effectiveEventState(event, now) === "REACHED"
    && now.getTime() >= event.startsAt.getTime() && now.getTime() - event.startsAt.getTime() <= LAUNCH_BANNER_MS)
    .sort((a, b) => b.startsAt!.getTime() - a.startsAt!.getTime())[0];
  return opened ? { event: opened, minutes: 0, milestone: "live" } : null;
}
function spotlightDescription(spotlight: Spotlight | null, shown: CountdownVoice | null, fr: boolean, compact: boolean): string {
  const caveat = fr ? CAVEAT_FR : CAVEAT_EN;
  if (!spotlight || !shown || !spotlight.event.startsAt) return caveat;
  const name = escapeMarkdown(fr ? spotlight.event.titleFr : spotlight.event.titleEn).slice(0, 80);
  const unix = Math.floor(spotlight.event.startsAt.getTime() / 1000);
  const lead = spotlight.milestone === "live" ? `**${name}**` : `🎯 **${eventText(fr, "Up next", "Prochain rendez-vous")} · ${name}**`;
  const when = `> **<t:${unix}:R>**\n<t:${unix}:F>`;
  const bar = `\`${countdownBar(spotlight.minutes)}\``;
  const source = `[${eventText(fr, "Official source", "Source officielle")}](${spotlight.event.sourceUrl})`;
  return (compact ? [lead, when, bar, caveat] : [lead, when, bar, `*${shown.tagline}*`, source, caveat]).join("\n\n");
}
export function eventBoardEmbeds(events: OfficialGameEvent[], board: Pick<GameEventBoard, "id" | "games" | "region" | "enabled">, fr: boolean, now = new Date(), compact = false): EmbedBuilder[] {
  const spotlight = board.enabled ? boardSpotlight(events, board, now) : null;
  const shown = spotlight ? countdownVoice(spotlight.event, spotlight.milestone, fr, now) : null;
  const header = new EmbedBuilder().setColor(spotlight ? countdownColor(spotlight.milestone) : DISTANT_PURPLE)
    .setTitle(shown?.title ?? eventText(fr, "Upcoming Events", "Événements à venir"))
    .setDescription(board.enabled ? spotlightDescription(spotlight, shown, fr, compact) : eventText(fr, "This board is disabled. Reminders are off.", "Ce tableau est désactivé. Les rappels sont coupés."))
    .setFooter({ text: `Guilded events ${board.id}` });
  if (board.enabled) {
    if (spotlight) header.setAuthor({ name: `${BRAND.emoji} ${eventGameLabel(spotlight.event.game)}` });
    if (spotlight?.milestone === "live") header.setImage(COUNTDOWN_ART);
    else header.setThumbnail(COUNTDOWN_ART);
  }
  const embeds = [header];
  if (!board.enabled) return embeds;
  for (const game of EVENT_GAMES.filter(game => board.games.includes(game) && isEventGameActive(game))) {
    const rows = events.filter(event => event.game === game && visibleEvent(event, board)).sort((a, b) => {
      const time = (event: OfficialGameEvent) => effectiveEventState(event, now) === "SCHEDULED" ? event.startsAt!.getTime() : Number.MAX_SAFE_INTEGER;
      return time(a) - time(b) || a.id.localeCompare(b.id);
    });
    const embed = new EmbedBuilder().setColor(game === "POE2" ? 0xc99a48 : 0x4c87cf).setTitle(eventGameLabel(game));
    if (rows.length) embed.addFields(rows.map(event => ({ name: escapeMarkdown(fr ? event.titleFr : event.titleEn).slice(0, 80), value: eventDetails(event, fr, now, !compact) })));
    else embed.setDescription(eventText(fr, "No announced events.", "Aucun événement annoncé."));
    embeds.push(embed);
  }
  const textLength = embeds.reduce((sum, embed) => {
    const data = embed.toJSON();
    return sum + (data.title?.length ?? 0) + (data.description?.length ?? 0) + (data.footer?.text.length ?? 0)
      + (data.fields ?? []).reduce((n, field) => n + field.name.length + field.value.length, 0);
  }, 0);
  // Discord has one 6,000-character budget across all embeds in a message.
  // Dense boards keep native timestamps and every source while shedding hype.
  return !compact && textLength > 5900 ? eventBoardEmbeds(events, board, fr, now, true) : embeds;
}

/** One-off reminder. The relative timestamp stays live; the bar marks the milestone, not a frozen clock. */
export function eventReminderEmbed(event: OfficialGameEvent, fr: boolean, minutes: number, now: Date): EmbedBuilder {
  const milestone = countdownMilestone(minutes);
  const shown = countdownVoice(event, milestone, fr, now);
  const name = escapeMarkdown(fr ? event.titleFr : event.titleEn).slice(0, 80);
  const remaining = event.startsAt ? Math.max(0, countdownMinutes(event.startsAt, now)) : Math.max(0, minutes);
  const unix = event.startsAt ? Math.floor(event.startsAt.getTime() / 1000) : null;
  const when = unix ? `> **<t:${unix}:R>**\n<t:${unix}:F>` : "";
  const source = `[${eventText(fr, "Official source", "Source officielle")}](${event.sourceUrl})`;
  const caveat = eventText(fr, "This is not confirmation that servers are online.", "Ceci ne confirme pas que les serveurs sont en ligne.");
  const embed = new EmbedBuilder().setColor(countdownColor(milestone)).setAuthor({ name: `${BRAND.emoji} ${eventGameLabel(event.game)}` })
    .setTitle(`${shown.title} · ${name}`.slice(0, 256))
    .setDescription([when, `\`${countdownBar(minutes <= 0 ? 0 : remaining)}\``, `*${shown.tagline}*`, shown.line, source, caveat].filter(Boolean).join("\n\n"));
  return milestone === "live" ? embed.setImage(COUNTDOWN_ART) : embed.setThumbnail(COUNTDOWN_ART);
}
export function reminderSettings(board: GameEventBoard, game: string) {
  if (game === "WOW_FOREVER") return { role: board.wowRoleId, offsets: board.wowReminders, enabledAt: board.wowRemindersEnabledAt };
  if (game === "POE2") return { role: board.poeRoleId, offsets: board.poeReminders, enabledAt: board.poeRemindersEnabledAt };
  const off = { role: null, offsets: [] as number[], enabledAt: null };
  if (!EVENT_GAMES.includes(game as typeof EVENT_GAMES[number])) return off;
  const data = board.editionReminders;
  if (!data || Array.isArray(data) || typeof data !== "object") return off;
  const entry = data[game];
  if (!entry || Array.isArray(entry) || typeof entry !== "object" || typeof entry['role'] !== "string" || !/^\d{1,25}$/.test(entry['role'])
    || !Array.isArray(entry['offsets']) || !entry['offsets'].every(n => typeof n === "number" && REMINDER_MINUTES.includes(n)) || typeof entry['enabledAt'] !== "string") return off;
  const enabledAt = new Date(entry['enabledAt']);
  return Number.isFinite(enabledAt.getTime()) ? { role: entry['role'], offsets: entry['offsets'] as number[], enabledAt } : off;
}
// Removing a game revokes its opt-in; re-adding it never revives old role pings.
export function retainEventReminders(board: GameEventBoard | null, games: string[]): Prisma.GameEventBoardUpdateInput {
  const data = board?.editionReminders;
  const editionReminders: Prisma.InputJsonObject = data && typeof data === "object" && !Array.isArray(data) && board?.enabled
    ? Object.fromEntries(Object.entries(data).filter(([game]) => games.includes(game))) as Prisma.InputJsonObject : {};
  return { editionReminders,
    ...(!board?.enabled || !games.includes("WOW_FOREVER") ? { wowRoleId: null, wowReminders: [], wowRemindersEnabledAt: null } : {}),
    ...(!board?.enabled || !games.includes("POE2") ? { poeRoleId: null, poeReminders: [], poeRemindersEnabledAt: null } : {}) };
}
export function reminderDue(event: OfficialGameEvent, board: GameEventBoard, minutes: number, now: Date): boolean {
  const { role, offsets, enabledAt } = reminderSettings(board, event.game);
  if (!board.enabled || !visibleEvent(event, board) || !role || !offsets.includes(minutes) || !REMINDER_MINUTES.includes(minutes) ||
      !event.startsAt || !["SCHEDULED", "REACHED"].includes(event.state) || !enabledAt) return false;
  const due = event.startsAt.getTime() - minutes * 60_000;
  return due >= enabledAt.getTime() && now.getTime() >= due && now.getTime() < due + REMINDER_GRACE_MS;
}

/** One catalogue pass for every guild. The global event lock is taken once.
 * A failed pass is retried per guild so the report can name that server. */
export async function reconcileGameEventBoards(
  database: PrismaClient,
  guilds: { id: string; name: string }[],
  report: (error: unknown, guild: { id: string; name: string }, channelId: string | null) => void,
  now = new Date()
): Promise<void> {
  if (!guilds.length) {
    await queueGameEvents(database, { id: { in: [] } }, now);
    return;
  }
  try {
    await queueGameEvents(database, { guild: { discordId: { in: guilds.map(guild => guild.id) } } }, now);
    return;
  } catch { /* The steady pass could not start; attribute the next attempt. */ }
  for (const guild of guilds) {
    let channelId: string | null = null;
    try {
      channelId = (await database.gameEventBoard.findFirst({ where: { enabled: true, guild: { discordId: guild.id } }, select: { channelId: true } }))?.channelId ?? null;
      await queueGameEvents(database, { guild: { discordId: guild.id } }, now);
    } catch (error) {
      report(error, guild, channelId);
    }
  }
}

/** Reconcile at startup and once per minute; unchanged boards are not edited. */
export async function queueGameEvents(database: PrismaClient, scope: Prisma.GameEventBoardWhereInput = {}, now = new Date()) {
  await retryTransientTransaction(() => database.$transaction(async tx => {
    await eventLock(tx);
    await tx.officialGameEvent.updateMany({ where: { state: "SCHEDULED", startsAt: { lte: now } }, data: { state: "REACHED" } });
    const events = await tx.officialGameEvent.findMany({ where: { archived: false }, orderBy: { id: "asc" } });
    const boards = await tx.gameEventBoard.findMany({ where: { enabled: true, ...scope }, include: { guild: { select: { settings: { select: { language: true } } } } } });
    if (!boards.length) return;
    // One read for the batch. Never reset retries/leases for an already pending
    // refresh: under load one durable job represents the latest board state.
    const pendingBoards = new Set((await tx.discordJob.findMany({ where: { kind: "GAME_EVENT_BOARD", status: "PENDING", key: { in: boards.map(board => `game-board:${board.id}`) } }, select: { key: true } })).map(job => job.key));
    for (const board of boards) {
      const key = `game-board:${board.id}`;
      // Milestone copy is inside this hash. Crossing a beat edits the same pinned board.
      const changed = eventEmbedsHash(eventBoardEmbeds(events, board, board.guild.settings?.language === "fr", now)) !== board.contentHash;
      const repairDue = now.getTime() - board.updatedAt.getTime() >= EVENT_BOARD_REPAIR_MS;
      if (!pendingBoards.has(key) && (changed || repairDue || !board.messageId)) await enqueueDiscordJob(tx, board.guildId, key, "GAME_EVENT_BOARD", { boardId: board.id });
      // 7d, 3d, 12h, 6h, 30m, 10m, 5m and 1m are board copy only. They are not jobs.
      for (const event of events) for (const minutes of REMINDER_MINUTES) {
        if (!reminderDue(event, board, minutes, now)) continue;
        const key = `game-reminder:${board.id}:${event.id}:${event.scheduleVersion}:${minutes}`;
        // Empty update is intentional: reconciliation must NEVER resurrect a delivered job.
        await tx.discordJob.upsert({ where: { guildId_key: { guildId: board.guildId, key } }, update: {},
          create: { guildId: board.guildId, key, kind: "GAME_EVENT_REMINDER", payload: { boardId: board.id, eventId: event.id, scheduleVersion: event.scheduleVersion, minutes } } });
      }
    }
  }, EVENT_TRANSACTION_OPTIONS));
}
