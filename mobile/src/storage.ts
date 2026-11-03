import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { apiOrigin, parseGrant, type Grant } from "./api";

export interface Session extends Grant {
  apiOrigin: string;
}

const SESSION = "guilded.mobile.session";
const ORIGIN = "guilded.mobile.origin";
const LANG = "guilded.mobile.lang";
const REMINDERS = "guilded.mobile.reminders";

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
    const row = parsed as { apiOrigin?: unknown };
    const grant = parseGrant(parsed);
    if (!grant || typeof row.apiOrigin !== "string") return null;
    return { ...grant, apiOrigin: apiOrigin(row.apiOrigin) };
  } catch {
    return null;
  }
}

export async function saveSession(session: Session): Promise<void> {
  await writeKey(SESSION, JSON.stringify(session));
}

export async function clearSession(): Promise<void> {
  try { await deleteKey(SESSION); } catch { /* a failed delete still drops the in-memory session */ }
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
