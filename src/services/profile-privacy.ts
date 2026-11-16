import { randomBytes } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client.js";
import { clearLeaderboardCaches, registerLeaderboardCache } from "./leaderboard-cache-hooks.js";

// "Hide my profile" (9.3.7): the opt-out from the PUBLIC pages (directory member lists, player and character pages, public leaderboards and
// role tabs, run and duel listings, public JSON). Public stays the default. One row per Discord user (PublicProfileHidden), so it covers
// every character they link, also later ones. A hidden player in a public run or duel is shown as an anonymous placeholder (class, role and
// level stay, so the group still reads): the run and the other players' records never change. Servers' own Discord boards and cards are not public
// pages and are untouched.
//
// What cannot be hidden: a player nobody linked to a Discord user (they never signed in or linked), because the bot has no one to ask.
// The first-name-only spelling older uploads used ("Kev" for "Kev Caron") is hidden too, so a bare first name on a hidden character's realm
// is taken for it; a stranger with the same first name on that realm can be hidden by mistake (privacy errs on the hiding side).

/** The page cache window in minutes after a toggle (bot memo 60 s, JSON max-age 120 s): said in the confirmation. */
export const HIDE_DELAY_MINUTES = 3;

/** Text standing in for a hidden player's name inside stored rows; the public page replaces it by the word of the viewer's language. */
export const HIDDEN_MARK = "⁣hidden⁣";
export const hiddenLabel = (lang: string) => lang === "fr" ? "Joueur masqué" : "Hidden player";
/** The page or JSON text with every hidden-player mark replaced by the viewer's wording. */
export const showHiddenMarks = (text: string, lang: string) => text.includes(HIDDEN_MARK) ? text.split(HIDDEN_MARK).join(hiddenLabel(lang)) : text;

