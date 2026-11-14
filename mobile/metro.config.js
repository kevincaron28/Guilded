// Guilded Clash is on hold (owner, 14 November 2026): hidden, not deleted. Unless a build sets
// EXPO_PUBLIC_GUILDED_CLASH=1, the game's only door (src/clash/entry) resolves to an empty module, so a
// bundle carries neither its code nor its card art. src/me/MeTab.tsx copes with the empty module.
/* global module, require, __dirname */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const clash = process.env.EXPO_PUBLIC_GUILDED_CLASH === '1';
const next = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // The request is the import as written in the source ("../clash/entry"), so it always uses forward slashes.
  if (!clash && /(^|\/)clash\/entry$/.test(moduleName)) return { type: 'empty' };
  return (next ?? context.resolveRequest)(context, moduleName, platform);
};
module.exports = config;
