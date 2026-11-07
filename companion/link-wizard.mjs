// First-run wizard on the Link everything page (8.5 Track L, effortless linking; Guilded Setup,
// owner batch 3 #3): four steps, WoW and the addon -> Discord -> your guild's server -> your characters, with what to do at each, a "Something's
// wrong?" check list for the step in progress, and the success screen. Presentation only: the bot
// stays authoritative. Every text is an English key (with {0} slots) the window translates.

/**
 * @param {{ config?: any, state?: any, hub?: any, me?: any, problems?: { id: string }[], savedFile?: any }} input
 */
export function linkWizard({ config = {}, state = {}, hub = null, me = null, problems = [], savedFile = null, autoTried = false } = {}) {
  const signedIn = Boolean(config.companionCredential);
  const personal = signedIn && config.personal === true;
  const characters = Array.isArray(hub?.characters) ? hub.characters : [];
  const server = typeof hub?.guild?.name === "string" && hub.guild.name ? hub.guild.name : null;
  const has = (id) => problems.some((problem) => problem?.id === id);

  // Step 1, Guilded Setup: WoW found and the Guilded addon in it (or WoW off in this companion).
  const wow = config.wowEnabled !== false;
  const watched = wow && Boolean(state.watching || config.watchFile);
  const addonStatus = savedFile?.addon?.status;
  const addonFine = !has("addon-missing") && !has("addon-wrong-edition") && addonStatus !== "not-installed" && addonStatus !== "wrong-edition";
  const wowDone = !wow || (addonFine && (watched || addonStatus === "ok"));
  const discordDone = signedIn;
  const serverDone = signedIn && !personal;
  const charactersDone = serverDone && characters.length > 0;
  const current = !wowDone ? "wow" : !discordDone ? "discord" : !serverDone ? "server" : !charactersDone ? "characters" : null;
  const stepState = (id, done) => done ? "done" : current === id ? "current" : "todo";
  const steps = [
    { id: "wow", label: "WoW and the Guilded addon", state: stepState("wow", wowDone) },
    { id: "discord", label: "Sign in with Discord", state: stepState("discord", discordDone) },
    { id: "server", label: "Your guild's Discord server", state: stepState("server", serverDone) },
    { id: "characters", label: "Your characters", state: stepState("characters", charactersDone) }
  ];

  // Step 2 for a member whose Discord account is not in the guild's server yet.
  let join = null;
  if (current === "server") {
    const target = me?.join ?? null;
    if (target?.joined) join = { kind: "joined", server: target.serverName, text: ["You joined {0}. Linking it now: approve in your browser.", target.serverName] };
    else if (target?.inviteUrl) join = { kind: "invite", server: target.serverName, inviteUrl: target.inviteUrl, text: ["Your WoW guild uses {0} on Discord, but your Discord account is not in it yet. Join it, then the companion continues by itself.", target.serverName] };
    else if (target) join = { kind: "ask", server: target.serverName, text: ["Your WoW guild uses {0} on Discord. Ask an officer for its invite, join, then press Link to my guild.", target.serverName] };
    else join = { kind: "unknown", server: null, text: ["Signed in, but you're not in a Discord server that uses Guilded yet. Join your guild's Discord, then press Link to my guild."] };
  }

  // Step 1 runs by itself (autoStep below): the companion looks for WoW on every drive and installs
  // the addon. Only when that could not finish does it ask, and only then shows Choose WoW folder.
  const setupHelp = current === "wow" ? (autoTried ? {
    text: !addonFine ? "The companion could not install the Guilded addon by itself. Exit World of Warcraft, then press Try again." : "The companion could not find your WoW account by itself. Choose your WoW folder, or press Try again.",
    button: "Try again", chooseFolder: addonFine
  } : { text: "Setting up WoW and the Guilded addon: looking on every drive…", button: null, chooseFolder: false }) : null;

  // Step 4: where characters come from, and why they may not be there yet.
  const charactersHelp = current === "characters" ? {
    text: "Your characters come from the Guilded addon: play a character with the addon on, type /reload, and the companion proves it is yours. Battle.net is optional on WoW Forever.",
    canDetect: watched
  } : null;

  // "Something's wrong?": checks for the step in progress, each ok or not, with what to do.
  const check = (ok, text, fix) => ({ ok, text, fix: ok ? null : fix });
  const reachable = !has("bot-unreachable");
  let diagnostics = [];
  if (current === "wow") diagnostics = [
    check(watched || addonStatus === "ok" || addonStatus === "not-installed", "World of Warcraft is found on this PC", "Press Try again, or choose your WoW folder in Settings."),
    check(addonFine, "The Guilded addon is installed", "Exit World of Warcraft, then press Try again.")
  ];
  else if (current === "discord") diagnostics = [
    check(reachable, "Guilded's server answers", "Guilded's server is restarting or unreachable. Wait a minute and try again."),
    check(true, "Your browser opens the sign-in page", "Press Reopen the page. The browser may be behind this window or in the taskbar."),
    check(true, "Discord may ask you to confirm a new login location", "Open the email from Discord, choose Yes, it's me, then come back. Or log in with the QR code using the Discord app on your phone.")
  ];
  else if (current === "server") diagnostics = [
    check(reachable, "Guilded's server answers", "Guilded's server is restarting or unreachable. Wait a minute and try again."),
    check(Boolean(me?.join), "Your WoW guild is found on Discord", "Log in to WoW once with the Guilded addon and type /reload, so the companion knows your guild. Or ask an officer for the Discord invite."),
    check(Boolean(me?.join?.joined), "Your Discord account is in the guild's server", me?.join?.inviteUrl ? "Press Join, accept the invite in Discord, then wait here." : "Ask an officer for the Discord invite and join.")
  ];
  else if (current === "characters") diagnostics = [
    check(reachable, "Guilded's server answers", "Guilded's server is restarting or unreachable. Wait a minute and try again."),
    check(watched, "Your WoW folder is chosen", "Open Settings and press Choose WoW folder."),
    check(!has("addon-missing") && !has("addon-wrong-edition"), "The Guilded addon is installed", "Open Problems and press Install addon."),
    check(!has("saved-file-missing") && !has("saved-file-not-updated") && savedFile?.changedAt !== null, "WoW saved your Guilded data", "In WoW, tick Guilded in AddOns, log in and type /reload."),
    check(Boolean(state.lastUpload), "The companion sent your data", "Press Detect now, then type /reload in WoW.")
  ];

  const names = characters.map((c) => c.displayName || c.name).filter((name) => typeof name === "string" && name);
  const success = charactersDone ? { server: server ?? "", names: names.slice(0, 10), more: Math.max(0, names.length - 10) } : null;
  return { steps, current, join, setupHelp, charactersHelp, diagnostics, success, identity: signedIn && me?.account ? me.account : null };
}

