// Presentation only: never translate protocol fields, file paths or user-entered data.
const fr = require('./locales/fr.json');
const normalizeLanguage = value => /^fr(?:[-_]|$)/i.test(value || '') ? 'fr' : 'en';
function translate(language, key, ...values) {
  const template = normalizeLanguage(language) === 'fr' ? fr[key] ?? key : key;
  return String(template).replace(/\{(\d+)\}/g, (match, index) => values[Number(index)] === undefined ? match : String(values[Number(index)]));
}

// Engine/server diagnostics remain English internally. Translate only catalogued
// messages at the display boundary; unknown external diagnostics remain verbatim.
const leadingDiagnostics = new Set([
  '{0} Select this connection to write scores to the shared addon folder.',
  '{0} completed observations found in the latest 24 hours{1}. Review the character and league, then Sync now.',
  "{0}. Check the Discord server ID: Discord Settings, Advanced, Developer Mode, then right-click your server and Copy Server ID again — paste it in exactly, don't retype it.",
  '{0} Public scores could not be saved to GuildedDungeons/Accepted.lua. Check the addon folder and try again.',
  "{0} is on {1}'s wishlist.", '{0} had no price set for {1}.', '{0} is in {1} ({2}{3}).',
  '{0} brings {1} to {2}.', '{0} can also bring {1} ({2}) to {3}.',
  '{0} is no longer a backup of {1} in {2}.'
]);
const patterns = Object.keys(fr).filter(key => /\{\d+\}/.test(key) && (!key.startsWith('{') || leadingDiagnostics.has(key)))
  .sort((a, b) => b.replace(/\{\d+\}/g, '').length - a.replace(/\{\d+\}/g, '').length).map(key => {
  const slots = [];
  const source = key.split(/(\{\d+\})/).map(part => {
    const slot = /^\{(\d+)\}$/.exec(part);
    if (slot) { slots.push(Number(slot[1])); return '([\\s\\S]*?)'; }
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('');
  return { key, slots, expression: new RegExp(`^${source}$`) };
});
function message(language, value) {
  if (typeof value !== 'string' || normalizeLanguage(language) !== 'fr') return value;
  if (Object.hasOwn(fr, value)) return fr[value];
  // 9.3.0 dungeon run report (companion/run-report.mjs): "Dungeon runs: 3 sent, 2 stored, 1 not counted (Not completed)."
  // The same line for a guild Guilded parked: "Dungeon runs of Name-Realm: 2 sent, 2 stored."
  const parkedReport = /^Dungeon runs of (.+?): ([\s\S]*)$/.exec(value);
  if (parkedReport) { const inner = message(language, `Dungeon runs: ${parkedReport[2]}`); if (inner !== `Dungeon runs: ${parkedReport[2]}`) return inner.replace('Parcours de donjon :', `Parcours de donjon de ${parkedReport[1]} :`); }
  const parkedWait = /^(\d+) dungeon runs? of (.+) wait: log in on a character of that guild or link that server\.$/.exec(value);
  if (parkedWait) return `${parkedWait[1]} parcours de donjon de ${parkedWait[2]} en attente : connectez-vous avec un personnage de cette guilde ou liez ce serveur.`;
  const runReport = /^Dungeon runs: (\d+) sent((?:, \d+ (?:stored|copied from a guildmate|waiting for a second player|not confirmed yet|not counted \([\s\S]*?\)))*)\.$/.exec(value);
  if (runReport) {
    const names = { stored: 'enregistré(s)', 'copied from a guildmate': 'copie(s) du parcours d’un membre de la guilde', 'waiting for a second player': 'en attente d’un second joueur', 'not confirmed yet': 'pas encore confirmé(s)' };
    const parts = [...runReport[2].matchAll(/, (\d+) (stored|copied from a guildmate|waiting for a second player|not confirmed yet|not counted \(([\s\S]*?)\))(?=,|$)/g)].map(match => match[3] !== undefined
      ? `${match[1]} non compté(s) (${match[3].split('; ').map(reason => message(language, reason)).join(' ; ')})`
      : `${match[1]} ${names[match[2]]}`);
    return `Parcours de donjon : ${[`${runReport[1]} envoyé(s)`, ...parts].join(', ')}.`;
  }
  const publicResult = /^Public leaderboards: (\d+) new, (\d+) confirmed, (\d+) already sent(?:, (\d+) refused \(([\s\S]*)\))?\.$/.exec(value);
  if (publicResult) return translate(language, 'Public leaderboards: {0} new, {1} confirmed, {2} already sent{3}.',
    publicResult[1], publicResult[2], publicResult[3], publicResult[4] ? translate(language, ', {0} refused ({1})', publicResult[4], publicResult[5]) : '');
  for (const { key, slots, expression } of patterns) {
    const match = expression.exec(value);
    if (!match) continue;
    const args = [];
    slots.forEach((slot, index) => { args[slot] = match[index + 1]; });
    // Only these slots are authored diagnostics. All other slots can contain
    // names, paths or item text and must remain exactly as supplied.
    if (key === '{0} Select this connection to write scores to the shared addon folder.') args[0] = message(language, args[0]);
    if (key === 'Not started: {0}') args[0] = message(language, args[0]);
    if (key === 'Connected. PoE2 tracking is {0}.') args[0] = translate(language, args[0]);
    if (key === 'Account connected. PoE2 sharing is {0}.') args[0] = translate(language, args[0]);
    if (key.startsWith('{0} completed observations')) args[1] = translate(language, args[1]);
    if (key.startsWith('Uploaded and applied automatically')) {
      args[2] = '';
      args[3] = translateNotes(language, `${match[3]}${match[4]}`);
    } else if (key === 'Nothing new since the last upload.{0}' || key.startsWith('Professions and recipes synced.')) {
      args[0] = translateNotes(language, args[0]);
    } else if (key === 'Uploaded {0} ledger entries. Apply on Discord with: /import apply id:{1}.{2}') {
      args[2] = translateNotes(language, args[2]);
    }
    return translate(language, key, ...args);
  }
  return value;
}
function translateNotes(language, value) {
  // These suffixes are assembled by engine.mjs, not supplied by a member.
  const keys = Object.keys(fr).filter(key => key.startsWith(' ') || /^\{0\} (on hold:|voided in game|unreadable row)/.test(key));
  let result = value;
  for (const key of keys) {
    const pattern = key.split('{0}').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(\\d+)');
    result = result.replace(new RegExp(pattern, 'g'), (_match, count) => translate(language, key, count));
  }
  return result;
}
module.exports = { normalizeLanguage, translate, message };
