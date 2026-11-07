import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import {
  ApiError, GuildedClient, apiOrigin, discordEventLink, parseHub, parseManage, parseStandings, withMine,
  type CoreBoard, type HubView, type ManageView, type StandingsView, type WishCharacter
} from "./api";
import { AlbumScreen } from "./AlbumScreen";
import { formatPr, formatWhen, lootModeLabel, roleLabel, t, type Lang } from "./i18n";
import { syncRaidReminders, type ReminderSync } from "./notify";
import { planReminders, soonRaids } from "./reminders";
import { sampleHubBody, sampleManageBody, sampleStandingsBody } from "./sample";
import { clearSession, readLang, readOrigin, readReminders, readSession, saveLang, saveOrigin, saveReminders, saveSession, type Session } from "./storage";

const colors = { bg: "#0b0c0b", panel: "#151714", line: "#282b25", text: "#f3f0e7", muted: "#aaa99f", gold: "#d5ad57", green: "#9fbd83", ink: "#1b160c" };

type Section = "characters" | "reserves" | "wishlist" | "raids" | "album" | "alerts";
const sections: Section[] = ["characters", "reserves", "wishlist", "raids", "album", "alerts"];

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

export function GuildScreen({ defaultOrigin }: { defaultOrigin: string }) {
  const [lang, setLang] = useState<Lang>("en");
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [preview, setPreview] = useState(false);
  const [originDraft, setOriginDraft] = useState(defaultOrigin);
  const [section, setSection] = useState<Section>("characters");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [remindersOn, setRemindersOn] = useState(false);
  const [reminderSync, setReminderSync] = useState<ReminderSync | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [stored, language, reminders, savedOrigin] = await Promise.all([readSession(), readLang(), readReminders(), readOrigin()]);
      if (!active) return;
      setLang(language);
      setRemindersOn(reminders);
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

  const chooseLang = (next: Lang) => {
    setLang(next);
    void saveLang(next);
  };

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

  if (!ready) return <View style={styles.fill}><ActivityIndicator color={colors.gold} style={{ marginTop: 32 }} /></View>;
  if (!session && !preview) {
    return <SignIn lang={lang} setLang={chooseLang} originDraft={originDraft} setOriginDraft={setOriginDraft} defaultOrigin={defaultOrigin} onSession={setSession} onPreview={() => { setPreview(true); setSnapshot(sampleSnapshot()); setSection("characters"); }} />;
  }
  if (session?.personal && !preview) {
    return <ScrollView contentContainerStyle={styles.content}>
      <Language lang={lang} setLang={chooseLang} />
      <Text style={styles.kicker}>{t(lang, "guildKicker")}</Text>
      <Text style={styles.title}>{t(lang, "personalTitle")}</Text>
      <Text style={styles.intro}>{t(lang, "personalBody")}</Text>
      <AlbumScreen lang={lang} session={session} />
      <Pressable onPress={() => void leave()} style={styles.secondary}><Text style={styles.secondaryText}>{t(lang, "signOut")}</Text></Pressable>
    </ScrollView>;
  }

  const hub = snapshot?.hub ?? null;
  const manage = snapshot?.manage ?? null;
  const standings = snapshot?.standings ?? null;
  const guildName = hub?.guildName || manage?.guildName || standings?.guildName || session?.guildName || "Guild";

  return <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === "ios" ? "padding" : undefined}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {preview ? <Text style={styles.banner}>{t(lang, "sampleBanner")}</Text> : null}
      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>{t(lang, "guildKicker")}</Text>
          <Text style={styles.title}>{guildName}</Text>
          <Text style={styles.muted}>{[hub?.edition || standings?.edition, hub?.battleTag].filter(Boolean).join(" · ")}</Text>
        </View>
        <Pressable onPress={() => { if (!preview && session) void load(session); }} accessibilityRole="button" style={styles.textButton}><Text style={styles.textButtonLabel}>{t(lang, "refresh")}</Text></Pressable>
      </View>
      <View style={styles.chips}>
        {sections.map((name) => <Pressable key={name} accessibilityRole="tab" accessibilityState={{ selected: section === name }} onPress={() => setSection(name)} style={[styles.chip, section === name && styles.chipOn]}>
          <Text style={[styles.chipText, section === name && styles.chipTextOn]}>{t(lang, name)}</Text>
        </Pressable>)}
      </View>
      {loading && !snapshot ? <ActivityIndicator color={colors.gold} style={{ marginVertical: 24 }} /> : null}
      {section === "characters" ? <Characters lang={lang} hub={hub} error={snapshot?.errors.hub} /> : null}
      {section === "reserves" ? <Reserves lang={lang} hub={hub} error={snapshot?.errors.hub} /> : null}
      {section === "wishlist" ? <Wishlist lang={lang} preview={preview} session={session} manage={manage} error={snapshot?.errors.manage} onChange={(next) => setSnapshot((current) => current ? { ...current, manage: next } : current)} /> : null}
      {section === "raids" ? <Raids lang={lang} hub={hub} manage={manage} standings={standings} error={snapshot?.errors.standings} /> : null}
      {section === "album" ? <AlbumScreen lang={lang} session={preview ? null : session} /> : null}
      {section === "alerts" ? <Alerts lang={lang} preview={preview} remindersOn={remindersOn} setRemindersOn={(on) => { setRemindersOn(on); if (!preview) void saveReminders(on); }} planned={planned} imminent={imminent} sync={reminderSync} /> : null}
      {(manage?.raidLeader || hub?.raidLeader) ? <Text style={styles.note}>{t(lang, "leaderNote")}</Text> : null}
      <Pressable onPress={() => void leave()} style={styles.secondary}><Text style={styles.secondaryText}>{preview ? t(lang, "closeSample") : t(lang, "signOut")}</Text></Pressable>
    </ScrollView>
  </KeyboardAvoidingView>;
}

