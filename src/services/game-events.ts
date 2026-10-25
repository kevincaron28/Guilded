import type { GameEventBoard, OfficialGameEvent, Prisma, PrismaClient } from "../generated/prisma/client.js";
import { EmbedBuilder, escapeMarkdown } from "discord.js";
import { enqueueDiscordJob } from "./discord-jobs.js";

export const EVENT_GAMES = ["WOW_FOREVER", "POE2"] as const;
export const EVENT_REGIONS = ["GLOBAL", "NA", "EU", "KR", "TW"] as const;
export const EVENT_STATES = ["SCHEDULED", "TBA", "POSTPONED", "CANCELLED", "REACHED"] as const;
export const REMINDER_MINUTES = [1440, 60, 0];
export const REMINDER_GRACE_MS = 15 * 60_000;
// Startup shares the pool with other reconcilers. Prisma's default 2s acquisition
// deadline expires before our pool's 30s wait; keep acquisition and execution bounded.
export const EVENT_TRANSACTION_OPTIONS = { maxWait: 30_000, timeout: 30_000 };
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
  const hosts = game === "WOW_FOREVER" ? ["news.blizzard.com", "worldofwarcraft.blizzard.com"]
    : ["www.pathofexile.com", "pathofexile.com", "pathofexile2.com", "www.pathofexile2.com"];
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
  return database.$transaction(async tx => {
    await eventLock(tx);
    const old = await tx.officialGameEvent.findUnique({ where: { id: data.id } });
    if ((!old || old.archived) && await tx.officialGameEvent.count({ where: { archived: false } }) >= 12) throw new GameEventInputError("Archive an event first (12 visible events maximum). / Archivez un événement (12 maximum).");
    const changed = old && (old.state !== data.state || old.startsAt?.getTime() !== data.startsAt?.getTime() || old.game !== data.game || old.region !== data.region || old.archived);
    return tx.officialGameEvent.upsert({ where: { id: data.id }, create: { ...data, updatedBy: actorId },
      update: { ...data, archived: false, updatedBy: actorId, ...(changed ? { scheduleVersion: { increment: 1 } } : {}) } });
  }, EVENT_TRANSACTION_OPTIONS);
}

