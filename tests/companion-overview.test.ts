import { describe, expect, it } from 'vitest';
import { companionOverview } from '../companion/overview.mjs';

describe('companion overview readiness', () => {
  it('requires an account and selected source before offering sync', () => {
    expect(companionOverview({}, {}).canSync).toBe(false);
    expect(companionOverview({ watchFile: 'local.lua' }, {}).canSync).toBe(false);
    expect(companionOverview({ companionCredential: 'fixture' }, {}).canSync).toBe(false);
    expect(companionOverview({ companionCredential: 'fixture', watchFile: 'local.lua' }, {}).canSync).toBe(true);
  });
  it('does not count disabled games or opt-in PoE2 without a log', () => {
    expect(companionOverview({ companionCredential: 'fixture', wowEnabled: false, watchFile: 'old.lua', poeLogFile: 'Client.txt' }, {}).selectedFiles).toBe(0);
    expect(companionOverview({ companionCredential: 'fixture', wowEnabled: false, poeEnabled: true, poeLogFile: 'Client.txt' }, {}).canSync).toBe(true);
  });
  it('distinguishes paused desktop tracking, manual browser sync and a completed refresh', () => {
    const config = { companionCredential: 'fixture', watchFile: 'local.lua' };
    expect(companionOverview(config, { running: false }).tracking).toBe('Tracking paused');
    expect(companionOverview(config, {}, true).tracking).toBe('Manual browser sync');
    expect(companionOverview(config, {}).standings).toBe('Not refreshed yet');
    expect(companionOverview(config, { lastStandings: { at: '2026-10-19T00:00:00Z' } }).standings).toBe('Standings refreshed');
  });
  it('does not imply guild standings for an existing personal connection', () => {
    expect(companionOverview({ personal: true }, {}).standings).toBe('Not used by this connection');
  });
});
