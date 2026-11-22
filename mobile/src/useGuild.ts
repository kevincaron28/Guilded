import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { guildCacheKey, clearGuildCaches, readCache, writeCache } from "./cache";
import { ApiError, GuildedClient, parseHub, parseManage, parseStandings, type HubView, type ManageView, type StandingsView } from "./api";
import { errorText } from "./errors";
import { t, type Lang } from "./i18n";
import { PushSetupError, pushToken, syncRaidReminders, type ReminderSync } from "./notify";
import { planReminders, soonRaids } from "./reminders";
import { sampleHubBody, sampleManageBody, sampleStandingsBody } from "./sample";
import { clearSession, readLang, readOrigin, readReminders, readSession, renewSession, saveLang, saveReminders, type Session } from "./storage";

// The signed-in guild, shared by every tab (moved out of the old GuildScreen for the five-tab shell).
// Storage keys and the session format are unchanged.

export interface Snapshot {
  hub: HubView | null;
  manage: ManageView | null;
  standings: StandingsView | null;
  errors: { hub?: string; manage?: string; standings?: string };
  /** When the newest view in this snapshot was fetched (epoch ms). Set for saved copies and fresh loads alike. */
  savedAt?: number;
  /** Some view is the saved copy because its refresh failed (offline, server down). */
  stale?: boolean;
}

const isObject = (data: unknown): data is Record<string, unknown> => typeof data === "object" && data !== null;
const isHub = (data: unknown): data is HubView => isObject(data) && Array.isArray(data.characters);
const isManage = (data: unknown): data is ManageView => isObject(data) && Array.isArray(data.cores);
const isStandings = (data: unknown): data is StandingsView => isObject(data) && Array.isArray(data.standings);

/** The saved copy of a guild's three views (offline snapshot, cache.ts), or null when nothing is saved. */
export async function readGuildSnapshot(guildDiscordId: string, now = Date.now()): Promise<Snapshot | null> {
  const [hub, manage, standings] = await Promise.all([
    readCache<HubView>(guildCacheKey(guildDiscordId, "hub"), isHub, now),
    readCache<ManageView>(guildCacheKey(guildDiscordId, "manage"), isManage, now),
    readCache<StandingsView>(guildCacheKey(guildDiscordId, "standings"), isStandings, now)
  ]);
  const saved = [hub, manage, standings].filter((entry) => entry !== null);
  if (saved.length === 0) return null;
  return { hub: hub?.data ?? null, manage: manage?.data ?? null, standings: standings?.data ?? null, errors: {}, savedAt: Math.max(...saved.map((entry) => entry.savedAt)), stale: true };
}

export function sampleSnapshot(): Snapshot {
  return { hub: parseHub(sampleHubBody), manage: parseManage(sampleManageBody), standings: parseStandings(sampleStandingsBody), errors: {} };
}

