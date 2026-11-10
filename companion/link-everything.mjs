// "Link everything": one status list for Discord, Battle.net and the in-game character proof.
// Presentation only. The bot stays authoritative: Discord comes from the personal link on this PC,
// Battle.net and the characters from the bot's hub answer (`hub.link`, `hub.characters`), and nothing
// here sends or grants anything. Every text is an English key (with {0} slots) the window translates.
// Wording is everyday words only: a step is either "linked as ..." or "not linked yet" with one action.

export const ALREADY_LINKED = 'Already linked, nothing to do.';
export const NOT_IN_A_GUILD_SERVER = "Signed in, but you're not in a Discord server that uses Guilded yet. Join your guild's Discord, then press Link to my guild.";

/** @param {any} [config] @param {any} [state] @param {any} [hub] */
export function linkSteps(config = {}, state = {}, hub = null) {
  const discord = Boolean(config.companionCredential);
  const personal = config.personal === true;
  const link = hub && typeof hub === 'object' ? hub.link : null;
  const characters = Array.isArray(hub?.characters) ? hub.characters.length : null;
  const server = typeof hub?.guild?.name === 'string' && hub.guild.name ? hub.guild.name : null;
  const wowFile = config.wowEnabled !== false && Boolean(state.watching || config.watchFile);
  // Zero-setup companion (9.1.0): syncing with the device key, no Discord sign-in. The sign-in is an
  // optional extra that confirms the characters (they count as "reported" until then).
  const device = !discord && config.device === true && Boolean(config.deviceSecret) && config.wowEnabled !== false;
  const reported = device && state.device?.status === 'synced' ? Number(state.device.characters) || 0 : 0;
  const steps = [];

  steps.push(device ? {
    id: 'discord', required: false, state: 'optional', label: 'Discord sign-in (optional)', args: [],
    next: 'Optional: sign in with Discord to confirm your characters as yours. Syncing works without it.'
  } : {
    id: 'discord', required: true, state: discord ? 'done' : 'todo',
    label: discord ? (personal ? 'Signed in for public dungeon rankings only' : server ? 'Discord linked to {0}' : 'Discord linked') : 'Discord not linked yet',
    args: discord && server ? [server] : [],
    next: discord ? null : 'Press “Sign in with Discord”. Your browser opens; choose your server and press Connect.'
  });

  // Optional by design: WoW Forever characters may not appear in Battle.net at all.
  let battle;
  if (device) battle = { state: 'optional', label: 'Battle.net (optional)', next: null };
  else if (!discord) battle = { state: 'waiting', label: 'Battle.net (optional)', next: 'Sign in with Discord first.' };
  else if (!link || typeof link.battleNet !== 'boolean') battle = { state: 'unknown', label: 'Battle.net (optional)', next: 'Optional: open Connect Battle.net to add characters it knows. WoW Forever characters may not appear there; that is fine.' };
  else if (link.battleNet) battle = typeof link.battleTag === 'string' && link.battleTag
    ? { state: 'done', label: 'Battle.net linked as {0}', args: [link.battleTag], next: null }
    : { state: 'done', label: 'Battle.net linked', next: null };
  else battle = { state: 'optional', label: 'Battle.net not linked (optional)', next: 'Optional: connect Battle.net to find your Retail and Classic characters. Skip it if you play WoW Forever; the in-game proof below covers it.' };
  steps.push({ id: 'battlenet', required: false, args: [], ...battle });

  let proof;
  if (device && reported > 0) proof = { state: 'done', label: '{0} character(s) reported', args: [reported], next: 'Sign in with Discord to confirm them (optional).' };
  else if (device) proof = { state: 'todo', label: 'Characters not reported yet', next: 'Log in to WoW and type /reload once: your characters are reported by themselves.' };
  else if (!discord) proof = { state: 'waiting', label: 'Characters not found yet', next: 'Sign in with Discord first.' };
  // Leaderboards only usually means the Discord account is in no server that uses Guilded yet (the
  // sign-in page picks it when there is none). Say so, and never "everything is linked" (8.5 fresh-PC test).
  else if (personal) proof = { state: 'todo', label: 'No guild server yet', next: NOT_IN_A_GUILD_SERVER };
  else if (characters) proof = { state: 'done', label: '{0} character(s) linked', args: [characters], next: null };
  else if (!wowFile) proof = { state: 'todo', label: 'Characters not found yet', next: 'Press Find my addon data, then log in to WoW once and we will find your characters.' };
  else if (!state.lastUpload) proof = { state: 'todo', label: 'Characters not found yet', next: 'Log in to WoW once and we will find your characters. Type /reload or log out so your data is saved.' };
  else proof = { state: 'todo', label: 'Characters not found yet', next: 'Sent, but no character matched yet. Press Check my characters in a minute; if it stays empty, open Discord, type /character claim and pick yours.' };
  steps.push({ id: 'characters', required: !personal, args: [], ...proof });

  const required = steps.filter(step => step.required);
  const complete = !personal && required.every(step => step.state === 'done');
  const nextStep = steps.find(step => step.required && step.state !== 'done') || null;
  return { steps, complete: complete || (device && reported > 0), nextStep, firstRun: !discord && !device, device };
}

// One short line for the Home page: "Discord ✓ · Battle.net – · Characters ✓".
export function linkSummary(result) {
  const mark = step => step.state === 'done' ? '✓' : step.state === 'todo' ? '✗' : '–';
  const names = { discord: 'Discord', battlenet: 'Battle.net', characters: 'Characters' };
  return result.steps.map(step => `${names[step.id]} ${mark(step)}`).join(' · ');
}

// The character table: one row per character with its WoW guild and rank, its Discord server and
// whether the bot has it linked to the signed-in account (every row the bot returns is).
export function characterRows(hub) {
  if (!Array.isArray(hub?.characters)) return [];
  return hub.characters.map(c => ({
    name: c.displayName || c.name,
    realm: [c.realm, c.edition].filter(Boolean).join(' · '),
    wowGuild: c.guild?.name || '',
    rank: c.rank || '',
    server: c.guild?.serverName || '',
    linked: true
  }));
}
