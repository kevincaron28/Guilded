import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { getRandomBytesAsync } from "expo-crypto";
import { ApiError, apiOrigin, parseGrant, type Grant } from "./api";

export interface Session extends Grant {
  apiOrigin: string;
  pendingCredential?: string;
  renewedAt?: number;
}

const SESSION = "guilded.mobile.session";
const ORIGIN = "guilded.mobile.origin";
const LANG = "guilded.mobile.lang";
const REMINDERS = "guilded.mobile.reminders";
const EDITION = "guilded.mobile.edition";
const APK_CACHE = "guilded.mobile.apkupdate";
let sessionEpoch = 0;
let sessionWrites: Promise<unknown> = Promise.resolve();

function persistSession(session: Session, expectedEpoch: number): Promise<void> {
  const operation = sessionWrites.catch(() => {}).then(async () => {
    if (expectedEpoch !== sessionEpoch) throw new Error("Session changed. Please sign in again.");
    await writeKey(SESSION, JSON.stringify(session));
  });
  sessionWrites = operation;
  return operation;
}

interface Bag {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function webBag(): Bag | null {
  if (Platform.OS !== "web") return null;
  const storage = (globalThis as { localStorage?: Bag }).localStorage;
  return storage ?? null;
}

async function readKey(key: string): Promise<string | null> {
  const bag = webBag();
  if (bag) return bag.getItem(key);
  return SecureStore.getItemAsync(key);
}

async function writeKey(key: string, value: string): Promise<void> {
  const bag = webBag();
  if (bag) { bag.setItem(key, value); return; }
  await SecureStore.setItemAsync(key, value);
}

async function deleteKey(key: string): Promise<void> {
  const bag = webBag();
  if (bag) { bag.removeItem(key); return; }
  await SecureStore.deleteItemAsync(key);
}

export async function readSession(): Promise<Session | null> {
  try {
    const raw = await readKey(SESSION);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const row = parsed as { apiOrigin?: unknown; pendingCredential?: unknown; renewedAt?: unknown };
    const grant = parseGrant(parsed);
    if (!grant || typeof row.apiOrigin !== "string") return null;
    return { ...grant, apiOrigin: apiOrigin(row.apiOrigin),
      ...(typeof row.pendingCredential === "string" && /^[A-Za-z0-9_-]{43}$/.test(row.pendingCredential) ? { pendingCredential: row.pendingCredential } : {}),
      ...(typeof row.renewedAt === "number" ? { renewedAt: row.renewedAt } : {}) };
  } catch {
    return null;
  }
}

export async function saveSession(session: Session): Promise<void> {
  await persistSession(session, ++sessionEpoch);
}

export async function clearSession(): Promise<void> {
  sessionEpoch++;
  const operation = sessionWrites.catch(() => {}).then(async () => {
    try { await deleteKey(SESSION); }
    catch { await writeKey(SESSION, "null"); }
  });
  sessionWrites = operation;
  await operation;
}

/** Write-ahead renewal makes a lost response recoverable after the old secret rotates. */
export async function renewSession(session: Session): Promise<Session> {
  const epoch = sessionEpoch;
  const persisted = await readSession();
  if (persisted?.companionCredential === session.companionCredential && persisted.pendingCredential) session = persisted;
  if (!session.pendingCredential && session.renewedAt && Date.now() - session.renewedAt < 7 * 86_400_000) return session;
  const { GuildedClient } = await import("./api");
  let pendingCredential = session.pendingCredential;
  if (!pendingCredential) {
    const bytes = await getRandomBytesAsync(32);
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    pendingCredential = "";
    let bits = 0, value = 0;
    for (const byte of bytes) {
      value = (value << 8) | byte; bits += 8;
      while (bits >= 6) { bits -= 6; pendingCredential += alphabet[(value >>> bits) & 63]; }
    }
    if (bits) pendingCredential += alphabet[(value << (6 - bits)) & 63];
    session = { ...session, pendingCredential };
    if (epoch !== sessionEpoch) throw new Error("Session changed. Please sign in again.");
    await persistSession(session, epoch);
  }
  try { await new GuildedClient(session.apiOrigin, session.companionCredential).renew(pendingCredential); }
  catch (error) {
    // A server without the renewal route (older bot) keeps the working credential; check again later.
    if (error instanceof ApiError && (error.status === 404 || error.status === 405)) {
      if (epoch !== sessionEpoch) throw new Error("Session changed. Please sign in again.", { cause: error });
      const unchanged: Session = { ...session, renewedAt: Date.now() };
      delete unchanged.pendingCredential;
      await persistSession(unchanged, epoch);
      return unchanged;
    }
    throw error;
  }
  if (epoch !== sessionEpoch) {
    void new GuildedClient(session.apiOrigin, pendingCredential).logout(session.guildDiscordId);
    throw new Error("Session changed. Please sign in again.");
  }
  const next: Session = { ...session, companionCredential: pendingCredential, renewedAt: Date.now() };
  delete next.pendingCredential;
  await persistSession(next, epoch);
  return next;
}

export async function readOrigin(): Promise<string | null> {
  try {
    const value = await readKey(ORIGIN);
    return value ? apiOrigin(value) : null;
  } catch {
    return null;
  }
}

export async function saveOrigin(origin: string): Promise<void> {
  await writeKey(ORIGIN, apiOrigin(origin));
}

export async function readLang(): Promise<"en" | "fr"> {
  try { return (await readKey(LANG)) === "fr" ? "fr" : "en"; } catch { return "en"; }
}

export async function saveLang(lang: "en" | "fr"): Promise<void> {
  try { await writeKey(LANG, lang); } catch { /* the toggle still applies for this visit */ }
}

export async function readReminders(): Promise<boolean> {
  try { return (await readKey(REMINDERS)) === "1"; } catch { return false; }
}

export async function saveReminders(on: boolean): Promise<void> {
  try { await writeKey(REMINDERS, on ? "1" : "0"); } catch { /* the switch still applies for this visit */ }
}

export const editions = ["forever", "classic-era", "classic-tbc", "classic-mists", "retail"] as const;
export type Edition = typeof editions[number];
export async function readEdition(): Promise<Edition> {
  try { const value = await readKey(EDITION); return editions.includes(value as Edition) ? value as Edition : "forever"; } catch { return "forever"; }
}
export async function saveEdition(edition: Edition): Promise<void> {
  try { await writeKey(EDITION, edition); } catch { /* the current visit keeps the selection */ }
}

export async function readApkCache(): Promise<string | null> {
  try { return await readKey(APK_CACHE); } catch { return null; }
}

export async function writeApkCache(value: string): Promise<void> {
  try { await writeKey(APK_CACHE, value); } catch { /* the next launch checks again */ }
}
