import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, KeyboardAvoidingView, Linking, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import {
  ApiError, GuildedClient, apiOrigin, discordEventLink, parseHub, parseManage, parseStandings, withMine,
  type CoreBoard, type HubView, type ManageView, type StandingsView, type WishCharacter
} from "./api";
import { formatPr, formatWhen, lootModeLabel, roleLabel, t, type Lang } from "./i18n";
import { pushToken, syncRaidReminders, type ReminderSync } from "./notify";
import { planReminders, soonRaids } from "./reminders";
import { sampleHubBody, sampleManageBody, sampleStandingsBody } from "./sample";
import type { MobileRoute } from "./routes";
import { clearSession, readOrigin, readReminders, readSession, renewSession, saveOrigin, saveReminders, saveSession, type Session } from "./storage";

const colors = { bg: "#0b0c0b", panel: "#151714", line: "#282b25", text: "#f3f0e7", muted: "#aaa99f", gold: "#d5ad57", green: "#9fbd83", ink: "#1b160c" };

type Section = "characters" | "reserves" | "wishlist" | "raids" | "alerts";
const sections: Section[] = ["characters", "reserves", "wishlist", "raids", "alerts"];

interface Snapshot {
  hub: HubView | null;
  manage: ManageView | null;
  standings: StandingsView | null;
  errors: { hub?: string; manage?: string; standings?: string };
}

function sampleSnapshot(): Snapshot {
  return { hub: parseHub(sampleHubBody), manage: parseManage(sampleManageBody), standings: parseStandings(sampleStandingsBody), errors: {} };
}

function shownName(character: { name: string; displayName: string | null }): string {
  return character.displayName || character.name;
}