function Language({ lang, setLang }: { lang: Lang; setLang: (lang: Lang) => void }) {
  return <View style={styles.langRow}>
    {(["en", "fr"] as const).map((code) => <Pressable key={code} onPress={() => setLang(code)} style={[styles.lang, lang === code && styles.langOn]}><Text style={[styles.langText, lang === code && styles.langTextOn]}>{code.toUpperCase()}</Text></Pressable>)}
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
        const session = { ...answer, apiOrigin: pending.origin };
        await saveSession(session);
        setPending(null);
        onSession(session);
      } catch (caught) {
        if (stopped) return;
        setPending(null);
        setError(caught instanceof Error ? caught.message : t(lang, "signInTitle"));
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
    if (!origin) return;
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
    if (!origin || !code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await saveOrigin(origin);
      const grant = await new GuildedClient(origin).pair(code, serverId);
      const session = { ...grant, apiOrigin: origin };
      await saveSession(session);
      onSession(session);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t(lang, "connect"));
    } finally { setBusy(false); }
  };

  return <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <Language lang={lang} setLang={setLang} />
    <Text style={styles.kicker}>{t(lang, "guildKicker")}</Text>
    <Text style={styles.title}>{t(lang, "signInTitle")}</Text>
    <Text style={styles.intro}>{t(lang, "signInIntro")}</Text>
    {error ? <Text style={styles.error}>{error}</Text> : null}
    {pending ? <View style={styles.hero}>
      <Text style={styles.code}>{pending.confirm}</Text>
      <Text style={styles.muted}>{t(lang, "codeHelp")}</Text>
      <Text style={styles.muted}>{t(lang, "waiting")}</Text>
      <Pressable onPress={() => void Linking.openURL(pending.url)} style={styles.primary}><Text style={styles.primaryText}>{t(lang, "openPage")}</Text></Pressable>
      <Pressable onPress={() => setPending(null)} style={styles.secondary}><Text style={styles.secondaryText}>{t(lang, "cancel")}</Text></Pressable>
    </View> : <Pressable onPress={() => void start()} disabled={busy} style={styles.primary}><Text style={styles.primaryText}>{t(lang, "signInButton")}</Text></Pressable>}
    <Text style={styles.label}>{t(lang, "pairingLabel")}</Text>
    <TextInput value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} placeholder={t(lang, "pairingPlaceholder")} placeholderTextColor={colors.muted} style={styles.input} />
    <TextInput value={serverId} onChangeText={setServerId} autoCorrect={false} placeholder={t(lang, "serverIdPlaceholder")} placeholderTextColor={colors.muted} style={styles.input} keyboardType="number-pad" />
    <Pressable onPress={() => void pair()} disabled={busy || !code.trim()} style={styles.secondary}><Text style={styles.secondaryText}>{t(lang, "connect")}</Text></Pressable>
    <Pressable onPress={() => setAdvanced((open) => !open)} style={styles.textButton}><Text style={styles.textButtonLabel}>{t(lang, "advanced")}</Text></Pressable>
    {advanced ? <>
      <Text style={styles.muted}>{t(lang, "serverAddressHelp")}</Text>
      <TextInput value={originDraft} onChangeText={setOriginDraft} autoCapitalize="none" autoCorrect={false} placeholder={defaultOrigin} placeholderTextColor={colors.muted} style={styles.input} />
    </> : null}
    <View style={styles.hero}>
      <Text style={styles.heroTitle}>{t(lang, "preview")}</Text>
      <Text style={styles.muted}>{t(lang, "previewNote")}</Text>
      <Pressable onPress={onPreview} style={styles.secondary}><Text style={styles.secondaryText}>{t(lang, "preview")}</Text></Pressable>
    </View>
  </ScrollView>;
}