export function useGuild(defaultOrigin: string) {
  const [lang, setLangState] = useState<Lang>("en");
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [preview, setPreview] = useState(false);
  const [originDraft, setOriginDraft] = useState(defaultOrigin);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [remindersOn, setRemindersState] = useState(false);
  const [reminderSync, setReminderSync] = useState<ReminderSync | null>(null);
  const [remoteOn, setRemoteOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushNotice, setPushNotice] = useState<string | null>(null);
  const [pushNeedsSettings, setPushNeedsSettings] = useState(false);
  const snapshotRef = useRef<Snapshot | null>(null);
  snapshotRef.current = snapshot;
  const sessionRef = useRef<Session | null>(null);
  const inFlight = useRef(false);
  sessionRef.current = session;

  useEffect(() => {
    let active = true;
    void (async () => {
      const [stored, language, reminders, savedOrigin] = await Promise.all([readSession(), readLang(), readReminders(), readOrigin()]);
      if (!active) return;
      setLangState(language);
      setRemindersState(reminders);
      if (savedOrigin) setOriginDraft(savedOrigin);
      setSession(stored);
      setReady(true);
    })();
    return () => { active = false; };
  }, []);

  const load = useCallback(async (original: Session) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
    // Renewal is housekeeping: only a revoked credential (401) stops here; other failures must not hide guild data.
    let current = original;
    try { current = await renewSession(original); }
    catch (renewError) { if (!(renewError instanceof ApiError) || renewError.status === 401) { await clearSession(); void clearGuildCaches(); setSession(null); setSnapshot(null); setRemoteOn(false); setLoading(false); return; } }
    if (current !== original) setSession(current);
    const client = new GuildedClient(current.apiOrigin, current.companionCredential);
    const [hub, manage, standings] = await Promise.allSettled([
      client.hub(current.guildDiscordId),
      client.manage(current.guildDiscordId),
      client.standings(current.guildDiscordId)
    ]);
    // A view that failed to refresh keeps its saved copy (shown with "last updated"); only a view with nothing saved shows the error.
    const previous = snapshotRef.current;
    const errors: Snapshot["errors"] = {};
    if (hub.status === "rejected" && !previous?.hub) errors.hub = errorText(hub.reason, lang, t(lang, "loading"));
    if (manage.status === "rejected" && !previous?.manage) errors.manage = errorText(manage.reason, lang, t(lang, "loading"));
    if (standings.status === "rejected" && !previous?.standings) errors.standings = errorText(standings.reason, lang, t(lang, "loading"));
    const unauthorized = [hub, manage, standings].some((result) => result.status === "rejected" && result.reason instanceof ApiError && result.reason.status === 401);
    if (unauthorized) {
      await clearSession();
      void clearGuildCaches();
      setSession(null);
      setSnapshot(null);
      setRemoteOn(false);
      setLoading(false);
      return;
    }
    void client.deviceStatus(current.guildDiscordId).then(setRemoteOn).catch(() => {});
    const now = Date.now();
    if (hub.status === "fulfilled") void writeCache(guildCacheKey(current.guildDiscordId, "hub"), hub.value, now);
    if (manage.status === "fulfilled") void writeCache(guildCacheKey(current.guildDiscordId, "manage"), manage.value, now);
    if (standings.status === "fulfilled") void writeCache(guildCacheKey(current.guildDiscordId, "standings"), standings.value, now);
    const fellBack = [hub, manage, standings].some((result) => result.status === "rejected") && Boolean(previous);
    setSnapshot({
      hub: hub.status === "fulfilled" ? hub.value : previous?.hub ?? null,
      manage: manage.status === "fulfilled" ? manage.value : previous?.manage ?? null,
      standings: standings.status === "fulfilled" ? standings.value : previous?.standings ?? null,
      errors,
      savedAt: fellBack ? previous?.savedAt ?? now : now,
      stale: fellBack
    });
    setLoading(false);
    } finally { inFlight.current = false; setLoading(false); }
  }, [lang]);

  // Back in the app: refresh the guild (also renews the credential and re-checks push).
  useEffect(() => {
    const resume = AppState.addEventListener("change", (state) => {
      const current = sessionRef.current;
      if (state === "active" && current && !current.personal && !preview) void load(current);
    });
    return () => resume.remove();
  }, [load, preview]);

  useEffect(() => {
    if (!ready || preview || !session || session.personal) return;
    let active = true;
    // The saved copy shows at once (also offline); the refresh replaces it when it arrives.
    if (!snapshotRef.current) void readGuildSnapshot(session.guildDiscordId).then((saved) => { if (active && saved && !snapshotRef.current) setSnapshot(saved); });
    void load(session);
    return () => { active = false; };
  }, [ready, preview, session, load]);

  const raids = snapshot?.standings?.raids;
  const planned = useMemo(() => planReminders(raids ?? [], Date.now(), lang), [raids, lang]);
  const imminent = useMemo(() => soonRaids(raids ?? []), [raids]);

  useEffect(() => {
    if (!snapshot || preview) return;
    let active = true;
    // Server push replaces on-device reminders so a raid is never announced twice.
    void syncRaidReminders(remindersOn && !remoteOn, planned, session?.guildDiscordId).then((result) => { if (active) setReminderSync(result); });
    return () => { active = false; };
  }, [snapshot, preview, remindersOn, remoteOn, planned, session?.guildDiscordId]);

  const setLang = (next: Lang) => { setLangState(next); void saveLang(next); };
  const setRemindersOn = (on: boolean) => { setRemindersState(on); if (!preview) void saveReminders(on); };
  const startPreview = () => { setPreview(true); setSnapshot(sampleSnapshot()); };
  const togglePush = async () => {
    if (!session || session.personal || preview || pushBusy) return;
    setPushBusy(true); setPushNotice(null); setPushNeedsSettings(false);
    try {
      const token = remoteOn ? undefined : await pushToken();
      await new GuildedClient(session.apiOrigin, session.companionCredential).device(session.guildDiscordId, !remoteOn, lang, token);
      if (sessionRef.current?.companionCredential !== session.companionCredential) return;
      setRemoteOn(!remoteOn);
    } catch (error) {
      setPushNotice(error instanceof PushSetupError ? error.message : errorText(error, lang, t(lang, "alertsDenied")));
      setPushNeedsSettings(error instanceof PushSetupError && error.needsSettings);
    }
    finally { setPushBusy(false); }
  };
  const refresh = async () => { if (!preview && session && !session.personal) await load(session); };

  const leave = async () => {
    if (session && !preview) await new GuildedClient(session.apiOrigin, session.companionCredential).logout(session.guildDiscordId);
    if (!preview) {
      await clearSession();
      void clearGuildCaches();
      if (remindersOn) void syncRaidReminders(false, []);
    }
    setPreview(false);
    setSession(null);
    setSnapshot(null);
    setRemoteOn(false);
    setPushNotice(null);
  };

  /**
   * Delete my data, then forget the sign-in on this phone. Throws with the server's reason when it refuses;
   * returns "unavailable" (and changes nothing) when the server does not offer the route. A sign-in the server no
   * longer knows counts as deleted: the phone must not stay signed in with a dead credential.
   */
  const deleteMyData = async (): Promise<"deleted" | "unavailable"> => {
    if (!session || preview) return "unavailable";
    const outcome = await new GuildedClient(session.apiOrigin, session.companionCredential).deleteMyData();
    if (outcome === "unavailable") return outcome;
    // The server removed the sign-in with the rest: nothing to sign out of, only the phone's copy to clear.
    await clearSession();
    void clearGuildCaches();
    if (remindersOn) void syncRaidReminders(false, []);
    setSession(null);
    setSnapshot(null);
    setRemoteOn(false);
    setPushNotice(null);
    return "deleted";
  };

  /** A guild to show: signed in to a guild server, or the sample guild. */
  const hasGuild = preview || Boolean(session && !session.personal);
  /** Signed in at all (a personal sign-in has badges but no guild), or the sample. */
  const signedIn = preview || Boolean(session);
  const guildName = snapshot?.hub?.guildName || snapshot?.manage?.guildName || snapshot?.standings?.guildName || session?.guildName || null;

  return {
    lang, setLang, ready, session, setSession, preview, startPreview, leave, deleteMyData, refresh,
    originDraft, setOriginDraft, snapshot, setSnapshot, loading,
    remindersOn, setRemindersOn, planned, imminent, reminderSync,
    remoteOn, pushBusy, pushNotice, pushNeedsSettings, togglePush,
    hasGuild, signedIn, guildName
  };
}

export type GuildState = ReturnType<typeof useGuild>;
