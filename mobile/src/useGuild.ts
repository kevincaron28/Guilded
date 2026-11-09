import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { ApiError, GuildedClient, parseHub, parseManage, parseStandings, type HubView, type ManageView, type StandingsView } from "./api";
import { t, type Lang } from "./i18n";
import { pushToken, syncRaidReminders, type ReminderSync } from "./notify";
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
    catch (renewError) { if (!(renewError instanceof ApiError) || renewError.status === 401) { await clearSession(); setSession(null); setSnapshot(null); setRemoteOn(false); setLoading(false); return; } }
    if (current !== original) setSession(current);
    const client = new GuildedClient(current.apiOrigin, current.companionCredential);
    const [hub, manage, standings] = await Promise.allSettled([
      client.hub(current.guildDiscordId),
      client.manage(current.guildDiscordId),
      client.standings(current.guildDiscordId)
    ]);
    const errors: Snapshot["errors"] = {};
    if (hub.status === "rejected") errors.hub = hub.reason instanceof Error ? hub.reason.message : t(lang, "loading");
    if (manage.status === "rejected") errors.manage = manage.reason instanceof Error ? manage.reason.message : t(lang, "loading");
    if (standings.status === "rejected") errors.standings = standings.reason instanceof Error ? standings.reason.message : t(lang, "loading");
    const unauthorized = [hub, manage, standings].some((result) => result.status === "rejected" && result.reason instanceof ApiError && result.reason.status === 401);
    if (unauthorized) {
      await clearSession();
      setSession(null);
      setSnapshot(null);
      setRemoteOn(false);
      setLoading(false);
      return;
    }
    void client.deviceStatus(current.guildDiscordId).then(setRemoteOn).catch(() => {});
    setSnapshot({
      hub: hub.status === "fulfilled" ? hub.value : null,
      manage: manage.status === "fulfilled" ? manage.value : null,
      standings: standings.status === "fulfilled" ? standings.value : null,
      errors
    });
    setLoading(false);
    } finally { inFlight.current = false; }
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
    void load(session);
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
    setPushBusy(true); setPushNotice(null);
    try {
      const token = remoteOn ? undefined : await pushToken();
      await new GuildedClient(session.apiOrigin, session.companionCredential).device(session.guildDiscordId, !remoteOn, lang, token);
      if (sessionRef.current?.companionCredential !== session.companionCredential) return;
      setRemoteOn(!remoteOn);
    } catch (error) { setPushNotice(error instanceof Error ? error.message : t(lang, "alertsDenied")); }
    finally { setPushBusy(false); }
  };
  const refresh = async () => { if (!preview && session && !session.personal) await load(session); };

  const leave = async () => {
    if (session && !preview) await new GuildedClient(session.apiOrigin, session.companionCredential).logout(session.guildDiscordId);
    if (!preview) {
      await clearSession();
      if (remindersOn) void syncRaidReminders(false, []);
    }
    setPreview(false);
    setSession(null);
    setSnapshot(null);
    setRemoteOn(false);
    setPushNotice(null);
  };

  /** A guild to show: signed in to a guild server, or the sample guild. */
  const hasGuild = preview || Boolean(session && !session.personal);
  /** Signed in at all (a personal sign-in has badges but no guild), or the sample. */
  const signedIn = preview || Boolean(session);
  const guildName = snapshot?.hub?.guildName || snapshot?.manage?.guildName || snapshot?.standings?.guildName || session?.guildName || null;

  return {
    lang, setLang, ready, session, setSession, preview, startPreview, leave, refresh,
    originDraft, setOriginDraft, snapshot, setSnapshot, loading,
    remindersOn, setRemindersOn, planned, imminent, reminderSync,
    remoteOn, pushBusy, pushNotice, togglePush,
    hasGuild, signedIn, guildName
  };
}

export type GuildState = ReturnType<typeof useGuild>;