export function GuildScreen({ defaultOrigin, lang, onLang, route }: { defaultOrigin: string; lang: Lang; onLang: (next: Lang) => void; route: MobileRoute | null }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [preview, setPreview] = useState(false);
  const [originDraft, setOriginDraft] = useState(defaultOrigin);
  const [section, setSection] = useState<Section>("characters");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [remindersOn, setRemindersOn] = useState(false);
  const [reminderSync, setReminderSync] = useState<ReminderSync | null>(null);
  const [remoteOn, setRemoteOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushNotice, setPushNotice] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [clock, setClock] = useState(Date.now());
  const generation = useRef(0);
  const sessionRef = useRef<Session | null>(null);
  const requestInFlight = useRef(false);
  const mounted = useRef(true);
  const chooseLang = onLang;
  const tr = (en: string, fr: string) => lang === "fr" ? fr : en;
  const acceptSession = useCallback((next: Session) => { sessionRef.current = next; setSession(next); setSnapshot(null); setSessionError(null); }, []);


  useEffect(() => {
    let active = true;
    void (async () => {
      mounted.current = true;
      const [stored, reminders, savedOrigin] = await Promise.all([readSession(), readReminders(), readOrigin()]);
      if (!active) return;
      setRemindersOn(reminders);
      if (savedOrigin) setOriginDraft(savedOrigin);
      sessionRef.current = stored;
      setSession(stored);
      setReady(true);
    })();
    return () => { active = false; mounted.current = false; generation.current++; };
  }, []);

  const load = useCallback(async (original: Session) => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    const revision = ++generation.current;
    setLoading(true);
    try {
      const current = await renewSession(original);
      if (!mounted.current || revision !== generation.current || sessionRef.current?.companionCredential !== original.companionCredential) return;
      sessionRef.current = current;
      if (current !== original) setSession(current);
      if (current.personal) { setSessionError(null); return; }
      const client = new GuildedClient(current.apiOrigin, current.companionCredential);
      const [hub, manage, standings] = await Promise.allSettled([client.hub(current.guildDiscordId), client.manage(current.guildDiscordId), client.standings(current.guildDiscordId)]);
      if (!mounted.current || revision !== generation.current || sessionRef.current?.companionCredential !== current.companionCredential) return;
      const errors: Snapshot["errors"] = {};
      if (hub.status === "rejected") errors.hub = hub.reason instanceof Error ? hub.reason.message : t(lang, "loading");
      if (manage.status === "rejected") errors.manage = manage.reason instanceof Error ? manage.reason.message : t(lang, "loading");
      if (standings.status === "rejected") errors.standings = standings.reason instanceof Error ? standings.reason.message : t(lang, "loading");
      if ([hub, manage, standings].some((result) => result.status === "rejected" && result.reason instanceof ApiError && result.reason.status === 401)) throw new ApiError(lang === "fr" ? "Connexion expirée. Reconnectez-vous." : "Your session expired. Please sign in again.", 401);
      setSessionError(null);
      setSnapshot((previous) => ({ hub: hub.status === "fulfilled" ? hub.value : previous?.hub ?? null, manage: manage.status === "fulfilled" ? manage.value : previous?.manage ?? null, standings: standings.status === "fulfilled" ? standings.value : previous?.standings ?? null, errors }));
      void client.deviceStatus(current.guildDiscordId).then((on) => { if (mounted.current && revision === generation.current) setRemoteOn(on); }).catch(() => {});
    } catch (error) {
      if (mounted.current && revision === generation.current) {
        if (error instanceof ApiError && error.status === 401) {
          generation.current++; sessionRef.current = null; setSession(null); setSnapshot(null); setRemoteOn(false);
          void syncRaidReminders(false, []);
          try { await clearSession(); } catch { /* The sign-in screen exposes the failed session. */ }
        }
        setSessionError(error instanceof Error ? error.message : t(lang, "loading"));
      }
    } finally { requestInFlight.current = false; if (mounted.current) setLoading(false); }
  }, [lang]);

  useEffect(() => {
    if (!ready || preview || !session) return;
    void load(session);
  }, [ready, preview, session?.guildDiscordId, load]);

  useEffect(() => {
    const interval = setInterval(() => setClock(Date.now()), 60_000);
    const resume = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      setClock(Date.now());
      const current = sessionRef.current;
      if (current && !preview) void load(current);
    });
    return () => { clearInterval(interval); resume.remove(); };
  }, [load, preview]);

  useEffect(() => {
    if (!route) return;
    if (route.guildDiscordId && session && route.guildDiscordId !== session.guildDiscordId) {
      setSessionError(lang === "fr" ? "Ce lien appartient à une autre guilde. Connectez-vous au bon serveur Discord." : "This link belongs to another guild. Sign in to its Discord server first.");
      return;
    }
    setSection(route.section);
    if (session && !preview) void load(session);
  }, [route, session?.guildDiscordId, lang, load, preview]);

  const raids = snapshot?.standings?.raids;
  const planned = useMemo(() => planReminders(raids ?? [], clock, lang), [raids, clock, lang]);
  const imminent = useMemo(() => soonRaids(raids ?? [], clock), [raids, clock]);
  useEffect(() => {
    if (preview || !session || (!snapshot?.standings && remindersOn && !remoteOn)) return;
    let active = true;
    void syncRaidReminders(remindersOn && !remoteOn, planned, session.guildDiscordId).then((result) => { if (active) setReminderSync(result); });
    return () => { active = false; };
  }, [preview, session?.guildDiscordId, remindersOn, remoteOn, planned, snapshot?.standings]);

  const togglePush = async () => {
    if (!session || preview || pushBusy) return;
    setPushBusy(true); setPushNotice(null);
    try {
      const token = remoteOn ? undefined : await pushToken();
      await new GuildedClient(session.apiOrigin, session.companionCredential).device(session.guildDiscordId, !remoteOn, lang, token);
      if (sessionRef.current?.companionCredential !== session.companionCredential) return;
      setRemoteOn(!remoteOn);
    } catch (error) { setPushNotice(error instanceof Error ? error.message : t(lang, "alertsDenied")); }
    finally { setPushBusy(false); }
  };

  const leave = async () => {
    const old = sessionRef.current;
    generation.current++;
    setPreview(false); setSession(null); sessionRef.current = null; setSnapshot(null); setRemoteOn(false); setPushNotice(null); setSessionError(null);
    if (!preview) {
      void syncRaidReminders(false, []);
      const persisted = await readSession();
      try { await clearSession(); }
      catch { setSessionError(lang === "fr" ? "Impossible d’effacer la connexion enregistrée. Réessayez avant de quitter." : "The saved session could not be erased. Retry before closing the app."); }
      if (old) void new GuildedClient(old.apiOrigin, old.companionCredential).logout(old.guildDiscordId);
      if (persisted?.pendingCredential) void new GuildedClient(persisted.apiOrigin, persisted.pendingCredential).logout(persisted.guildDiscordId);
    } else { void readReminders().then(setRemindersOn); }
  };

  if (!ready) return <View style={styles.fill}><ActivityIndicator color={colors.gold} style={{ marginTop: 32 }} /></View>;
  if (!session && !preview) {
    return <View style={styles.fill}>{sessionError ? <Text accessibilityRole="alert" style={styles.error}>{sessionError}</Text> : null}<SignIn lang={lang} setLang={chooseLang} originDraft={originDraft} setOriginDraft={setOriginDraft} defaultOrigin={defaultOrigin} onSession={acceptSession} onPreview={() => { setPreview(true); setSnapshot(sampleSnapshot()); setSection("characters"); }} /></View>;
  }
  if (session?.personal && !preview) {
    return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => { if (sessionRef.current) void load(sessionRef.current); }} tintColor={colors.gold} />}>
      {sessionError ? <Text accessibilityRole="alert" style={styles.error}>{sessionError}</Text> : null}
      <Language lang={lang} setLang={chooseLang} />
      <Text style={styles.kicker}>{t(lang, "guildKicker")}</Text>
      <Text accessibilityRole="header" style={styles.title}>{t(lang, "personalTitle")}</Text>
      <Text style={styles.intro}>{t(lang, "personalBody")}</Text>
      <Pressable accessibilityRole="button" onPress={() => void leave()} style={styles.secondary}><Text style={styles.secondaryText}>{t(lang, "signOut")}</Text></Pressable>
    </ScrollView>;
  }

  const hub = snapshot?.hub ?? null;
  const manage = snapshot?.manage ?? null;
  const standings = snapshot?.standings ?? null;
  const guildName = hub?.guildName || manage?.guildName || standings?.guildName || session?.guildName || "Guild";

  return <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={loading} onRefresh={() => { if (!preview && sessionRef.current) void load(sessionRef.current); }} tintColor={colors.gold} />}>
      {preview ? <Text style={styles.banner}>{t(lang, "sampleBanner")}</Text> : null}
      <Language lang={lang} setLang={chooseLang} />
      {sessionError ? <Text accessibilityRole="alert" style={styles.error}>{sessionError}</Text> : null}
      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>{t(lang, "guildKicker")}</Text>
          <Text accessibilityRole="header" style={styles.title}>{guildName}</Text>
          <Text style={styles.muted}>{[hub?.edition || standings?.edition, hub?.battleTag].filter(Boolean).join(" · ")}</Text>
        </View>
        <Pressable accessibilityRole="button" onPress={() => { if (!preview && sessionRef.current) void load(sessionRef.current); }} disabled={loading || preview} accessibilityState={{ disabled: loading || preview, busy: loading }} style={styles.textButton}><Text style={styles.textButtonLabel}>{t(lang, "refresh")}</Text></Pressable>
      </View>
      <View style={styles.chips}>
        {sections.map((name) => <Pressable key={name} accessibilityRole="tab" accessibilityState={{ selected: section === name }} onPress={() => setSection(name)} style={[styles.chip, section === name && styles.chipOn]}>
          <Text style={[styles.chipText, section === name && styles.chipTextOn]}>{t(lang, name)}</Text>
        </Pressable>)}
      </View>
      {snapshot && Object.keys(snapshot.errors).length ? <View style={styles.hero}><Text accessibilityLiveRegion="polite" style={styles.error}>{tr("Some data could not refresh. Last loaded data stays visible.", "Certaines données n’ont pas pu être actualisées. Les dernières données restent visibles.")}</Text>{Object.entries(snapshot.errors).map(([key, message]) => <Text key={key} style={styles.muted}>{message}</Text>)}</View> : null}
      {loading && !snapshot ? <ActivityIndicator color={colors.gold} style={{ marginVertical: 24 }} /> : null}
      {section === "characters" ? <Characters lang={lang} hub={hub} error={hub ? undefined : snapshot?.errors.hub} /> : null}
      {section === "reserves" ? <Reserves lang={lang} hub={hub} error={hub ? undefined : snapshot?.errors.hub} /> : null}
      {section === "wishlist" ? <Wishlist lang={lang} preview={preview} session={session} manage={manage} error={manage ? undefined : snapshot?.errors.manage} onChange={(next) => setSnapshot((current) => current && (preview || sessionRef.current?.companionCredential === session?.companionCredential) ? { ...current, manage: next } : current)} /> : null}
      {section === "raids" ? <Raids focusRaidId={route?.guildDiscordId && route.guildDiscordId !== session?.guildDiscordId ? undefined : route?.raidId} lang={lang} hub={hub} manage={manage} standings={standings} error={snapshot?.errors.standings} /> : null}
      {section === "alerts" ? <View style={styles.hero}>
        <Pressable accessibilityRole="switch" accessibilityState={{ checked: remoteOn, disabled: preview || pushBusy }} disabled={preview || pushBusy} onPress={() => void togglePush()} style={styles.textButton}>
          <Text accessibilityRole="header" style={styles.heroTitle}>{tr("Raid updates and reminders", "Mises à jour et rappels de raids")}</Text><Text style={styles.body}>{remoteOn ? tr("Push alerts on", "Alertes push activées") : tr("Push alerts off", "Alertes push désactivées")}</Text>
        </Pressable><Text style={styles.muted}>{tr("Opt in to raid changes, cancellations and reminders while the app is closed. Push alerts replace device reminders to avoid duplicates.", "Recevez les changements, annulations et rappels même si l’application est fermée. Les alertes push remplacent les rappels locaux pour éviter les doublons.")}</Text>
        {pushNotice ? <Text accessibilityRole="alert" style={styles.error}>{pushNotice}</Text> : null}
      </View> : null}
      {section === "alerts" && !remoteOn ? <Alerts lang={lang} preview={preview} remindersOn={remindersOn} setRemindersOn={(on) => { setRemindersOn(on); if (!preview) void saveReminders(on); }} planned={planned} imminent={imminent} sync={reminderSync} /> : null}
      {!preview && session ? <View style={styles.hero}><Text accessibilityRole="header" style={styles.heroTitle}>{tr("Guild tools on the web", "Outils de guilde sur le site")}</Text>{[
        [tr("Raid teams and rosters", "Équipes de raid et rosters"), "/me/teams"],
        [tr("Guild roster and character history", "Effectif et historique des personnages"), "/me/roster"],
        [tr("Raid plans", "Plans de raid"), "/me/raid-plans"],
        [tr("Battle.net and character links", "Battle.net et personnages liés"), "/me/battlenet"],
        [tr("Recruitment", "Recrutement"), "/recruitment/"]
      ].map(([label, path]) => <Pressable key={label} accessibilityRole="link" style={styles.textButton} onPress={() => void Linking.openURL(`${session.apiOrigin}${path}?guild=${encodeURIComponent(session.guildDiscordId)}&edition=${encodeURIComponent(session.gameEdition ?? hub?.edition ?? "forever")}&lang=${lang}`).catch(() => setSessionError(tr("The browser could not open. Please retry.", "Le navigateur n’a pas pu s’ouvrir. Réessayez.")))}><Text style={styles.textButtonLabel}>{label} ↗</Text></Pressable>)}<Text style={styles.muted}>{tr("The website may ask you to sign in with Discord.", "Le site peut vous demander de vous connecter avec Discord.")}</Text></View> : null}
      {(manage?.raidLeader || hub?.raidLeader) ? <Text style={styles.note}>{t(lang, "leaderNote")}</Text> : null}
      <Pressable accessibilityRole="button" onPress={() => void leave()} style={styles.secondary}><Text style={styles.secondaryText}>{preview ? t(lang, "closeSample") : t(lang, "signOut")}</Text></Pressable>
    </ScrollView>
  </KeyboardAvoidingView>;
}

