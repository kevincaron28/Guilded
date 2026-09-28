const $ = (id) => document.getElementById(id);
const api = window.companion;
let logCount = 0;

function ago(iso) {
  if (!iso) return "";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 90) return `${seconds} seconds ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  return hours < 36 ? `${hours} hours ago` : `${Math.round(hours / 24)} days ago`;
}

function showPage(name) {
  for (const page of document.querySelectorAll(".page")) page.hidden = page.id !== `page-${name}`;
  for (const button of document.querySelectorAll(".nav")) button.classList.toggle("active", button.dataset.page === name);
}
for (const button of document.querySelectorAll(".nav")) button.addEventListener("click", () => showPage(button.dataset.page));

let lastSnapshot;
function renderState(snapshot) {
  lastSnapshot = snapshot;
  const { state, health } = snapshot;
  const banner = $("banner");
  banner.className = `banner ${health.level}`;
  $("bannerTitle").textContent = { ok: "All good", error: "Needs attention", setup: "Setup needed" }[health.level];
  $("bannerText").textContent = health.level === "setup"
    ? "Open Settings and fill in the bot address, token and Discord server ID."
    : health.text;
  $("setupBadge").hidden = health.level !== "setup";
  $("setupHint").hidden = health.level !== "setup";

  $("tileUpload").textContent = state.lastUpload ? ago(state.lastUpload.at) : "Nothing yet";
  $("tileUploadNote").textContent = state.lastUpload ? state.lastUpload.message : "Do a /reload in game to send data";
  $("tileStandings").textContent = state.lastStandings ? ago(state.lastStandings.at) : "Not written yet";
  $("tileStandingsNote").textContent = state.lastStandings ? state.lastStandings.message : "";
  $("tileCount").textContent = String(state.uploads);
  $("tileWatch").textContent = state.watching ?? "Not watching anything yet";
}

function addLog(entry) {
  const list = $("log");
  if (logCount === 0) list.textContent = "";
  logCount += 1;
  const row = document.createElement("div");
  const time = document.createElement("time");
  time.textContent = new Date(entry.time).toLocaleTimeString();
  const text = document.createElement("span");
  text.className = entry.level;
  text.textContent = entry.message;
  row.append(time, text);
  list.prepend(row);
  while (list.children.length > 300) list.lastChild.remove();
}

const fields = ["uploadUrl", "uploadToken", "guildDiscordId", "pairingCode", "watchFile", "realm", "wowGuild", "standingsIntervalMinutes"];
const readForm = () => Object.fromEntries(fields.map((id) => [id, $(id).value.trim()]));
const say = (text, ok) => { const el = $("formResult"); el.textContent = text; el.className = `result ${ok ? "ok" : "bad"}`; };

$("btnShow").addEventListener("click", () => {
  const input = $("uploadToken");
  input.type = input.type === "password" ? "text" : "password";
  $("btnShow").textContent = input.type === "password" ? "Show" : "Hide";
});

$("btnBrowse").addEventListener("click", async () => {
  const file = await api.browseFile();
  if (file) $("watchFile").value = file;
});

$("btnDetect").addEventListener("click", async () => {
  $("detectNote").textContent = "Looking...";
  const found = await api.detectWow();
  if (found.length === 0) { $("detectNote").textContent = "Nothing found. Press Browse and pick Guilded.lua (it appears after your first /reload in game with the addon)."; return; }
  $("watchFile").value = found[0].path;
  $("detectNote").textContent = found.length === 1
    ? (found[0].exists ? "Found it." : "Found your account folder. The file itself appears after your first /reload in game.")
    : `Found ${found.length} accounts. Using the first with data; pick another with Browse if that is wrong.`;
});

$("btnTest").addEventListener("click", async () => {
  say("Testing...", true);
  const result = await api.testConnection(readForm());
  say(result.message, result.ok);
});

$("btnPair").addEventListener("click", async () => {
  say("Linking Discord account...", true);
  const result = await api.pairAccount(readForm());
  say(result.message, result.ok);
  if (result.ok) $("pairingCode").value = "";
});

$("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  say("Saving...", true);
  const result = await api.saveConfig(readForm());
  say(result.message, result.ok);
  if (result.ok) showPage("status");
});

$("autostart").addEventListener("change", (event) => api.setAutostart(event.target.checked));

$("btnUpload").addEventListener("click", async () => { $("btnUpload").disabled = true; await api.uploadNow(); setTimeout(() => { $("btnUpload").disabled = false; }, 2000); });
$("btnStandings").addEventListener("click", async () => { $("btnStandings").disabled = true; await api.refreshStandings(); $("btnStandings").disabled = false; });
$("btnFolder").addEventListener("click", () => api.openAddonFolder());

async function init() {
  const all = await api.getAll();
  for (const id of fields) $(id).value = all.config[id] ?? "";
  $("autostart").checked = all.autostart;
  $("version").textContent = `Version ${all.version}`;
  for (const entry of all.logs.slice(-100)) addLog(entry);
  if (logCount === 0) { $("log").innerHTML = '<div class="empty">Nothing has happened yet.</div>'; }
  renderState({ state: all.state, health: all.health });
  const tab = new URLSearchParams(location.search).get("tab");
  showPage(tab || (all.health.level === "setup" ? "settings" : "status"));
  api.onState(renderState);
  api.onLog(addLog);
  // Keep "2 minutes ago" honest.
  setInterval(() => { if (lastSnapshot) renderState(lastSnapshot); }, 15000);
}
init();