function Characters({ lang, hub, error }: { lang: Lang; hub: HubView | null; error?: string }) {
  if (error) return <Text style={styles.error}>{error}</Text>;
  if (!hub) return null;
  return <>
    {hub.battleNet !== null ? <Text style={styles.muted}>{t(lang, "battleNet")}: {hub.battleNet ? t(lang, "linked") : t(lang, "notLinked")}{hub.battleTag ? ` · ${hub.battleTag}` : ""}</Text> : null}
    {hub.characters.length === 0 ? <Text style={styles.intro}>{t(lang, "noCharacters")}</Text> : hub.characters.map((character) => <View key={character.id} style={styles.hero}>
      <View style={styles.titleRow}>
        <Text style={styles.heroTitle}>{shownName(character)}</Text>
        <Text style={styles.pill}>{character.isMain ? t(lang, "main") : character.className}</Text>
      </View>
      <Text style={styles.muted}>{[character.spec, character.className].filter(Boolean).join(" ")}{character.level ? ` · ${t(lang, "level")} ${character.level}` : ""}</Text>
      <Text style={styles.muted}>{[character.realm, character.edition].filter(Boolean).join(" · ")}</Text>
      <Text style={styles.body}>{t(lang, "rank")}: {character.rank ?? t(lang, "noRank")}</Text>
      {character.guildName ? <Text style={styles.muted}>{character.guildName}{character.current ? "" : ` · ${t(lang, "otherServer")}`}</Text> : null}
      {character.cores.map((core) => <Text key={`${character.id}-${core.name}-${core.role}`} style={styles.body}>{core.name} · {roleLabel(core.role, lang)}{core.bench ? ` · ${t(lang, "bench")}` : ""}{core.trial ? ` · ${t(lang, "trial")}` : ""}{core.backup ? ` · ${t(lang, "backup")}` : ""}</Text>)}
    </View>)}
  </>;
}