function Language({ lang, setLang }: { lang: Lang; setLang: (lang: Lang) => void }) {
  return <View style={styles.langRow}>
    {(["en", "fr"] as const).map((code) => <Pressable key={code} accessibilityRole="button" accessibilityLabel={code === "en" ? "English" : "Français"} accessibilityState={{ selected: lang === code }} onPress={() => setLang(code)} style={[styles.lang, lang === code && styles.langOn]}><Text style={[styles.langText, lang === code && styles.langTextOn]}>{code.toUpperCase()}</Text></Pressable>)}
  </View>;
}

function SignIn({ lang, setLang, originDraft, setOriginDraft, defaultOrigin, onSession, onPreview }: {
  lang: Lang; setLang: (lang: Lang) => void; originDraft: string; setOriginDraft: (value: string) => void; defaultOrigin: string;
  onSession: (session: Session) => void; onPreview: () => void;
}) {
  const [pending, setPending] = useState<{ requestId: string; confirm: string; expiresAt: string; url: string; origin: string } | null>(null);
  const [code, setCode] = useState("");
  const [serverId, setServerId] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pending) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (stopped) return;
      if (Date.parse(pending.expiresAt) <= Date.now()) {
        setPending(null);
        setError(t(lang, "expired"));
        return;
      }
      try {
        const answer = await new GuildedClient(pending.origin).pollSignIn(pending.requestId);
        if (stopped) return;
        if (answer === "pending") { timer = setTimeout(() => void tick(), 2000); return; }
        const session = { ...answer, apiOrigin: pending.origin, renewedAt: Date.now() };
        try { await saveSession(session); }
        catch { void new GuildedClient(pending.origin, answer.companionCredential).logout(answer.guildDiscordId); throw new Error(lang === "fr" ? "Impossible d’enregistrer la connexion sur ce téléphone." : "This phone could not securely save the session."); }
        if (stopped) { await clearSession(); void new GuildedClient(pending.origin, answer.companionCredential).logout(answer.guildDiscordId); return; }
        setPending(null);
        onSession(session);
      } catch (caught) {
        if (stopped) return;
        setError(caught instanceof Error ? caught.message : t(lang, "signInTitle"));
        if (caught instanceof ApiError && (caught.status === 0 || caught.status === 429 || caught.status >= 500)) {
          timer = setTimeout(() => void tick(), 5000);
        } else setPending(null);
      }
    };
    timer = setTimeout(() => void tick(), 1500);
    return () => { stopped = true; clearTimeout(timer); };
  }, [pending, lang, onSession]);

  const originOrError = (): string | null => {
    try { return apiOrigin(originDraft || defaultOrigin); }
    catch (caught) { setError(caught instanceof Error ? caught.message : t(lang, "advanced")); return null; }
  };

  const start = async () => {
    const origin = originOrError();
    if (!origin || busy) return;
    setBusy(true);
    setError(null);
    try {
      await saveOrigin(origin);
      const started = await new GuildedClient(origin).startSignIn();
      setPending({ ...started, origin });
      await Linking.openURL(started.url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t(lang, "signInTitle"));
    } finally { setBusy(false); }
  };

  const pair = async () => {
    const origin = originOrError();
    if (!origin || !code.trim() || busy || pending) return;
    setBusy(true);
    setError(null);
    try {
      await saveOrigin(origin);
      const grant = await new GuildedClient(origin).pair(code, serverId);
      const session = { ...grant, apiOrigin: origin, renewedAt: Date.now() };
      try { await saveSession(session); }
      catch { void new GuildedClient(origin, grant.companionCredential).logout(grant.guildDiscordId); throw new Error(lang === "fr" ? "Impossible d’enregistrer la connexion sur ce téléphone." : "This phone could not securely save the session."); }
      onSession(session);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t(lang, "connect"));
    } finally { setBusy(false); }
  };

  return <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Language lang={lang} setLang={setLang} />
    <Text style={styles.kicker}>{t(lang, "guildKicker")}</Text>
    <Text accessibilityRole="header" style={styles.title}>{t(lang, "signInTitle")}</Text>
    <Text style={styles.intro}>{t(lang, "signInIntro")}</Text>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {pending ? <View style={styles.hero}>
      <Text selectable style={styles.code}>{pending.confirm}</Text>
      <Text style={styles.muted}>{t(lang, "codeHelp")}</Text>
      <Text style={styles.muted}>{t(lang, "waiting")}</Text>
      <Pressable accessibilityRole="button" onPress={() => void Linking.openURL(pending.url).catch(() => setError(lang === "fr" ? "Impossible d’ouvrir le navigateur." : "The browser could not open."))} style={styles.primary}><Text style={styles.primaryText}>{t(lang, "openPage")}</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => setPending(null)} style={styles.secondary}><Text style={styles.secondaryText}>{t(lang, "cancel")}</Text></Pressable>
    </View> : <Pressable accessibilityRole="button" onPress={() => void start()} disabled={busy} style={styles.primary}><Text style={styles.primaryText}>{t(lang, "signInButton")}</Text></Pressable>}
    <Text style={styles.label}>{t(lang, "pairingLabel")}</Text>
    <TextInput accessibilityLabel={t(lang, "pairingPlaceholder")} maxLength={100} editable={!busy && !pending} value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} placeholder={t(lang, "pairingPlaceholder")} placeholderTextColor={colors.muted} style={styles.input} />
    <TextInput accessibilityLabel={t(lang, "serverIdPlaceholder")} maxLength={30} editable={!busy && !pending} value={serverId} onChangeText={setServerId} autoCorrect={false} placeholder={t(lang, "serverIdPlaceholder")} placeholderTextColor={colors.muted} style={styles.input} keyboardType="number-pad" />
    <Pressable accessibilityRole="button" onPress={() => void pair()} disabled={busy || !!pending || !code.trim()} style={styles.secondary}><Text style={styles.secondaryText}>{t(lang, "connect")}</Text></Pressable>
    <Pressable accessibilityRole="button" onPress={() => setAdvanced((open) => !open)} style={styles.textButton}><Text style={styles.textButtonLabel}>{t(lang, "advanced")}</Text></Pressable>
    {advanced ? <>
      <Text style={styles.muted}>{t(lang, "serverAddressHelp")}</Text>
      <TextInput accessibilityLabel={t(lang, "advanced")} maxLength={300} editable={!busy && !pending} value={originDraft} onChangeText={setOriginDraft} autoCapitalize="none" autoCorrect={false} placeholder={defaultOrigin} placeholderTextColor={colors.muted} style={styles.input} />
    </> : null}
    <View style={styles.hero}>
      <Text accessibilityRole="header" style={styles.heroTitle}>{t(lang, "preview")}</Text>
      <Text style={styles.muted}>{t(lang, "previewNote")}</Text>
      <Pressable accessibilityRole="button" disabled={busy || !!pending} onPress={onPreview} style={styles.secondary}><Text style={styles.secondaryText}>{t(lang, "preview")}</Text></Pressable>
    </View>
  </ScrollView></KeyboardAvoidingView>;
}