/**
 * The key that marks a success screen as already shown on this PC (one per server and account).
 * @param {any} [config] @param {any} [me]
 */
export function successKey(config = {}, me = null) {
  const who = me?.account?.username || "";
  return `${config.guildDiscordId || ""}:${who}`;
}

/** Detect now: the next save of Guilded.lua after `since` (ISO), or null while still waiting. */
export function savedSince(savedFile, since) {
  const at = savedFile && typeof savedFile.changedAt === "string" ? Date.parse(savedFile.changedAt) : NaN;
  const from = typeof since === "string" ? Date.parse(since) : NaN;
  return Number.isFinite(at) && Number.isFinite(from) && at > from ? savedFile.changedAt : null;
}

/**
 * What the wizard does by itself next (owner, 7 November 2026: automatic setup). Each automatic step
 * runs once per run of the companion; after that the member gets the button.
 * @param {{ current?: string | null } | null} wizard  linkWizard's answer
 * @param {{ wow?: boolean, signIn?: boolean, visible?: boolean, signInBusy?: boolean }} [done]
 * @returns {"setup-wow" | "sign-in" | null}
 */
export function autoStep(wizard, { wow = false, signIn = false, visible = true, signInBusy = false } = {}) {
  if (!wizard || !visible) return null;
  if (wizard.current === "wow" && !wow) return "setup-wow";
  // The browser opens by itself once; never while a sign-in is already waiting.
  if (wizard.current === "discord" && !signIn && !signInBusy) return "sign-in";
  return null;
}