function Reserves({ lang, hub, error }: { lang: Lang; hub: HubView | null; error?: string }) {
  if (error) return <Text style={styles.error}>{error}</Text>;
  if (!hub) return null;
  const reserves = hub.reserves;
  const soft = reserves.cores.filter((core) => core.lootMode === "RESERVE");
  return <>
    <View style={styles.hero}>
      <Text style={styles.label}>{t(lang, "whereToReserve")}</Text>
      <Text style={styles.muted}>{t(lang, "reservesIntro")}</Text>
      {soft.length ? <Text style={styles.body}>{t(lang, "coresUsing")}: {soft.map((core) => `${core.name} (${t(lang, "perPlayer", { count: core.reservesPerPlayer ?? 0 })})`).join(", ")}</Text> : <Text style={styles.muted}>{t(lang, "noSoftReserveCores")}</Text>}
    </View>
    {!reserves.list?.active ? <Text style={styles.intro}>{t(lang, "noReserveList")}</Text> : <View style={styles.hero}>
      <View style={styles.titleRow}>
        <Text style={styles.heroTitle}>{reserves.list.title || t(lang, "reserves")}</Text>
        <Text style={styles.pill}>{reserves.list.open ? t(lang, "reserveOpen") : t(lang, "reserveLocked")}</Text>
      </View>
      <Text style={styles.body}>{t(lang, "yourReserves")}: {reserves.mineCount}</Text>
      {reserves.items.length === 0 ? <Text style={styles.muted}>{t(lang, "nobodyReserved")}</Text> : reserves.items.slice(0, 40).map((item) => <View key={item.itemName} style={styles.row}>
        <Text style={[styles.body, { flex: 1 }]}>{item.mine ? "★ " : ""}{item.itemName}</Text>
        <Text style={styles.muted}>{item.characters.join(", ")}</Text>
      </View>)}
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
  const activeId = characterId ?? manage?.characters[0]?.id ?? null;
  const selected = manage?.characters.find((character) => character.id === activeId) ?? null;

  const applyLocal = (character: WishCharacter, nextList: WishCharacter["wishlist"]) => {
    if (!manage) return;
    onChange({ ...manage, characters: manage.characters.map((entry) => entry.id === character.id ? { ...entry, wishlist: nextList } : entry) });
  };

  const add = async () => {
    if (!selected || !item.trim()) return;
    const name = item.trim();
    setBusy(true);
    setNotice(null);
    try {
      if (preview || !session) {
        const without = selected.wishlist.filter((wish) => wish.itemName.toLowerCase() !== name.toLowerCase());
        applyLocal(selected, [...without, { itemName: name, priority }].sort((a, b) => a.priority - b.priority || a.itemName.localeCompare(b.itemName)));
      } else {
        const message = await new GuildedClient(session.apiOrigin, session.companionCredential).setWishlist(session.guildDiscordId, selected.id, name, priority);
        setNotice(message);
        const fresh = await new GuildedClient(session.apiOrigin, session.companionCredential).manage(session.guildDiscordId);
        onChange(fresh);
      }
      setItem("");
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : t(lang, "add"));
    } finally { setBusy(false); }
  };

  const remove = async (wish: string) => {
    if (!selected) return;
    setNotice(null);
    try {
      if (preview || !session) applyLocal(selected, selected.wishlist.filter((entry) => entry.itemName !== wish));
      else if (session) {
        const message = await new GuildedClient(session.apiOrigin, session.companionCredential).removeWishlist(session.guildDiscordId, selected.id, wish);
        setNotice(message);
        onChange(await new GuildedClient(session.apiOrigin, session.companionCredential).manage(session.guildDiscordId));
      }
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : t(lang, "remove"));
    }
  };

  if (error) return <Text style={styles.error}>{error}</Text>;
  if (!manage) return null;
  return <>
    <Text style={styles.intro}>{t(lang, "wishlistIntro")}</Text>
    <View style={styles.chips}>
      {manage.characters.map((character) => <Pressable key={character.id} onPress={() => setCharacterId(character.id)} style={[styles.chip, selected?.id === character.id && styles.chipOn]}>
        <Text style={[styles.chipText, selected?.id === character.id && styles.chipTextOn]}>{shownName(character)}</Text>
      </Pressable>)}
    </View>
    {notice ? <Text style={styles.muted}>{notice}</Text> : null}
    {selected && selected.wishlist.length === 0 ? <Text style={styles.muted}>{t(lang, "noWishes")}</Text> : selected?.wishlist.map((wish) => <View key={wish.itemName} style={styles.row}>
      <Text style={[styles.body, { flex: 1 }]}>{wish.priority}. {wish.itemName}</Text>
      <Pressable onPress={() => void remove(wish.itemName)}><Text style={styles.textButtonLabel}>{t(lang, "remove")}</Text></Pressable>
    </View>)}
    {selected ? <View style={styles.hero}>
      <TextInput value={item} onChangeText={setItem} placeholder={t(lang, "itemPlaceholder")} placeholderTextColor={colors.muted} style={styles.input} />
      <Text style={styles.label}>{t(lang, "priority")}</Text>
      <View style={styles.langRow}>
        {[1, 2, 3].map((value) => <Pressable key={value} onPress={() => setPriority(value)} style={[styles.lang, priority === value && styles.langOn]}><Text style={[styles.langText, priority === value && styles.langTextOn]}>{value}</Text></Pressable>)}
      </View>
      <Pressable onPress={() => void add()} disabled={busy || !item.trim()} style={styles.primary}><Text style={styles.primaryText}>{t(lang, "add")}</Text></Pressable>
    </View> : null}
  </>;
}