export function visibleEvent(event: OfficialGameEvent, board: Pick<GameEventBoard, "games" | "region">): boolean {
  return !event.archived && board.games.includes(event.game) && (event.region === "GLOBAL" || event.region === board.region);
}
export function effectiveEventState(event: Pick<OfficialGameEvent, "state" | "startsAt">, now: Date): string {
  return event.state === "SCHEDULED" && event.startsAt && event.startsAt <= now ? "REACHED" : event.state;
}
export function eventCountdown(startsAt: Date, fr: boolean, now: Date): string {
  const minutes = Math.ceil((startsAt.getTime() - now.getTime()) / 60_000);
  if (minutes <= 0) return "";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor(minutes % 1440 / 60);
  const remainingMinutes = minutes % 60;
  const clock = `${days}${fr ? "j" : "d"} ${String(hours).padStart(2, "0")}h ${String(remainingMinutes).padStart(2, "0")}m`;
  const stage = minutes <= 60 ? eventText(fr, "🔥 Final countdown!", "🔥 Dernière ligne droite !")
    : minutes <= 1440 ? eventText(fr, "⚡ It’s almost time!", "⚡ Le grand moment approche !")
      : eventText(fr, "⚔️ Gather your group!", "⚔️ Rassemblez votre groupe !");
  return `⏳ **${clock}** · ${eventText(fr, "to go", "à patienter")}\n${stage}`;
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
  const timer = countdown && state === "SCHEDULED" && event.startsAt ? eventCountdown(event.startsAt, fr, now) : "";
  return `${timer || `**${labels[state]}**`}${time ? `\n${time}` : ""}\n[${eventText(fr, "Official source", "Source officielle")}](${event.sourceUrl})`;
}
export function eventBoardEmbeds(events: OfficialGameEvent[], board: Pick<GameEventBoard, "id" | "games" | "region" | "enabled">, fr: boolean, now = new Date()) {
  const next = events.filter(event => visibleEvent(event, board) && effectiveEventState(event, now) === "SCHEDULED")
    .sort((a, b) => a.startsAt!.getTime() - b.startsAt!.getTime())[0];
  const spotlight = next ? `🎯 **${eventText(fr, "Up next", "Prochain rendez-vous")} · ${escapeMarkdown(fr ? next.titleFr : next.titleEn).slice(0, 80)}**\n\n` : "";
  const embeds = [new EmbedBuilder().setColor(next?.startsAt && next.startsAt.getTime() - now.getTime() <= 60 * 60_000 ? 0xf59e0b : 0x8b5cf6).setTitle(next && board.enabled ? eventText(fr, "🚀 The countdown is on", "🚀 Le compte à rebours est lancé") : eventText(fr, "Upcoming Events", "Événements à venir"))
    .setDescription(board.enabled
      ? spotlight + eventText(fr, "Count down together — get your group ready! Timers refresh about once a minute. Times display in your local timezone. Reaching the scheduled time does not confirm servers are online.", "Préparez votre groupe pour le grand moment ! Les compteurs s’actualisent environ chaque minute. Les heures s’affichent dans votre fuseau. L’heure prévue atteinte ne confirme pas que les serveurs sont en ligne.")
      : eventText(fr, "This board is disabled. Reminders are off.", "Ce tableau est désactivé. Les rappels sont coupés."))
    .setFooter({ text: `Guilded events ${board.id}` })];
  if (!board.enabled) return embeds;
  for (const game of EVENT_GAMES.filter(game => board.games.includes(game))) {
    const rows = events.filter(event => event.game === game && visibleEvent(event, board)).sort((a, b) => {
      const time = (event: OfficialGameEvent) => effectiveEventState(event, now) === "SCHEDULED" ? event.startsAt!.getTime() : Number.MAX_SAFE_INTEGER;
      return time(a) - time(b) || a.id.localeCompare(b.id);
    });
    const embed = new EmbedBuilder().setColor(game === "POE2" ? 0xc99a48 : 0x4c87cf).setTitle(game === "POE2" ? "Path of Exile 2" : "WoW Forever");
    if (rows.length) embed.addFields(rows.map(event => ({ name: escapeMarkdown(fr ? event.titleFr : event.titleEn).slice(0, 80), value: eventDetails(event, fr, now, true) })));
    else embed.setDescription(eventText(fr, "No announced events.", "Aucun événement annoncé."));
    embeds.push(embed);
  }
  return embeds;
}
export function reminderSettings(board: GameEventBoard, game: string) {
  return game === "WOW_FOREVER" ? { role: board.wowRoleId, offsets: board.wowReminders, enabledAt: board.wowRemindersEnabledAt } : { role: board.poeRoleId, offsets: board.poeReminders, enabledAt: board.poeRemindersEnabledAt };
}
export function reminderDue(event: OfficialGameEvent, board: GameEventBoard, minutes: number, now: Date): boolean {
  const { role, offsets, enabledAt } = reminderSettings(board, event.game);
  if (!board.enabled || !visibleEvent(event, board) || !role || !offsets.includes(minutes) || !REMINDER_MINUTES.includes(minutes) ||
      !event.startsAt || !["SCHEDULED", "REACHED"].includes(event.state) || !enabledAt) return false;
  const due = event.startsAt.getTime() - minutes * 60_000;
  return due >= enabledAt.getTime() && now.getTime() >= due && now.getTime() < due + REMINDER_GRACE_MS;
}

/** Reconcile at startup and once per minute; unchanged boards are not edited. */
export async function queueGameEvents(database: PrismaClient, scope: Prisma.GameEventBoardWhereInput = {}, now = new Date()) {
  await database.$transaction(async tx => {
    await eventLock(tx);
    await tx.officialGameEvent.updateMany({ where: { state: "SCHEDULED", startsAt: { lte: now } }, data: { state: "REACHED" } });
    const events = await tx.officialGameEvent.findMany({ where: { archived: false }, orderBy: { id: "asc" } });
    const boards = await tx.gameEventBoard.findMany({ where: { enabled: true, ...scope } });
    for (const board of boards) {
      const pending = await tx.discordJob.findUnique({ where: { guildId_key: { guildId: board.guildId, key: `game-board:${board.id}` } } });
      if (pending?.status !== "PENDING") await enqueueDiscordJob(tx, board.guildId, `game-board:${board.id}`, "GAME_EVENT_BOARD", { boardId: board.id });
      for (const event of events) for (const minutes of REMINDER_MINUTES) {
        if (!reminderDue(event, board, minutes, now)) continue;
        const key = `game-reminder:${board.id}:${event.id}:${event.scheduleVersion}:${minutes}`;
        // Empty update is intentional: reconciliation must NEVER resurrect a delivered job.
        await tx.discordJob.upsert({ where: { guildId_key: { guildId: board.guildId, key } }, update: {},
          create: { guildId: board.guildId, key, kind: "GAME_EVENT_REMINDER", payload: { boardId: board.id, eventId: event.id, scheduleVersion: event.scheduleVersion, minutes } } });
      }
    }
  }, EVENT_TRANSACTION_OPTIONS);
}
