/* Browser-only offline acceptance fixture; excluded from shipped companion assets. */
/* global document, location, window */
(() => {
  const $ = id => document.getElementById(id);
  const member = new URLSearchParams(location.search).get('member') === '1';
  const own = { description: 'Fixture description', realm: 'Fixture realm', lootMode: 'EPGP', attendanceEp: 10, lateEp: 5, bossEp: 5, completionEp: 10, baseGp: 100, decayPercent: 10, reservesPerPlayer: 2, offspecPercent: 50, minEp: 0 };
  const data = {
    me: { raidLeader: !member }, coreLootOnly: false, lootModes: ['EPGP', 'COUNCIL', 'RESERVE', 'PRIORITY'],
    itemNames: ['Sulfuras'], guildPrices: [],
    characters: [{ id: 'character', name: 'Save', isMain: true, wishlist: [{ itemName: 'Sulfuras', priority: 1 }] }],
    members: [{ id: 'member', displayName: 'Fixture player', characters: [{ name: 'Save' }, { name: 'Run' }] }, { id: 'new-member', displayName: 'Fixture newcomer', characters: [{ name: 'Newcomer' }] }],
    cores: [{ id: 'core', name: 'Fixture core', own, effective: { ...own, separatePool: false }, prices: [{ name: 'Sulfuras', id: 17182, gp: 250 }], members: [{ memberId: 'member', name: 'Fixture player', character: 'Save', role: 'DPS', bench: false, backups: [] }] }]
  };
  const panel = document.createElement('aside');
  panel.className = 'panel';
  panel.innerHTML = '<h2>OFFLINE TEST — synthetic data only</h2><label>Save result<select id="fixtureOutcome"><option value="fail">Refused</option><option value="throw">Disconnected</option><option value="success">Success</option><option value="hold">Hold until resolved</option></select></label><button id="fixtureResolve">Resolve pending save as refused</button><p id="fixtureCalls">0 save requests</p><textarea id="fixturePayload" readonly aria-label="Last synthetic request"></textarea>';
  document.querySelector('.workspace').prepend(panel);
  let requests = 0, resolvePending;
  window.companion = {
    manageView: async () => ({ ok: true, data: structuredClone(data) }),
    manageEdit: async body => {
      $('fixtureCalls').textContent = `${++requests} save requests`;
      $('fixturePayload').textContent = JSON.stringify(body);
      const mode = $('fixtureOutcome').value;
      if (mode === 'throw') throw new Error('Fixture connection lost');
      if (mode === 'hold') return new Promise(resolve => { resolvePending = resolve; });
      if (mode === 'success') {
        if (body.action === 'core.update') Object.assign(own, body.changes);
        return { ok: true, data: { message: 'Saved.' } };
      }
      return { ok: false, error: 'That change was not saved.' };
    }
  };
  $('fixtureResolve').addEventListener('click', () => { resolvePending?.({ ok: false, error: 'That change was not saved.' }); resolvePending = null; });
  $('language').addEventListener('change', () => window.companionLanguage.set($('language').value, false));
  document.querySelectorAll('.page').forEach(page => { page.hidden = !['page-cores', 'page-wishlist'].includes(page.id); });
  document.querySelectorAll('.nav').forEach(button => { button.disabled = true; });
})();
