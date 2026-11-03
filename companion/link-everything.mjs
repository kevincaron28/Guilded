// "Link everything": one status list for Discord, Battle.net and the in-game character proof.
// Presentation only. The bot stays authoritative: Discord comes from the personal credential on
// this PC, Battle.net and the characters from the bot's hub answer (`hub.link`, `hub.characters`),
// and nothing here sends or grants anything. Every text is an English key the window translates.

const DISCORD = {
  done: 'Discord linked',
  todo: 'Discord not linked',
  next: 'Press “Sign in with Discord”. Your browser opens; choose your server and press Connect.'
};

/** @param {any} [config] @param {any} [state] @param {any} [hub] */
export function linkSteps(config = {}, state = {}, hub = null) {
  const discord = Boolean(config.companionCredential);
  const personal = config.personal === true;
  const link = hub && typeof hub === 'object' ? hub.link : null;
  const characters = Array.isArray(hub?.characters) ? hub.characters.length : null;
  const wowFile = config.wowEnabled !== false && Boolean(state.watching || config.watchFile);
  const steps = [];

  steps.push({ id: 'discord', required: true, state: discord ? 'done' : 'todo', label: discord ? DISCORD.done : DISCORD.todo, next: discord ? null : DISCORD.next });

  // Optional by design: WoW Forever characters may not appear in Battle.net at all.
  let battle;
  if (!discord) battle = { state: 'waiting', label: 'Battle.net (optional)', next: 'Sign in with Discord first.' };
  else if (!link || typeof link.battleNet !== 'boolean') battle = { state: 'unknown', label: 'Battle.net (optional)', next: 'Optional: open Connect Battle.net to add characters it knows. WoW Forever characters may not appear there; that is fine.' };
  else if (link.battleNet) battle = { state: 'done', label: 'Battle.net linked', next: null };
  else battle = { state: 'optional', label: 'Battle.net not linked (optional)', next: 'Optional: connect Battle.net to find your Retail and Classic characters. Skip it if you play WoW Forever; the in-game proof below covers it.' };
  steps.push({ id: 'battlenet', required: false, ...battle });

  let proof;
  if (!discord) proof = { state: 'waiting', label: 'Characters not verified yet', next: 'Sign in with Discord first.' };
  else if (personal) proof = { state: 'optional', label: 'Characters (not needed for leaderboards only)', next: 'Your finished runs are sent without a guild, so no character check is needed.' };
  else if (characters) proof = { state: 'done', label: 'Characters verified', count: characters, next: null };
  else if (!wowFile) proof = { state: 'todo', label: 'Characters not verified yet', next: 'Press Find my saved data. The companion reads it and proves your characters itself; no code to type.' };
  else if (!state.lastUpload) proof = { state: 'todo', label: 'Characters not verified yet', next: 'In WoW, type /reload (or log out) so your data is saved. The companion then proves your characters by itself.' };
  else proof = { state: 'todo', label: 'Characters not verified yet', next: 'Sent, but no character matched yet. In WoW type /guilded verify once, then press Check my characters.' };
  steps.push({ id: 'characters', required: !personal, ...proof });

  const required = steps.filter(step => step.required);
  const complete = required.every(step => step.state === 'done');
  const nextStep = steps.find(step => step.required && step.state !== 'done') || null;
  return { steps, complete, nextStep, firstRun: !discord };
}

// One short line for the Home page: "Discord ✓ · Battle.net – · Characters ✓".
export function linkSummary(result) {
  const mark = step => step.state === 'done' ? '✓' : step.state === 'todo' ? '✗' : '–';
  const names = { discord: 'Discord', battlenet: 'Battle.net', characters: 'Characters' };
  return result.steps.map(step => `${names[step.id]} ${mark(step)}`).join(' · ');
}
