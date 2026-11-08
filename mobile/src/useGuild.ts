import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, GuildedClient, parseHub, parseManage, parseStandings, type HubView, type ManageView, type StandingsView } from "./api";
import { t, type Lang } from "./i18n";
import { syncRaidReminders, type ReminderSync } from "./notify";
import { planReminders, soonRaids } from "./reminders";
import { sampleHubBody, sampleManageBody, sampleStandingsBody } from "./sample";
import { clearSession, readLang, readOrigin, readReminders, readSession, saveLang, saveReminders, type Session } from "./storage";

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

  const load = useCallback(async (current: Session) => {
    setLoading(true);
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
      setLoading(false);
      return;
    }
    setSnapshot({
      hub: hub.status === "fulfilled" ? hub.value : null,
      manage: manage.status === "fulfilled" ? manage.value : null,
      standings: standings.status === "fulfilled" ? standings.value : null,
      errors
    });
    setLoading(false);
  }, [lang]);

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
    void syncRaidReminders(remindersOn, planned).then((result) => { if (active) setReminderSync(result); });
    return () => { active = false; };
  }, [snapshot, preview, remindersOn, planned]);

  const setLang = (next: Lang) => { setLangState(next); void saveLang(next); };
  const setRemindersOn = (on: boolean) => { setRemindersState(on); if (!preview) void saveReminders(on); };
  const startPreview = () => { setPreview(true); setSnapshot(sampleSnapshot()); };
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
    hasGuild, signedIn, guildName
  };
}

export type GuildState = ReturnType<typeof useGuild>;