function Characters({ lang, hub, error }: { lang: Lang; hub: HubView | null; error?: string }) {
  const [limit, setLimit] = useState(20);
  if (error) return <Text accessibilityRole="alert" style={styles.error}>{error}</Text>;
  if (!hub) return null;
  return <>
    {hub.battleNet !== null ? <Text style={styles.muted}>{t(lang, "battleNet")}: {hub.battleNet ? t(lang, "linked") : t(lang, "notLinked")}{hub.battleTag ? ` · ${hub.battleTag}` : ""}</Text> : null}
    {hub.characters.length === 0 ? <Text style={styles.intro}>{t(lang, "noCharacters")}</Text> : hub.characters.slice(0, limit).map((character) => <View key={character.id} style={styles.hero}>
      <View style={styles.titleRow}>
        <Text accessibilityRole="header" style={styles.heroTitle}>{shownName(character)}</Text>
        <Text style={styles.pill}>{character.isMain ? t(lang, "main") : character.className}</Text>
      </View>
      <Text style={styles.muted}>{[character.spec, character.className].filter(Boolean).join(" ")}{character.level ? ` · ${t(lang, "level")} ${character.level}` : ""}</Text>
      <Text style={styles.muted}>{[character.realm, character.edition].filter(Boolean).join(" · ")}</Text>
      <Text style={styles.body}>{t(lang, "rank")}: {character.rank ?? t(lang, "noRank")}</Text>
      {character.guildName ? <Text style={styles.muted}>{character.guildName}{character.current ? "" : ` · ${t(lang, "otherServer")}`}</Text> : null}
      {character.cores.map((core) => <Text key={`${character.id}-${core.name}-${core.role}`} style={styles.body}>{core.name} · {roleLabel(core.role, lang)}{core.bench ? ` · ${t(lang, "bench")}` : ""}{core.trial ? ` · ${t(lang, "trial")}` : ""}{core.backup ? ` · ${t(lang, "backup")}` : ""}</Text>)}
    </View>)}
    <More lang={lang} shown={limit} total={hub.characters.length} onMore={() => setLimit((value) => value + 20)} />
  </>;
}

