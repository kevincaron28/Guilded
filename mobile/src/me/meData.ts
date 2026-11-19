import type { Lang } from "../i18n";

// My characters (GET/POST /api/v1/me/characters...) and my promotion status (GET /api/v1/me/promotion), 0.5.0.
// Parsers keep only what the screens show; a malformed row is skipped, never thrown on.

export interface MeCharacter {
  id: string; name: string; isMain: boolean; trusted: boolean; level: number | null; className: string; race: string | null;
  /** The Discord server the character is linked to. */
  serverName: string;
  /** In that server's synced in-game guild roster, and the rank there. */
  inGuild: boolean; guildRank: string | null;
}
export interface PromotionServer {
  serverName: string; guildDiscordId: string;
  state: "off" | "above" | "progress"; rank: string | null; linked: boolean; character: string | null;
  fromRank: string; minDays: number; minLevel: number | null; requireLink: boolean; minVoiceMinutes: number; voiceDays: number;
  days: number | null; level: number | null; voiceMinutes: number; ready: boolean;
}

const obj = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const arr = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const str = (v: unknown): string | null => typeof v === "string" && v.trim() ? v : null;
const numOrNull = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
const num = (v: unknown): number => numOrNull(v) ?? 0;

export function parseMeCharacters(body: unknown): MeCharacter[] {
  return arr(obj(body)?.characters).flatMap((raw) => {
    const c = obj(raw);
    if (!c || !str(c.id) || !str(c.name)) return [];
    return [{ id: str(c.id)!, name: str(c.name)!, isMain: c.isMain === true, trusted: c.trust === "confirmed", level: numOrNull(c.level), className: str(c.className) ?? "",
      race: str(c.race), serverName: str(c.serverName) ?? "", inGuild: c.inGuild === true, guildRank: str(c.guildRank) }];
  });
}
export const isMeCharacters = (data: unknown): data is MeCharacter[] => Array.isArray(data);

export function parsePromotion(body: unknown): PromotionServer[] {
  return arr(obj(body)?.servers).flatMap((raw) => {
    const s = obj(raw);
    if (!s || !str(s.serverName)) return [];
    const state = s.state === "off" || s.state === "above" ? s.state : "progress";
    return [{ serverName: str(s.serverName)!, guildDiscordId: str(s.guildDiscordId) ?? "", state, rank: str(s.rank), linked: s.linked === true, character: str(s.character),
      fromRank: str(s.fromRank) ?? "", minDays: num(s.minDays), minLevel: numOrNull(s.minLevel), requireLink: s.requireLink !== false, minVoiceMinutes: num(s.minVoiceMinutes), voiceDays: num(s.voiceDays) || 7,
      days: numOrNull(s.days), level: numOrNull(s.level), voiceMinutes: num(s.voiceMinutes), ready: s.ready === true }];
  });
}
export const isPromotion = (data: unknown): data is PromotionServer[] => Array.isArray(data);

/** 90 -> "1 h 30 min", 180 -> "3 h", 45 -> "45 min". */
export function formatMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60), m = total % 60;
  return h && m ? `${h} h ${m} min` : h ? `${h} h` : `${m} min`;
}

export interface PromotionLine { key: string; label: string; value: string; done: boolean }

/** The checklist "What I still need to be promoted", from one server's numbers. Empty unless the state is "progress". */
export function promotionChecklist(p: PromotionServer, lang: Lang): PromotionLine[] {
  if (p.state !== "progress") return [];
  const fr = lang === "fr";
  const lines: PromotionLine[] = [];
  if (p.requireLink) lines.push({ key: "link", label: fr ? "Personnage lié" : "Character linked", value: p.linked ? (p.character ?? (fr ? "Oui" : "Yes")) : (fr ? "Non" : "No"), done: p.linked });
  lines.push(p.days === null
    ? { key: "days", label: fr ? `Jours comme ${p.fromRank}` : `Days as ${p.fromRank}`, value: fr ? "pas encore dans la liste de la guilde" : "not in the guild roster yet", done: false }
    : { key: "days", label: fr ? `Jours comme ${p.fromRank}` : `Days as ${p.fromRank}`, value: `${p.days} / ${p.minDays}`, done: p.days >= p.minDays });
  if (p.minLevel) lines.push({ key: "level", label: fr ? "Niveau" : "Level", value: `${p.level ?? "?"} / ${p.minLevel}`, done: p.level !== null && p.level >= p.minLevel });
  if (p.minVoiceMinutes > 0) lines.push({ key: "voice", label: fr ? `Vocal, ${p.voiceDays} derniers jours` : `Voice, last ${p.voiceDays} days`, value: `${formatMinutes(p.voiceMinutes)} / ${formatMinutes(p.minVoiceMinutes)}`, done: p.voiceMinutes >= p.minVoiceMinutes });
  return lines;
}
