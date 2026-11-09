import { createEngine } from "./engine.mjs";
import { savedProfiles, isBlankProfile } from "./profiles.mjs";
import { expandAccounts, accountName } from "./wow-accounts.mjs";
import { resolveStandingsPath } from "./standings.mjs";
import { resolveAcceptedPath } from "./personal-runs.mjs";
import { resolve, dirname, basename, join } from "node:path";
import { realpathSync } from "node:fs";

function pathKey(path) {
  if (!path) return "";
  let parent = resolve(path);
  const missing = [];
  while (true) {
    try { return join(realpathSync(parent), ...missing).replaceAll("\\", "/").toLowerCase(); }
    catch { const next = dirname(parent); if (next === parent) return resolve(path).replaceAll("\\", "/").toLowerCase(); missing.unshift(basename(parent)); parent = next; }
  }
}
// Older grants lack a WoW scope ID. Distinct credentials on one Discord server
// are not evidence of identical in-game scope; require explicit source routing.
const scope = p => `${p.uploadUrl}|${p.gameEdition || ""}|${p.wowGuildId || `${p.guildDiscordId}|${p.companionCredential || ""}`}|${p.personal === true}`;

// One writer per destination, with the selected connection taking priority.
// Other enabled connections still upload and fetch acknowledgements. Switching
// the selection hands ownership over only after all old writes have stopped.
export function planProfiles(config) {
  const active = config.activeProfile || "default";
  const profiles = savedProfiles(config);
  // Each WoW account a connection syncs runs as its own engine (wow-accounts.mjs); the first keeps
  // the connection's id, so a single-account setup is planned exactly as before.
  const sorted = Object.entries(profiles).sort(([a], [b]) => Number(b === active) - Number(a === active));
  const expanded = expandAccounts(sorted);
  const owner = new Map(expanded.map(([id, , parent]) => [id, parent || id]));
  const entries = expanded.map(([id, p]) => [id, p]);
  const on = (id, p) => p.syncEnabled === true || (owner.get(id) === active && p.syncEnabled !== false);
  const writers = new Set();
  const inputs = new Map();
  for (const [id, p] of entries) {
    if (!on(id, p) || !p.watchFile || p.wowEnabled === false) continue;
    const key = pathKey(p.watchFile);
    inputs.set(key, [...(inputs.get(key) || []), p]);
  }
  // An empty connection (no bot address, never signed in) is left alone, silently, once another
  // connection is set up: it would only log "Not started" at every retry.
  const configured = entries.some(([, p]) => !isBlankProfile(p));
  return entries.map(([id, p]) => {
    const enabled = on(id, p) && !(configured && isBlankProfile(p));
    const peers = inputs.get(pathKey(p.watchFile)) || [];
    // Two guild destinations reading one file need explicit routing. A public
    // connection may share the input with a guild connection by user consent.
    const guildPeers = peers.filter(peer => !peer.personal);
    const ambiguous = !p.personal && guildPeers.some(peer => scope(peer) !== scope(p)) && guildPeers.some(peer => !peer.wowGuild?.trim());
    const output = p.wowEnabled === false || !p.watchFile ? "" : pathKey(p.personal ? resolveAcceptedPath(p) : resolveStandingsPath(p));
    const outputs = output ? [output] : [];
    if (output && !p.personal && p.dataAddon !== false) outputs.push(pathKey(join(dirname(dirname(resolveStandingsPath(p))), "GuildedData", "Standings.lua")));
    const write = outputs.every(path => !writers.has(path));
    if (enabled && !ambiguous && p.companionCredential && write) for (const path of outputs) writers.add(path);
    return { id, enabled, error: enabled && ambiguous ? "Shared saved data needs an exact WoW guild name on each guild connection." : null,
      config: { ...p, writeStandingsEnabled: write, requireWowGuild: !p.personal && guildPeers.some(peer => scope(peer) !== scope(p)) }, name: p.profileName || p.wowGuildName || owner.get(id), writesStandings: write,
      ...(owner.get(id) !== id ? { accountOf: owner.get(id) } : {}), account: p.watchFile ? accountName(p.watchFile) : "" };
  });
}