function More({ lang, shown, total, onMore }: { lang: Lang; shown: number; total: number; onMore: () => void }) {
  if (shown >= total) return null;
  return <Pressable accessibilityRole="button" onPress={onMore} style={styles.secondary}><Text style={styles.secondaryText}>{lang === "fr" ? `Voir plus (${Math.min(shown, total)}/${total})` : `Show more (${Math.min(shown, total)}/${total})`}</Text></Pressable>;
}

function Reserves({ lang, hub, error }: { lang: Lang; hub: HubView | null; error?: string }) {
  const [limit, setLimit] = useState(20);
  if (error) return <Text accessibilityRole="alert" style={styles.error}>{error}</Text>;
  if (!hub) return null;
  const reserves = hub.reserves;
  const items = [...reserves.items].sort((a, b) => Number(b.mine) - Number(a.mine) || a.itemName.localeCompare(b.itemName));
  const soft = reserves.cores.filter((core) => core.lootMode === "RESERVE");
  return <>
    <View style={styles.hero}>
      <Text style={styles.label}>{t(lang, "whereToReserve")}</Text>
      <Text style={styles.muted}>{t(lang, "reservesIntro")}</Text>
      {soft.length ? <Text style={styles.body}>{t(lang, "coresUsing")}: {soft.map((core) => `${core.name} (${t(lang, "perPlayer", { count: core.reservesPerPlayer ?? 0 })})`).join(", ")}</Text> : <Text style={styles.muted}>{t(lang, "noSoftReserveCores")}</Text>}
    </View>
    {!reserves.list?.active ? <Text style={styles.intro}>{t(lang, "noReserveList")}</Text> : <View style={styles.hero}>
      <View style={styles.titleRow}>
        <Text accessibilityRole="header" style={styles.heroTitle}>{reserves.list.title || t(lang, "reserves")}</Text>
        <Text style={styles.pill}>{reserves.list.open ? t(lang, "reserveOpen") : t(lang, "reserveLocked")}</Text>
      </View>
      <Text style={styles.body}>{t(lang, "yourReserves")}: {reserves.mineCount}</Text>
      {reserves.items.length === 0 ? <Text style={styles.muted}>{t(lang, "nobodyReserved")}</Text> : items.slice(0, limit).map((item) => <View key={item.itemName} style={styles.row}>
        <Text style={[styles.body, { flex: 1 }]}>{item.mine ? "★ " : ""}{item.itemName}</Text>
        <Text style={[styles.muted, { flexShrink: 1, width: "100%" }]}>{item.characters.join(", ")}</Text>
      </View>)}
      <More lang={lang} shown={limit} total={items.length} onMore={() => setLimit((value) => value + 20)} />
    </View>}
  </>;
}