function Raids({ lang, hub, manage, standings, error }: { lang: Lang; hub: HubView | null; manage: ManageView | null; standings: StandingsView | null; error?: string }) {
  if (error && !standings) return <Text style={styles.error}>{error}</Text>;
  if (!standings) return error ? <Text style={styles.error}>{error}</Text> : null;
  const mine = withMine(standings.standings, (hub?.characters ?? []).filter((character) => character.current));
  const rows = [...mine.filter((row) => row.mine), ...mine.filter((row) => !row.mine)].slice(0, 20);
  const next = standings.nextRaid;
  return <>
    <Text style={styles.intro}>{t(lang, "raidIntro")}</Text>
    <View style={styles.hero}>
      <Text style={styles.label}>{t(lang, "nextRaid")}</Text>
      {!next ? <Text style={styles.muted}>{t(lang, "noNextRaid")}</Text> : <>
        <Text style={styles.heroTitle}>{next.title}</Text>
        <Text style={styles.muted}>{formatWhen(next.scheduledAt, lang)}{next.core ? ` · ${next.core}` : ""}</Text>
        <Text style={styles.body}>{t(lang, "signedUp")}</Text>
        {next.players.map((player) => <Text key={`${player.name}-${player.role}`} style={styles.muted}>{player.name} · {roleLabel(player.role, lang)}</Text>)}
        {next.maybe.length ? <Text style={styles.muted}>{t(lang, "maybe")}: {next.maybe.join(", ")}</Text> : null}
      </>}
    </View>
    <Text style={styles.label}>{t(lang, "upcoming")}</Text>
    {standings.raids.length === 0 ? <Text style={styles.muted}>{t(lang, "noUpcoming")}</Text> : standings.raids.map((raid) => {
      const link = discordEventLink(raid.note);
      return <View key={raid.id} style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.body}>{raid.title}</Text>
          <Text style={styles.muted}>{formatWhen(raid.at, lang)}{raid.core ? ` · ${raid.core}` : ""}</Text>
        </View>
        {link ? <Pressable onPress={() => void Linking.openURL(link)}><Text style={styles.textButtonLabel}>{t(lang, "openDiscord")}</Text></Pressable> : null}
      </View>;
    })}
    <Text style={styles.label}>{t(lang, "standings")}</Text>
    {rows.length === 0 ? <Text style={styles.muted}>{t(lang, "noStandings")}</Text> : rows.map((row) => <View key={row.character} style={styles.row}>
      <Text style={[styles.body, { flex: 1 }]}>{row.mine ? `${t(lang, "you")} · ` : ""}{row.character}</Text>
      <Text style={styles.muted}>{row.ep} / {row.gp} · {formatPr(row.pr)}</Text>
    </View>)}
    {(manage?.cores ?? []).filter((core) => core.rows.length > 0).map((core) => <CoreList key={core.id} lang={lang} core={core} />)}
  </>;
}

function CoreList({ lang, core }: { lang: Lang; core: CoreBoard }) {
  return <View style={styles.hero}>
    <Text style={styles.heroTitle}>{core.name}</Text>
    <Text style={styles.muted}>{lootModeLabel(core.lootMode, lang)}</Text>
    {core.rows.slice(0, 12).map((row) => <View key={`${core.id}-${row.name}`} style={styles.row}>
      <Text style={[styles.body, { flex: 1 }]}>{row.rank}. {row.me ? `${t(lang, "you")} · ` : ""}{row.name}</Text>
      <Text style={styles.muted}>{formatPr(row.pr)}</Text>
    </View>)}
  </View>;
}

function Alerts({ lang, preview, remindersOn, setRemindersOn, planned, imminent, sync }: {
  lang: Lang; preview: boolean; remindersOn: boolean; setRemindersOn: (on: boolean) => void;
  planned: ReturnType<typeof planReminders>; imminent: { id: string; title: string; at: string }[]; sync: ReminderSync | null;
}) {
  return <>
    <Text style={styles.intro}>{t(lang, "alertsIntro")}</Text>
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: remindersOn }} onPress={() => setRemindersOn(!remindersOn)} style={styles.hero}>
      <Text style={styles.heroTitle}>{t(lang, "remindMe")}</Text>
      <Text style={styles.body}>{remindersOn ? t(lang, "on") : t(lang, "off")}</Text>
    </Pressable>
    {preview ? <Text style={styles.muted}>{t(lang, "alertsWeb")}</Text> : null}
    {!preview && sync && !sync.supported ? <Text style={styles.muted}>{t(lang, "alertsWeb")}</Text> : null}
    {!preview && sync && sync.supported && !sync.granted ? <Text style={styles.error}>{t(lang, "alertsDenied")}</Text> : null}
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
  titleRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  intro: { color: colors.muted, fontSize: 15, lineHeight: 22, marginTop: 10, marginBottom: 8 },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 20, marginTop: 4 },
  body: { color: colors.text, fontSize: 14, lineHeight: 20, marginTop: 4 },
  error: { color: "#e7b4a8", fontSize: 14, lineHeight: 20, marginTop: 12 },
  hero: { backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 16, marginTop: 16 },
  heroTitle: { color: colors.text, fontSize: 18, fontWeight: "700" },
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
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8 },
  chipOn: { borderColor: colors.gold, backgroundColor: "#2a2416" },
  chipText: { color: colors.muted, fontSize: 13 },
  chipTextOn: { color: colors.gold, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, borderTopWidth: 1, borderColor: colors.line, paddingVertical: 12 },
  pill: { color: colors.gold, borderWidth: 1, borderColor: "#3a3424", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, fontSize: 11, overflow: "hidden" },
  note: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 18 },
  langRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  lang: { minWidth: 44, minHeight: 36, borderRadius: 8, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  langOn: { borderColor: colors.gold },
  langText: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  langTextOn: { color: colors.gold }
});
