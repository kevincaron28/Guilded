import { readBrowserAddon, readBrowserPoe } from "./browser-files.mjs";
import { standingsToLua } from "./standings-format.mjs";
import { createBrowserFolderAccess } from "./browser-folders.mjs";

export function createBrowserCompanion(env = globalThis) {
  const { location, sessionStorage, document, URL, Blob } = env;
  const folders = createBrowserFolderAccess(env);
  const key = "guilded.companion.session.v1";
  let saved = {};
  try { saved = JSON.parse(sessionStorage.getItem(key) || "{}"); } catch { /* session storage can be unavailable */ }
  let config = { wowEnabled: true, poeEnabled: false, realm: "WoW Forever", uploadUrl: `${location.origin}/api/v1/addon-imports`, guildDiscordId: new URLSearchParams(location.search).get("guild") || "", poeMode: "STANDARD", ...saved.config };
  const logs = [];
  const listeners = { state: [], log: [] };
  const state = { running: false, uploads: 0, watching: null, lastUpload: null, lastStandings: null, botVersion: null, poe: /** @type {{ pending?: number, currentArea?: string | null, preview?: boolean, lastSync?: string, error?: string } | null} */ (null) };
  let wowFile;
  let visits = Array.isArray(saved.visits) && saved.visits.length <= 10_000 ? saved.visits : [];
  let busy = false;
  const persist = () => { try { sessionStorage.setItem(key, JSON.stringify({ config: { ...config, pairingCode: "" }, visits })); } catch { /* the current session remains usable */ } };
  const health = () => !config.companionCredential ? { level: "setup", text: "Setup needed" }
    : state.uploadError || state.standingsError || state.poe?.error ? { level: "error", text: state.uploadError || state.standingsError || state.poe.error }
    : { level: "ok", text: "Browser ready. Select files and sync when you want." };
  const snapshot = () => ({ state: structuredClone(state), health: health() });
  const emit = () => listeners.state.forEach(fn => fn(snapshot()));
  const log = (level, message) => {
    for (const secret of [config.companionCredential, config.pairingCode]) if (secret?.length >= 6) message = message.replaceAll(secret, "[redacted]");
    const entry = { time: new Date().toISOString(), level, message }; logs.push(entry); if (logs.length > 300) logs.shift(); listeners.log.forEach(fn => fn(entry)); emit();
  };
  async function request(path, payload) {
    const bodyText = payload ? JSON.stringify(payload) : null;
    if (bodyText && new TextEncoder().encode(bodyText).byteLength > 1_000_000) throw new Error("This structured export exceeds the bot's 1 MB upload limit. Ask your guild officer for help.");
    const response = await env.fetch(path, { method: payload ? "POST" : "GET", credentials: "omit", headers: { "x-companion-credential": config.companionCredential || "", ...(payload ? { "content-type": "application/json" } : {}) }, ...(payload ? { body: bodyText } : {}), signal: AbortSignal.timeout(20_000) });
    const body = await response.json();
    if (!response.ok && !(response.status === 409 && body.importId)) throw new Error(body.error || `The bot answered ${response.status}.`);
    state.botVersion = body.botVersion || state.botVersion;
    return body;
  }
  const guildQuery = () => `guild=${encodeURIComponent(config.guildDiscordId)}`;
  const pick = extension => new Promise(resolve => {
    const input = document.createElement("input"); input.type = "file"; input.accept = extension;
    input.addEventListener("change", () => { const file = input.files[0]; input.remove(); resolve(file || null); }, { once: true });
    input.addEventListener("cancel", () => { input.remove(); resolve(null); }, { once: true }); input.click();
  });
  async function uploadNow() {
    if (busy) return; busy = true;
    try {
      if (!config.companionCredential) throw new Error("Connect your Discord account first.");
      const currentFile = config.wowEnabled && folders.hasInput() ? await folders.readInput() : wowFile;
      if (config.wowEnabled && currentFile) {
        const exported = await readBrowserAddon(currentFile, config.realm);
        if (config.wowGuild && exported.wowGuild && exported.wowGuild !== config.wowGuild) throw new Error("This saved data belongs to a different WoW guild.");
        const result = await request("/api/v1/addon-imports", { guildDiscordId: config.guildDiscordId, export: exported });
        state.lastUpload = { at: new Date().toISOString(), message: result.status === "APPLIED" || result.autoApplied ? "Your saved data is synced." : "Received by the bot. Guild ledger changes may await officer review." };
        state.addonVersion = exported.addonVersion; state.uploads++; state.uploadError = null; log("ok", state.lastUpload.message);
      }
      if (config.poeEnabled && visits.length) {
        state.poe ||= {};
        while (visits.length) {
          const batch = visits.slice(0, 100);
          const result = await request("/api/v1/poe/visits", { guildDiscordId: config.guildDiscordId, visits: batch });
          if (!batch.every(row => result.acceptedRunRefs?.includes(row.runRef))) throw new Error("The bot did not acknowledge every visit. Your queue is kept for retry.");
          visits = visits.slice(batch.length); state.poe.pending = visits.length; state.poe.lastSync = new Date().toISOString(); state.poe.error = null; persist(); emit();
        }
        log("ok", "PoE2 map observations synced. Duplicate visits are skipped by the bot.");
      }
      state.uploadError = null;
      if (!currentFile && !visits.length && !state.poe?.lastSync) log("info", "Choose a game file before syncing. In WoW, /reload first to save fresh data.");
    } catch (error) { state.uploadError = error.message; log("error", error.message); throw error; }
    finally { busy = false; emit(); }
  }
  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const api = {
    browser: true,
    folderAccess: folders.available,
    getAll: async () => { await folders.ready; if (folders.hasInput()) state.watching = "SavedVariables / Guilded.lua"; return { config, logs, ...snapshot(), autostart: false, version: "6.0.0" }; },
    saveConfig: async next => {
      if (busy) return { ok: false, message: "Wait for the current sync to finish before changing settings." };
      if (visits.length && ["poeCharacter", "poeLeague", "poeMode", "guildDiscordId"].some(field => next[field] !== config[field])) return { ok: false, message: "Sync your queued visits before changing character, league, mode or server." };
      config = { ...config, ...next, uploadUrl: `${location.origin}/api/v1/addon-imports` }; persist(); state.running = !!config.companionCredential; emit();
      return { ok: true, message: "Preferences saved for this tab. Choose a file and use Sync now." };
    },
    pairAccount: async next => {
      if (busy || visits.length) return { ok: false, message: "Finish syncing your queued visits before replacing this Discord link." };
      try {
        const result = await request("/api/v1/addon-pairings", { guildDiscordId: next.guildDiscordId, code: next.pairingCode });
        if (typeof result.companionCredential !== "string" || result.companionCredential.length < 32) throw new Error("The bot did not return a valid Discord link. Please try a fresh pairing code.");
        config = { ...config, ...next, pairingCode: "", companionCredential: result.companionCredential, uploadUrl: `${location.origin}/api/v1/addon-imports` }; state.running = true; state.uploadError = null; persist(); emit();
        return { ok: true, message: "Discord connected. Choose your game files to start syncing." };
      } catch (error) { return { ok: false, message: error.message }; }
    },
    testConnection: async next => {
      try {
        const health = await request("/health");
        if (health.ok !== true) throw new Error("The server is reachable, but the Discord bot is not ready. Ask your guild owner to check the service.");
        if (!config.companionCredential) {
          emit();
          return { ok: true, message: "Server is online. Enter your Discord server ID and personal pairing code, then Connect. Your account is not linked yet." };
        }
        if (!next.guildDiscordId?.trim()) return { ok: false, message: "Server is online. Enter your Discord server ID before checking your account connection." };
        const path = next.wowEnabled === false ? "/api/v1/poe/status" : "/api/v1/standings";
        const data = await request(`${path}?guild=${encodeURIComponent(next.guildDiscordId)}`);
        emit();
        return { ok: true, message: next.wowEnabled === false
          ? `Account connected. PoE2 sharing is ${data.enabled ? "enabled" : "off; ask an officer to enable /poe setup"}.`
          : "Account connected. WoW standings are available. Select your saved file and use Sync now." };
      } catch (error) { return { ok: false, message: error.message }; }
    },
    browseFile: async () => {
      if (busy) throw new Error("Wait for the current sync before changing files.");
      if (folders.available) {
        const name = await folders.chooseInput(); wowFile = undefined; state.watching = name;
        log("info", "SavedVariables folder selected. After /reload, Sync now reads the latest Guilded.lua."); return name;
      }
      const file = await pick(".lua"); if (!file) return null; await readBrowserAddon(file, config.realm); wowFile = file; state.watching = file.name; log("info", "WoW saved data selected. Choose Sync now to send it."); return file.name;
    },
    forgetFiles: async () => { if (busy) throw new Error("Wait for the current sync to finish."); await folders.forget(); wowFile = undefined; state.watching = null; config.watchFile = ""; persist(); emit(); },
    browsePoeLog: async profile => {
      if (busy) throw new Error("Wait for your current sync to finish.");
      if (visits.length && ["poeCharacter", "poeLeague", "poeMode"].some(field => profile[field] !== config[field])) throw new Error("Sync queued observations before choosing a different character, league or mode.");
      const file = await pick(".txt"); if (!file) return null;
      const parsed = await readBrowserPoe(file, { character: profile.poeCharacter, league: profile.poeLeague, mode: profile.poeMode });
      const refs = new Set(visits.map(row => row.runRef));
      const additional = parsed.visits.filter(row => !refs.has(row.runRef));
      if (visits.length + additional.length > 10_000) throw new Error("Sync your pending observations before importing another log.");
      visits.push(...additional);
      state.poe = { pending: visits.length, currentArea: parsed.currentArea, preview: true, lastSync: state.poe?.lastSync };
      config = { ...config, poeCharacter: profile.poeCharacter, poeLeague: profile.poeLeague, poeMode: profile.poeMode }; persist();
      log("info", `${parsed.visits.length} completed observations found in the latest 24 hours${parsed.truncated ? " (last 8 MB of the file)" : ""}. Review the character and league, then Sync now.`); return file.name;
    },
    detectWow: async () => [], uploadNow,
    getPoeRuns: async () => (await request(`/api/v1/poe/visits?${guildQuery()}`)).visits,
    refreshStandings: async () => {
      if (!config.companionCredential) throw new Error("Connect your Discord account first.");
      if (busy) throw new Error("Wait for the current sync to finish."); busy = true;
      try {
        const load = async () => standingsToLua(await request(`/api/v1/standings?${guildQuery()}`));
        if (folders.available) await folders.saveStandings(load);
        else download("Standings.lua", await load());
        state.standingsError = null;
        state.lastStandings = { at: new Date().toISOString(), message: folders.available ? "Standings saved in your Guilded addon folder. Use /reload in WoW." : "Downloaded. Place in Interface / AddOns / Guilded, then /reload." };
        log("ok", state.lastStandings.message);
      } catch (error) { state.standingsError = error.message; log("error", error.message); throw error; }
      finally { busy = false; emit(); }
    },
    setAutostart: async () => false, openAddonFolder: async () => false,
    removeData: async () => { if (busy) throw new Error("Wait for sync to finish."); if (config.companionCredential) await request("/api/v1/companion/logout", { guildDiscordId: config.guildDiscordId }); await folders.forget(); sessionStorage.removeItem(key); location.reload(); },
    // The Wishlist and Cores & prices pages: { ok, data | error }, like the desktop app.
    manageView: async () => { try { return { ok: true, data: await request(`/api/v1/manage?${guildQuery()}`) }; } catch (error) { return { ok: false, error: error.message }; } },
    manageEdit: async change => { try { return { ok: true, data: await request("/api/v1/manage", { guildDiscordId: config.guildDiscordId, change }) }; } catch (error) { return { ok: false, error: error.message }; } },
    onState: fn => listeners.state.push(fn), onLog: fn => listeners.log.push(fn)
  };
  if (visits.length) state.poe = { pending: visits.length, currentArea: null };
  state.running = !!config.companionCredential;
  return api;
}