function Wishlist({ lang, preview, session, manage, error, onChange }: {
  lang: Lang; preview: boolean; session: Session | null; manage: ManageView | null; error?: string;
  onChange: (next: ManageView) => void;
}) {
  const [characterId, setCharacterId] = useState<string | null>(null);
  const [item, setItem] = useState("");
  const [priority, setPriority] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mutation = useRef(false);
  const activeId = manage?.characters.some((entry) => entry.id === characterId) ? characterId : manage?.characters[0]?.id ?? null;
  const selected = manage?.characters.find((character) => character.id === activeId) ?? null;

  const applyLocal = (character: WishCharacter, nextList: WishCharacter["wishlist"]) => {
    if (!manage) return;
    onChange({ ...manage, characters: manage.characters.map((entry) => entry.id === character.id ? { ...entry, wishlist: nextList } : entry) });
  };

  // The server accepted the change; a failed refetch must not read as a failed save.
  const refreshAfterSave = async (client: GuildedClient, guildId: string) => {
    try { onChange(await client.manage(guildId)); }
    catch { setNotice(lang === "fr" ? "Modification enregistrée, mais la liste n’a pas pu être actualisée. Tirez pour actualiser." : "Saved, but the list could not refresh. Pull down to refresh."); }
  };
  // A timeout or dropped connection leaves the outcome unknown: re-read before reporting failure.
  const settleUnknown = async (client: GuildedClient, caught: unknown, guildId: string) => {
    if (!(caught instanceof ApiError) || caught.status !== 0) return;
    try { onChange(await client.manage(guildId)); setNotice(lang === "fr" ? "Connexion interrompue. La liste a été actualisée : vérifiez le résultat." : "The connection dropped. The list was refreshed: check the result."); }
    catch { /* the original error is shown */ }
  };

  const add = async () => {
    if (!selected || !item.trim() || mutation.current) return;
    mutation.current = true;
    const name = item.trim();
    setBusy(true);
    setNotice(null);
    try {
      if (preview || !session) {
        const without = selected.wishlist.filter((wish) => wish.itemName.toLowerCase() !== name.toLowerCase());
        applyLocal(selected, [...without, { itemName: name, priority }].sort((a, b) => a.priority - b.priority || a.itemName.localeCompare(b.itemName)));
      } else {
        const client = new GuildedClient(session.apiOrigin, session.companionCredential);
        try {
          const message = await client.setWishlist(session.guildDiscordId, selected.id, name, priority);
          setNotice(message);
        } catch (caught) { await settleUnknown(client, caught, session.guildDiscordId); throw caught; }
        setItem("");
        await refreshAfterSave(client, session.guildDiscordId);
      }
      setItem("");
    } catch (caught) {
      if (!(caught instanceof ApiError && caught.status === 0)) setNotice(caught instanceof Error ? caught.message : t(lang, "add"));
    } finally { mutation.current = false; setBusy(false); }
  };

  const remove = async (wish: string) => {
    if (!selected || mutation.current) return;
    mutation.current = true; setBusy(true);
    setNotice(null);
    try {
      if (preview || !session) applyLocal(selected, selected.wishlist.filter((entry) => entry.itemName !== wish));
      else if (session) {
        const client = new GuildedClient(session.apiOrigin, session.companionCredential);
        try {
          const message = await client.removeWishlist(session.guildDiscordId, selected.id, wish);
          setNotice(message);
        } catch (caught) { await settleUnknown(client, caught, session.guildDiscordId); throw caught; }
        await refreshAfterSave(client, session.guildDiscordId);
      }
    } catch (caught) {
      if (!(caught instanceof ApiError && caught.status === 0)) setNotice(caught instanceof Error ? caught.message : t(lang, "remove"));
    } finally { mutation.current = false; setBusy(false); }
  };

  if (error) return <Text accessibilityRole="alert" style={styles.error}>{error}</Text>;
  if (!manage) return null;
  return <>
    <Text style={styles.intro}>{t(lang, "wishlistIntro")}</Text>
    {manage.characters.length === 0 ? <Text style={styles.muted}>{t(lang, "noCharacters")}</Text> : null}
    <View style={styles.chips}>
      {manage.characters.map((character) => <Pressable key={character.id} accessibilityRole="button" accessibilityState={{ selected: selected?.id === character.id, disabled: busy }} disabled={busy} onPress={() => setCharacterId(character.id)} style={[styles.chip, selected?.id === character.id && styles.chipOn]}>
        <Text style={[styles.chipText, selected?.id === character.id && styles.chipTextOn]}>{shownName(character)}</Text>
      </Pressable>)}
    </View>
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.muted}>{notice}</Text> : null}
    {selected && selected.wishlist.length === 0 ? <Text style={styles.muted}>{t(lang, "noWishes")}</Text> : selected?.wishlist.map((wish) => <View key={wish.itemName} style={styles.row}>
      <Text style={[styles.body, { flex: 1 }]}>{wish.priority}. {wish.itemName}</Text>
      <Pressable accessibilityRole="button" disabled={busy} accessibilityLabel={`${t(lang, "remove")} ${wish.itemName}`} style={styles.textButton} onPress={() => void remove(wish.itemName)}><Text style={styles.textButtonLabel}>{t(lang, "remove")}</Text></Pressable>
    </View>)}
    {selected ? <View style={styles.hero}>
      <TextInput accessibilityLabel={t(lang, "itemPlaceholder")} maxLength={100} editable={!busy} value={item} onChangeText={setItem} placeholder={t(lang, "itemPlaceholder")} placeholderTextColor={colors.muted} style={styles.input} />
      <Text style={styles.label}>{t(lang, "priority")}</Text>
      <View style={styles.langRow}>
        {[1, 2, 3].map((value) => <Pressable key={value} accessibilityRole="button" accessibilityLabel={`${t(lang, "priority")} ${value}`} accessibilityState={{ selected: priority === value, disabled: busy }} disabled={busy} onPress={() => setPriority(value)} style={[styles.lang, priority === value && styles.langOn]}><Text style={[styles.langText, priority === value && styles.langTextOn]}>{value}</Text></Pressable>)}
      </View>
      <Pressable accessibilityRole="button" onPress={() => void add()} disabled={busy || !item.trim()} style={styles.primary}><Text style={styles.primaryText}>{t(lang, "add")}</Text></Pressable>
    </View> : null}
  </>;
}