const salt = randomBytes(8).toString("hex");
/** A stable per-process key for a hidden player's duel side (never the name), so the ladder can group their results without showing who. */
export function hiddenKey(key: string): string {
  let h = 2166136261;
  for (const ch of `${salt}|${key}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return `h:${h.toString(36)}`;
}
export const isHiddenKey = (key: string | null | undefined) => !!key && key.startsWith("h:");

const norm = (text: string) => text.trim().toLowerCase();
const realmNorm = (text: string | null | undefined) => (text ?? "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const firstWord = (name: string) => norm(name).split(/\s+/)[0] ?? "";

export interface HiddenIdentity {
  /** Discord user ids that hide. */
  users: ReadonlySet<string>;
  /** "name|realm" of every character of theirs (full names, lower case; realm letters and digits only, may be empty). */
  keys: ReadonlySet<string>;
  /** Bare first names with their realm, for the older first-name-only spelling. */
  firsts: ReadonlySet<string>;
  /** The same names without a realm (a stored row with no realm matches by name). */
  names: ReadonlySet<string>;
  /** Characters with no realm stored: they match that name on any realm. */
  blankRealm: ReadonlySet<string>;
}
export const NOBODY_HIDDEN: HiddenIdentity = { users: new Set(), keys: new Set(), firsts: new Set(), names: new Set(), blankRealm: new Set() };

/** Whether a public player (name as stored in a run or duel, and realm or "") belongs to a hiding user. */
export function isHiddenPlayer(hidden: HiddenIdentity, name: string, realm: string | null | undefined): boolean {
  if (!hidden.users.size) return false;
  const n = norm(name), r = realmNorm(realm);
  if (!n) return false;
  const hit = (candidate: string, set: ReadonlySet<string>) => set.has(`${candidate}|${r}`) || (r === "" && hidden.names.has(candidate)) || hidden.blankRealm.has(candidate);
  if (hit(n, hidden.keys)) return true;
  // A bare first name (older uploads): the first name of one of the hidden characters, on that realm.
  return !n.includes(" ") && (hidden.firsts.has(`${n}|${r}`) || (r === "" && hidden.names.has(`${n}|`)) || hidden.blankRealm.has(`${n}|`));
}

export async function loadHiddenIdentity(db: Pick<PrismaClient, "publicProfileHidden" | "character" | "webCharacter" | "deviceCharacter">): Promise<HiddenIdentity> {
  const rows = await db.publicProfileHidden.findMany({ select: { discordUserId: true }, take: 50_000 });
  if (!rows.length) return NOBODY_HIDDEN;
  const ids = rows.map((row) => row.discordUserId);
  const [guild, web, device] = await Promise.all([
    db.character.findMany({ where: { member: { discordUserId: { in: ids } } }, select: { name: true, displayName: true, realm: true }, take: 100_000 }),
    db.webCharacter.findMany({ where: { account: { discordUserId: { in: ids } } }, select: { name: true, displayName: true, realm: true }, take: 100_000 }),
    // Characters an unsigned companion reported are tied to a person only once that companion was claimed by a member.
    db.deviceCharacter.findMany({ where: { device: { claimedMember: { discordUserId: { in: ids } } } }, select: { name: true, displayName: true, realm: true }, take: 100_000 })
  ]);
  const keys = new Set<string>(), firsts = new Set<string>(), names = new Set<string>(), blankRealm = new Set<string>();
  for (const row of [...guild, ...web, ...device]) {
    const r = realmNorm(row.realm);
    for (const spelled of [row.name, row.displayName ?? ""]) {
      const n = norm(spelled);
      if (!n) continue;
      keys.add(`${n}|${r}`); names.add(n);
      if (!r) blankRealm.add(n);
      const first = firstWord(spelled);
      if (first && first !== n) { firsts.add(`${first}|${r}`); names.add(`${first}|`); if (!r) blankRealm.add(`${first}|`); }
    }
  }
  return { users: new Set(ids), keys, firsts, names, blankRealm };
}

/** The hidden set, kept for a short while and dropped with every leaderboard cache (a toggle clears it at once). */
export function hiddenLookup(db: Parameters<typeof loadHiddenIdentity>[0], ttlMs = 30_000, now: () => number = Date.now) {
  let memo: { at: number; value: Promise<HiddenIdentity> } | null = null;
  const clear = () => { memo = null; };
  registerLeaderboardCache(clear);
  return {
    get(): Promise<HiddenIdentity> {
      if (!memo || now() - memo.at > ttlMs) {
        const value = loadHiddenIdentity(db);
        memo = { at: now(), value };
        value.catch(() => { if (memo?.value === value) memo = null; });
      }
      return memo.value;
    },
    clear
  };
}

export async function isProfileHidden(db: Pick<PrismaClient, "publicProfileHidden">, discordUserId: string): Promise<boolean> {
  return (await db.publicProfileHidden.findUnique({ where: { discordUserId }, select: { discordUserId: true } })) !== null;
}

/** Hides or shows the user's characters on the public pages. Returns whether anything changed. */
export async function setProfileHidden(db: Pick<PrismaClient, "publicProfileHidden">, discordUserId: string, hidden: boolean): Promise<boolean> {
  if (!/^\d{5,25}$/.test(discordUserId)) throw new Error("A Discord user id is required.");
  let changed: boolean;
  if (hidden) {
    changed = (await db.publicProfileHidden.findUnique({ where: { discordUserId }, select: { discordUserId: true } })) === null;
    if (changed) await db.publicProfileHidden.upsert({ where: { discordUserId }, create: { discordUserId }, update: {} });
  } else changed = (await db.publicProfileHidden.deleteMany({ where: { discordUserId } })).count > 0;
  clearLeaderboardCaches();
  return changed;
}

/** The ephemeral reply of /character privacy. */
export function privacyReply(lang: string, action: "hide" | "show" | "status", hiddenNow: boolean): string {
  const fr = lang === "fr";
  const delay = fr ? `Les pages publiques se mettent à jour en ${HIDE_DELAY_MINUTES} minutes environ.` : `Public pages catch up within about ${HIDE_DELAY_MINUTES} minutes.`;
  if (action === "status") {
    return fr
      ? (hiddenNow ? "Votre profil est **masqué** sur les pages publiques (annuaire, classements, joueurs, donjons et duels). Dans une partie publique vous apparaissez comme « Joueur masqué ». `/character privacy show` le rétablit." : "Votre profil est **public** (valeur par défaut). `/character privacy hide` vous retire des pages publiques.")
      : (hiddenNow ? "Your profile is **hidden** on the public pages (directory, leaderboards, player, dungeon and duel pages). In a public group you show as “Hidden player”. `/character privacy show` brings it back." : "Your profile is **public** (the default). `/character privacy hide` takes you off the public pages.");
  }
  if (action === "hide") {
    return fr
      ? `Votre profil est masqué sur les pages publiques : annuaire, classements, pages de joueur, donjons et duels (vos personnages liés, aussi ceux liés plus tard). Dans un donjon ou un duel public, vous apparaissez comme « Joueur masqué » ; le résultat des autres reste. Les tableaux et cartes de votre serveur Discord ne changent pas. ${delay}`
      : `Your profile is hidden on the public pages: directory, leaderboards, player pages, dungeon and duel listings (your linked characters, including ones linked later). In a public run or duel you show as “Hidden player”; everyone else's results stay. Your own Discord server's boards and cards do not change. ${delay}`;
  }
  return fr
    ? `Votre profil est de nouveau public. ${delay}`
    : `Your profile is public again. ${delay}`;
}