export function createProfileEngine(initialConfig, hooks = {}, factory = createEngine) {
  let config = initialConfig;
  let plans = [];
  let engines = new Map();
  let snapshots = new Map();
  let chain = Promise.resolve();
  let started = false;
  let recovery;
  const activeId = () => config.activeProfile || "default";
  // The selected connection's engines: its first account and any further ones.
  const activeEngines = () => [...engines].filter(([id]) => id === activeId() || plans.find(p => p.id === id)?.accountOf === activeId()).map(([, engine]) => engine);
  const accountState = id => { const s = snapshots.get(id); return { running: !!s?.running, lastUpload: s?.lastUpload || null, syncPhase: s?.syncPhase || null, error: s?.uploadError || null }; };
  const state = () => ({ ...(snapshots.get(activeId()) || { running: false }),
    // Every WoW account the selected connection syncs (one entry for a single-account setup).
    accounts: plans.filter(p => (p.accountOf || p.id) === activeId() && p.account).map(p => ({ account: p.account, file: p.config.watchFile, enabled: p.enabled, ...accountState(p.id) })),
    profiles: plans.filter(p => !p.accountOf).map(p => ({ id: p.id, name: p.name, enabled: p.enabled, writesStandings: p.writesStandings, error: p.error || snapshots.get(p.id)?.uploadError || snapshots.get(p.id)?.standingsError || null, running: !!snapshots.get(p.id)?.running, lastUpload: snapshots.get(p.id)?.lastUpload || null })) });
  const emit = () => hooks.onState?.(state());
  const enqueue = task => { const next = chain.then(task); chain = next.catch(() => {}); return next; };
  async function stopAll() {
    clearInterval(recovery); recovery = undefined;
    await Promise.all([...engines.values()].map(engine => engine.stop()));
    engines = new Map(); snapshots = new Map();
  }
  async function launch() {
    plans = planProfiles(config);
    await Promise.all(plans.map(async p => {
      if (!p.enabled || p.error) return;
      const current = hooks.profileConfig ? hooks.profileConfig(p.id, p.config) : p.config;
      const engine = factory(current, {
        onLog: entry => hooks.onLog?.({ ...entry, profileName: p.name }),
        onState: snapshot => { snapshots.set(p.id, snapshot); emit(); }
      });
      engines.set(p.id, engine);
      try { await engine.start(); snapshots.set(p.id, engine.state()); }
      catch (error) { await engine.stop(); snapshots.set(p.id, { running: false, uploadError: error.message }); }
    }));
    emit();
    recovery = setInterval(() => { void enqueue(async () => {
      for (const [id, engine] of engines) {
        if (snapshots.get(id)?.running) continue;
        try { await engine.start(); snapshots.set(id, engine.state()); }
        catch (error) { snapshots.set(id, { running: false, uploadError: error.message }); }
      }
      emit();
    }).catch(() => {}); }, 30_000);
    recovery.unref?.();
    return !!snapshots.get(activeId())?.running;
  }
  return {
    state,
    start: () => enqueue(async () => { started = true; await stopAll(); return launch(); }),
    stop: () => enqueue(async () => { started = false; await stopAll(); emit(); }),
    configure: next => enqueue(async () => { await stopAll(); config = next; started = true; return launch(); }),
    suspend: () => enqueue(stopAll),
    resume: () => enqueue(async () => { if (started) { await stopAll(); return launch(); } return false; }),
    uploadNow: () => { const first = engines.get(activeId()); for (const engine of activeEngines()) if (engine !== first) engine.uploadNow(); return first?.uploadNow(); },
    refreshStandings: () => engines.get(activeId())?.refreshStandings()
  };
}