function Raids({ lang, hub, manage, standings, error, focusRaidId }: { focusRaidId?: string; lang: Lang; hub: HubView | null; manage: ManageView | null; standings: StandingsView | null; error?: string }) {
  const [limit, setLimit] = useState(20);
  const [raidLimit, setRaidLimit] = useState(10);
  const [linkError, setLinkError] = useState(false);
  if (error && !standings) return <Text accessibilityRole="alert" style={styles.error}>{error}</Text>;
  if (!standings) return error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null;
  const mine = withMine(standings.standings, (hub?.characters ?? []).filter((character) => character.current));
  const rows = [...mine.filter((row) => row.mine), ...mine.filter((row) => !row.mine)].slice(0, limit);
  const next = standings.nextRaid;
  const raids = [...standings.raids].sort((a, b) => Number(b.id === focusRaidId) - Number(a.id === focusRaidId) || Date.parse(a.at) - Date.parse(b.at));
  return <>
    <Text style={styles.intro}>{t(lang, "raidIntro")}</Text>
    {focusRaidId && !raids.some((raid) => raid.id === focusRaidId) ? <Text accessibilityLiveRegion="polite" style={styles.note}>{lang === "fr" ? "Ce raid a été annulé, est passé ou ne figure plus dans les prochaines semaines. Actualisez pour vérifier les changements." : "This raid was cancelled, has passed or is outside the upcoming calendar. Refresh to check the latest changes."}</Text> : null}
    <View style={styles.hero}>
      <Text style={styles.label}>{t(lang, "nextRaid")}</Text>
      {!next ? <Text style={styles.muted}>{t(lang, "noNextRaid")}</Text> : <>
        <Text accessibilityRole="header" style={styles.heroTitle}>{next.title}</Text>
        <Text style={styles.muted}>{formatWhen(next.scheduledAt, lang)}{next.core ? ` · ${next.core}` : ""}</Text>
        <Text style={styles.body}>{t(lang, "signedUp")}</Text>
        {next.players.map((player) => <Text key={`${player.name}-${player.role}`} style={styles.muted}>{player.name} · {roleLabel(player.role, lang)}</Text>)}
        {next.maybe.length ? <Text style={styles.muted}>{t(lang, "maybe")}: {next.maybe.join(", ")}</Text> : null}
      </>}
    </View>
    <Text style={styles.label}>{t(lang, "upcoming")}</Text>
    {standings.raids.length === 0 ? <Text style={styles.muted}>{t(lang, "noUpcoming")}</Text> : raids.slice(0, raidLimit).map((raid) => {
      const link = discordEventLink(raid.note);
      return <View key={raid.id} style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.body, raid.id === focusRaidId && { color: colors.gold, fontWeight: "700" }]}>{raid.id === focusRaidId ? "→ " : ""}{raid.title}</Text>
          <Text style={styles.muted}>{formatWhen(raid.at, lang)}{raid.core ? ` · ${raid.core}` : ""}</Text>
        </View>
        {link ? <Pressable accessibilityRole="button" style={styles.textButton} onPress={() => void Linking.openURL(link).catch(() => setLinkError(true))}><Text style={styles.textButtonLabel}>{t(lang, "openDiscord")}</Text></Pressable> : null}
      </View>;
    })}
    <More lang={lang} shown={raidLimit} total={standings.raids.length} onMore={() => setRaidLimit((value) => value + 10)} />
    {linkError ? <Text accessibilityRole="alert" style={styles.error}>{lang === "fr" ? "Impossible d’ouvrir Discord. Réessayez." : "Discord could not open. Please retry."}</Text> : null}
    <Text style={styles.label}>{t(lang, "standings")}</Text>
    {rows.length === 0 ? <Text style={styles.muted}>{t(lang, "noStandings")}</Text> : rows.map((row) => <View key={row.character} style={styles.row}>
      <Text style={[styles.body, { flex: 1 }]}>{row.mine ? `${t(lang, "you")} · ` : ""}{row.character}</Text>
      <Text style={styles.muted}>{row.ep} / {row.gp} · {formatPr(row.pr)}</Text>
    </View>)}
    <More lang={lang} shown={limit} total={mine.length} onMore={() => setLimit((value) => value + 20)} />
    {(manage?.cores ?? []).filter((core) => core.rows.length > 0).map((core) => <CoreList key={core.id} lang={lang} core={core} />)}
  </>;
}

function CoreList({ lang, core }: { lang: Lang; core: CoreBoard }) {
  const [limit, setLimit] = useState(12);
  const rows = [...core.rows].sort((a, b) => Number(b.me) - Number(a.me) || a.rank - b.rank);
  return <View style={styles.hero}>
    <Text accessibilityRole="header" style={styles.heroTitle}>{core.name}</Text>
    <Text style={styles.muted}>{lootModeLabel(core.lootMode, lang)}</Text>
    {rows.slice(0, limit).map((row) => <View key={`${core.id}-${row.name}`} style={styles.row}>
      <Text style={[styles.body, { flex: 1 }]}>{row.rank}. {row.me ? `${t(lang, "you")} · ` : ""}{row.name}</Text>
      <Text style={styles.muted}>{formatPr(row.pr)}</Text>
    </View>)}
    <More lang={lang} shown={limit} total={rows.length} onMore={() => setLimit((value) => value + 12)} />
  </View>;
}

