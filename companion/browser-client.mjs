import { readBrowserAddon, readBrowserPoe } from "./browser-files.mjs";
import { standingsToLua } from "./standings-format.mjs";
import { createBrowserFolderAccess } from "./browser-folders.mjs";
import { acknowledgements, pruneAcknowledged } from "./delta.mjs";
import { sheetFiles } from "./sheet-export.mjs";
import { personalPayload, personalResultMessage } from "./personal-runs-content.mjs";

/* global __GUILDED_VERSION__ */
// Filled in by scripts/build-companion-web.mjs from package.json.
const VERSION = typeof __GUILDED_VERSION__ === "string" ? __GUILDED_VERSION__ : "dev";

export function createBrowserCompanion(env = globalThis) {
  const { location, sessionStorage, document, URL, Blob } = env;
  const folders = createBrowserFolderAccess(env);
  const key = "guilded.companion.session.v1";
  const deviceKey = "guilded.companion.device.v1";
  let deviceStorage, storageWarning = null;
  try { deviceStorage = env.localStorage; } catch { /* Restricted browsers may deny persistent storage. */ }
  let saved = {};
  try { saved = JSON.parse(deviceStorage?.getItem(deviceKey) || sessionStorage.getItem(key) || "{}"); } catch { /* Storage can be unavailable. */ }
  let config = { wowEnabled: true, poeEnabled: false, realm: "WoW Forever", uploadUrl: `${location.origin}/api/v1/addon-imports`, guildDiscordId: new URLSearchParams(location.search).get("guild") || "", poeMode: "STANDARD", ...saved.config };
  const logs = [];
  const listeners = { state: [], log: [] };
  const state = { running: false, uploads: 0, watching: null, lastUpload: null, lastStandings: null, botVersion: null, poe: /** @type {{ pending?: number, currentArea?: string | null, preview?: boolean, lastSync?: string, error?: string } | null} */ (null) };
  let wowFile;
  let visits = Array.isArray(saved.visits) && saved.visits.length <= 10_000 ? saved.visits : [];
  let busy = false;
  const persist = () => {
    const text = JSON.stringify({ config: { ...config, pairingCode: "" }, visits });
    try {
      if (!deviceStorage) throw new Error("Persistent storage unavailable");
      deviceStorage.setItem(deviceKey, text);
      storageWarning = null;
      try { sessionStorage.removeItem(key); } catch { /* Older tab storage may be unavailable. */ }
    } catch {
      storageWarning = "This browser cannot remember your Discord connection on this device. Keep this tab open or use a browser with site storage enabled.";
      try { sessionStorage.setItem(key, text); } catch { /* In-memory access remains usable. */ }
    }
  };
  if (saved.config || visits.length) persist(); // Migrate the existing tab connection without re-pairing.
  const health = () => !config.companionCredential ? { level: "setup", text: "Setup needed" }
    : state.uploadError || state.standingsError || state.poe?.error ? { level: "error", text: state.uploadError || state.standingsError || state.poe.error }
    : storageWarning || folders.storageWarning() ? { level: "warn", text: storageWarning || folders.storageWarning() }
    : { level: "ok", text: "Browser ready. Select files and sync when you want." };
  const snapshot = () => ({ state: structuredClone(state), health: health() });
  const emit = () => listeners.state.forEach(fn => fn(snapshot()));
  const log = (level, message) => {
    for (const secret of [config.companionCredential, config.pairingCode]) if (secret?.length >= 6) message = message.replaceAll(secret, "[redacted]");
    const entry = { time: new Date().toISOString(), level, message }; logs.push(entry); if (logs.length > 300) logs.shift(); listeners.log.forEach(fn => fn(entry)); emit();
  };
  // What the bot can do and what it already stored, from the last standings answer (this tab only).
  let botFeatures = new Set();
  let ack = null;
  const rememberStandings = body => { botFeatures = new Set(Array.isArray(body?.features) ? body.features : []); ack = acknowledgements(body); return body; };
  // Uploads are gzip-compressed when the bot can read that and this browser can write it.
  async function encodeBody(bodyText) {
    if (!botFeatures.has("gzip-upload") || typeof env.CompressionStream !== "function" || typeof env.Response !== "function") {
      return { body: bodyText, bytes: new TextEncoder().encode(bodyText).byteLength, headers: {} };
    }
    const stream = new Blob([bodyText]).stream().pipeThrough(new env.CompressionStream("gzip"));
    const body = new Uint8Array(await new env.Response(stream).arrayBuffer());
    return { body, bytes: body.byteLength, headers: { "content-encoding": "gzip" } };
  }
  async function request(path, payload) {
    const encoded = payload ? await encodeBody(JSON.stringify(payload)) : null;
    if (encoded && encoded.bytes > 1_000_000) throw new Error("This structured export exceeds the bot's 1 MB upload limit. Ask your guild officer for help.");
    const response = await env.fetch(path, { method: payload ? "POST" : "GET", credentials: "omit", headers: { "x-companion-credential": config.companionCredential || "", ...(payload ? { "content-type": "application/json", ...encoded.headers } : {}) }, ...(payload ? { body: encoded.body } : {}), signal: AbortSignal.timeout(20_000) });
    const body = await response.json();
    if (!response.ok && !(response.status === 409 && body.importId)) throw new Error(body.error || `The bot answered ${response.status}.`);
    state.botVersion = body.botVersion || state.botVersion;
    return body;
  }
  let signIn = null, signInRequest = null;
  // A pairing code or a Discord sign-in: both end with the same credential and settings.
  function applyPairing(next, result, server) {
    if (typeof result.companionCredential !== "string" || result.companionCredential.length < 32) throw new Error("The bot did not return a valid Discord link. Please try again.");
    botFeatures = new Set(); ack = null;
    const personal = result.personal === true;
    config = { ...config, ...next, personal, guildDiscordId: personal ? "" : typeof result.guildDiscordId === "string" ? result.guildDiscordId : server || config.guildDiscordId, pairingCode: "", companionCredential: result.companionCredential, uploadUrl: `${location.origin}/api/v1/addon-imports` }; state.running = true; state.uploadError = null; persist(); emit();
    return { ok: true, message: personal ? "Website account connected. Choose your GuildedDungeons.lua (or Guilded.lua), then Sync now: your finished runs go to the public leaderboards." : "Discord connected. Choose your game files to start syncing." };
  }
  const guildQuery = () => `guild=${encodeURIComponent(config.guildDiscordId)}`;
  // Personal mode (a code from guilded.kcaron.top/me/): GuildedDungeons.lua first, Guilded.lua otherwise.
  const savedNames = () => (config.personal ? ["GuildedDungeons.lua", "Guilded.lua"] : ["Guilded.lua"]);
  async function uploadPersonal(currentFile) {
    const { character, runs } = personalPayload(await currentFile.text(), config.realm);
    if (!character) throw new Error("The saved file has no character yet. Log in once with Guilded Dungeons, then /reload.");
    if (!runs.length) { log("info", "No finished dungeon run to send yet."); return; }
    const result = personalResultMessage(await request("/api/v1/public-runs", { character, runs }));
    state.lastUpload = { at: new Date().toISOString(), message: result.message }; state.uploads++; state.uploadError = null;
    log(result.level, result.message);
  }
  const pick = extension => new Promise(resolve => {
    const input = document.createElement("input"); input.type = "file"; input.accept = extension;
    input.addEventListener("change", () => { const file = input.files[0]; input.remove(); resolve(file || null); }, { once: true });
    input.addEventListener("cancel", () => { input.remove(); resolve(null); }, { once: true }); input.click();
  });
  async function uploadNow() {
    if (busy) return; busy = true;
    try {
      if (!config.companionCredential) throw new Error("Connect your Discord account first.");
      const currentFile = config.wowEnabled && folders.hasInput() ? await folders.readInput(savedNames()) : wowFile;
      if (config.personal && currentFile) await uploadPersonal(currentFile);
      else if (config.wowEnabled && currentFile) {
        const full = await readBrowserAddon(currentFile, config.realm);
        if (config.wowGuild && full.wowGuild && full.wowGuild !== config.wowGuild) throw new Error("This saved data belongs to a different WoW guild.");
        // Entries the bot already stored are left out (known from this tab's last standings answer).
        const exported = pruneAcknowledged(full, ack, botFeatures).exported;
        const result = await request("/api/v1/addon-imports", { guildDiscordId: config.guildDiscordId, export: exported });
        state.lastUpload = { at: new Date().toISOString(), message: result.status === "APPLIED" || result.autoApplied ? "Your saved data is synced." : "Received by the bot. Guild ledger changes may await officer review." };
        state.addonVersion = exported.addonVersion; state.uploads++; state.uploadError = null; log("ok", state.lastUpload.message);
        if (folders.hasOutput()) {
          try { await saveBrowserStandings(false); }
          catch (error) { state.standingsError = error.message; log("error", `Upload succeeded, but standings were not saved: ${error.message}`); }
        } else if (folders.available) {
          log("info", "Upload complete. Choose your Guilded addon folder with Save standings to addon once; future Sync now clicks will update standings too.");
        }
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
  function download(name, text, type = "text/plain;charset=utf-8") {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function saveBrowserStandings(requestAccess = true) {
    const load = async () => standingsToLua(rememberStandings(await request(`/api/v1/standings?${guildQuery()}`)));
    if (folders.available) await folders.saveStandings(load, { requestAccess });
    else download("Standings.lua", await load());
    state.standingsError = null;
    state.lastStandings = { at: new Date().toISOString(), message: folders.available ? "Standings saved in your Guilded addon folder. Use /reload in WoW." : "Downloaded. Place in Interface / AddOns / Guilded, then /reload." };
    log("ok", state.lastStandings.message);
  }
  const api = {
    browser: true,
    folderAccess: folders.available,
    getAll: async () => { await folders.ready; if (folders.hasInput()) state.watching = `SavedVariables / ${savedNames()[0]}`; return { config, logs, ...snapshot(), autostart: false, version: VERSION }; },
    saveConfig: async next => {
      if (busy) return { ok: false, message: "Wait for the current sync to finish before changing settings." };
      if (visits.length && ["poeCharacter", "poeLeague", "poeMode", "guildDiscordId"].some(field => next[field] !== config[field])) return { ok: false, message: "Sync your queued visits before changing character, league, mode or server." };
      if (["guildDiscordId", "companionCredential"].some(field => field in next && next[field] !== config[field])) {
        botFeatures = new Set(); ack = null;
      }
      config = { ...config, ...next, uploadUrl: `${location.origin}/api/v1/addon-imports` }; persist(); state.running = !!config.companionCredential; emit();
      return { ok: true, message: "Preferences saved on this browser/device. Choose a file and use Sync now." };
    },
    pairAccount: async next => {
      if (busy || visits.length) return { ok: false, message: "Finish syncing your queued visits before replacing this Discord link." };
      busy = true;
      try {
        const server = next.guildDiscordId?.trim();
        const result = await request("/api/v1/addon-pairings", { ...(server ? { guildDiscordId: server } : {}), code: (next.pairingCode || "").trim() });
        return applyPairing(next, result, server);
      } catch (error) { return { ok: false, message: error.message }; }
      finally { busy = false; }
    },
    // "Sign in with Discord" (7.2): the page opens /me/companion in a new tab; this waits for the approval.
    signInStart: async () => {
      if (busy || visits.length) return { ok: false, message: "Finish syncing your queued visits before replacing this Discord link." };
      try {
        signIn?.abort();
        const started = await request("/api/v1/companion/sign-in", {});
        if (typeof started.requestId !== "string" || typeof started.url !== "string" || new URL(started.url).origin !== location.origin) throw new Error("The bot's sign-in answer was incomplete.");
        signIn = new AbortController();
        signInRequest = started.requestId;
        return { ok: true, confirm: started.confirm, url: started.url };
      } catch (error) { return { ok: false, message: error.message }; }
    },
    signInWait: async () => {
      const controller = signIn, requestId = signInRequest;
      if (!controller || !requestId) return { ok: false, message: "Choose Sign in with Discord first." };
      const until = Date.now() + 10 * 60_000;
      try {
        while (Date.now() < until && !controller.signal.aborted) {
          const answer = await request("/api/v1/companion/sign-in/poll", { requestId });
          if (answer.status !== "pending") {
            if (busy || visits.length) return { ok: false, message: "Finish syncing your queued visits before replacing this Discord link." };
            return applyPairing({}, answer, "");
          }
          await new Promise(done => setTimeout(done, 2_000));
        }
        return { ok: false, message: controller.signal.aborted ? "Sign-in cancelled." : "Sign-in timed out. Choose Sign in with Discord again." };
      } catch (error) { return { ok: false, message: error.message }; }
      finally { if (signIn === controller) { signIn = null; signInRequest = null; } }
    },
    signInCancel: async () => { signIn?.abort(); signIn = null; signInRequest = null; return { ok: true }; },
    testConnection: async next => {
      try {
        const health = await request("/health");
        if (health.ok !== true) throw new Error("The server is reachable, but the Discord bot is not ready. Ask your guild owner to check the service.");
        if (!config.companionCredential) {
          emit();
          return { ok: true, message: "Server is online. Your account is not linked yet: choose Sign in with Discord (or enter a pairing code)." };
        }
        if (config.personal) { emit(); return { ok: true, message: "Website account connected (public dungeon leaderboards). Select your saved file and use Sync now." }; }
        const server = next.guildDiscordId?.trim() || config.guildDiscordId;
        if (!server) return { ok: false, message: "Server is online. Enter your Discord server ID (Advanced preferences) before checking your account connection." };
        const path = next.wowEnabled === false ? "/api/v1/poe/status" : "/api/v1/standings";
        const data = await request(`${path}?guild=${encodeURIComponent(server)}`);
        emit();
        return { ok: true, message: next.wowEnabled === false
          ? `Account connected. PoE2 sharing is ${data.enabled ? "enabled" : "off; ask an officer to enable /poe setup"}.`
          : "Account connected. WoW standings are available. Select your saved file and use Sync now." };
      } catch (error) { return { ok: false, message: error.message }; }
    },
    browseFile: async () => {
      if (busy) throw new Error("Wait for the current sync before changing files.");
      if (folders.available) {
        const name = await folders.chooseInput(savedNames()); wowFile = undefined; state.watching = name;
        log("info", "SavedVariables folder selected. After /reload, Sync now reads the latest Guilded.lua.");
        if (folders.storageWarning()) log("warn", folders.storageWarning());
        return name;
      }
      const file = await pick(".lua"); if (!file) return null;
      if (config.personal) personalPayload(await file.text(), config.realm); else await readBrowserAddon(file, config.realm); wowFile = file; state.watching = file.name; log("info", "WoW saved data selected. Choose Sync now to send it."); return file.name;
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
    // Export to spreadsheet: read locally, then one CSV download per table (all, or `table`).
    exportSheets: async table => {
      if (busy) return { ok: false, message: "Wait for the current sync to finish." };
      const currentFile = folders.hasInput() ? await folders.readInput() : wowFile;
      if (!currentFile) return { ok: false, message: "Choose Guilded.lua first (World of Warcraft page). In WoW, /reload so it holds your latest data." };
      try {
        const files = sheetFiles(await currentFile.text()).filter(file => !table || file.table === table);
        for (const file of files) download(file.name, file.text, "text/csv;charset=utf-8");
        log("ok", `Downloaded ${files.map(file => `${file.table} (${file.rows})`).join(", ")}.`);
        return { ok: true, message: files.length > 1 ? "Spreadsheet files downloaded. If your browser asks, allow multiple downloads." : "Spreadsheet file downloaded.", files: files.map(({ name, table: kind, rows }) => ({ name, table: kind, rows })) };
      } catch (error) { return { ok: false, message: `Could not read Guilded.lua: ${error.message}` }; }
    },
    getPoeRuns: async () => (await request(`/api/v1/poe/visits?${guildQuery()}`)).visits,
    refreshStandings: async () => {
      if (!config.companionCredential) throw new Error("Connect your Discord account first.");
      if (config.personal) throw new Error("A website (personal) connection has no guild standings: it only sends your dungeon runs to the public leaderboards.");
      if (busy) throw new Error("Wait for the current sync to finish."); busy = true;
      try {
        await saveBrowserStandings();
      } catch (error) { state.standingsError = error.message; log("error", error.message); throw error; }
      finally { busy = false; emit(); }
    },
    setAutostart: async () => false, openAddonFolder: async () => false,
    removeData: async () => {
      if (busy) throw new Error("Wait for sync to finish.");
      // A personal credential is disconnected from guilded.kcaron.top/me/; a guild one here.
      if (config.companionCredential && !config.personal) await request("/api/v1/companion/logout", { guildDiscordId: config.guildDiscordId });
      try { await folders.forget(); }
      finally {
        config.companionCredential = ""; visits = []; state.running = false;
        try { deviceStorage?.removeItem(deviceKey); } catch { /* Server revocation already stops access. */ }
        try { sessionStorage.removeItem(key); } catch { /* Server revocation already stops access. */ }
        emit(); location.reload();
      }
    },
    // The Wishlist and Cores & prices pages: { ok, data | error }, like the desktop app.
    manageView: async () => { try { return { ok: true, data: await request(`/api/v1/manage?${guildQuery()}`) }; } catch (error) { return { ok: false, error: error.message }; } },
    manageEdit: async change => { try { return { ok: true, data: await request("/api/v1/manage", { guildDiscordId: config.guildDiscordId, change }) }; } catch (error) { return { ok: false, error: error.message }; } },
    onState: fn => listeners.state.push(fn), onLog: fn => listeners.log.push(fn)
  };
  if (visits.length) state.poe = { pending: visits.length, currentArea: null };
  state.running = !!config.companionCredential;
  return api;
}