function Alerts({ lang, preview, remindersOn, setRemindersOn, planned, imminent, sync }: {
  lang: Lang; preview: boolean; remindersOn: boolean; setRemindersOn: (on: boolean) => void;
  planned: ReturnType<typeof planReminders>; imminent: { id: string; title: string; at: string }[]; sync: ReminderSync | null;
}) {
  return <>
    <Text style={styles.intro}>{t(lang, "alertsIntro")}</Text>
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: remindersOn }} onPress={() => setRemindersOn(!remindersOn)} style={styles.hero}>
      <Text accessibilityRole="header" style={styles.heroTitle}>{t(lang, "remindMe")}</Text>
      <Text style={styles.body}>{remindersOn ? t(lang, "on") : t(lang, "off")}</Text>
    </Pressable>
    {preview ? <Text style={styles.muted}>{t(lang, "alertsWeb")}</Text> : null}
    {!preview && sync?.error ? <Text accessibilityRole="alert" style={styles.error}>{sync.error}</Text> : null}
    {!preview && sync && !sync.supported ? <Text style={styles.muted}>{t(lang, "alertsWeb")}</Text> : null}
    {!preview && sync && sync.supported && !sync.granted ? <Text accessibilityRole="alert" style={styles.error}>{t(lang, "alertsDenied")}</Text> : null}
    {!preview && sync?.granted && remindersOn ? <Text accessibilityLiveRegion="polite" style={styles.body}>{lang === "fr" ? `${sync.scheduled} rappel(s) planifié(s)` : `${sync.scheduled} reminder(s) scheduled`}</Text> : null}
    {!remindersOn ? <Text style={styles.muted}>{lang === "fr" ? "Rappels désactivés. Les horaires ci-dessous sont un aperçu." : "Reminders are off. The times below are a preview."}</Text> : null}
    {planned.length === 0 ? <Text style={styles.muted}>{t(lang, "noReminders")}</Text> : planned.map((reminder) => <View key={reminder.id} style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.body}>{reminder.title}</Text>
        <Text style={styles.muted}>{formatWhen(reminder.fireAt, lang)} · {reminder.body}</Text>
      </View>
    </View>)}
    {imminent.length ? <Text style={styles.label}>{t(lang, "startsSoon")}</Text> : null}
    {imminent.map((raid) => <Text key={raid.id} style={styles.muted}>{raid.title} · {formatWhen(raid.at, lang)}</Text>)}
  </>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: 24, paddingBottom: 36 },
  kicker: { color: colors.gold, fontSize: 10, letterSpacing: 2, fontWeight: "700", marginTop: 8 },
  title: { color: colors.text, fontSize: 32, lineHeight: 36, fontWeight: "700", marginTop: 8, letterSpacing: -0.8 },
  titleRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  intro: { color: colors.muted, fontSize: 15, lineHeight: 22, marginTop: 10, marginBottom: 8 },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 20, marginTop: 4 },
  body: { color: colors.text, fontSize: 14, lineHeight: 20, marginTop: 4 },
  error: { color: "#e7b4a8", fontSize: 14, lineHeight: 20, marginTop: 12 },
  hero: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 16, marginTop: 16 },
  heroTitle: { color: colors.text, fontSize: 18, fontWeight: "700", flexShrink: 1 },
  label: { color: colors.gold, fontSize: 10, letterSpacing: 1.4, fontWeight: "700", marginTop: 18 },
  code: { color: colors.gold, fontSize: 32, fontWeight: "700", letterSpacing: 3, marginBottom: 8 },
  banner: { color: colors.ink, backgroundColor: colors.gold, alignSelf: "flex-start", overflow: "hidden", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, fontSize: 12, fontWeight: "700" },
  primary: { backgroundColor: colors.gold, borderRadius: 8, minHeight: 48, alignItems: "center", justifyContent: "center", marginTop: 16, paddingHorizontal: 16 },
  primaryText: { color: colors.ink, fontWeight: "700", fontSize: 15 },
  secondary: { borderWidth: 1, borderColor: colors.line, borderRadius: 8, minHeight: 48, alignItems: "center", justifyContent: "center", marginTop: 12, paddingHorizontal: 16 },
  secondaryText: { color: colors.text, fontWeight: "600", fontSize: 15 },
  textButton: { minHeight: 44, justifyContent: "center" },
  textButtonLabel: { color: colors.gold, fontSize: 13, fontWeight: "700" },
  input: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bg, color: colors.text, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 12, fontSize: 16, marginTop: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingVertical: 12 },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 10, minHeight: 44, justifyContent: "center" },
  chipOn: { borderColor: colors.gold, backgroundColor: "#2a2416" },
  chipText: { color: colors.muted, fontSize: 13 },
  chipTextOn: { color: colors.gold, fontWeight: "700" },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12, borderTopWidth: 1, borderColor: colors.line, paddingVertical: 12 },
  pill: { color: colors.gold, borderWidth: 1, borderColor: "#3a3424", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, fontSize: 11, overflow: "hidden" },
  note: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 18 },
  langRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  lang: { minWidth: 44, minHeight: 44, borderRadius: 8, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  langOn: { borderColor: colors.gold },
  langText: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  langTextOn: { color: colors.gold }
});
