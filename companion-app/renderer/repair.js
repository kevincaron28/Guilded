// Repair (8.5, owner batch 3 #3). One button on Home, on Problems and in the setup wizard: the
// desktop app re-checks the WoW folder, the addon, the sign-in, the link and the sync, fixes what it
// can (companion-app/repair.cjs) and this dialog says what it did, step by step.
(() => {
  const api = window.companion;
  if (!api?.repair) return;
  const $ = id => document.getElementById(id);
  const T = (key, ...args) => window.companionLanguage.t(key, ...args);
  const BUTTONS = ['btnRepair', 'btnRepairProblems', 'btnWizardRepair', 'btnWizardSetup'];
  const statusText = { ok: () => T('OK'), fixed: () => T('Fixed'), 'needs-you': () => T('Needs you'), failed: () => T('Not fixed') };
  const statusClass = { ok: 'ok', fixed: 'fixed', 'needs-you': 'bad', failed: 'bad' };

  async function run() {
    const buttons = BUTTONS.map($).filter(Boolean);
    buttons.forEach(button => { button.disabled = true; });
    $('repairSummary').textContent = T('Checking and fixing...');
    $('repairResults').replaceChildren();
    if (!$('repairDialog').open) $('repairDialog').showModal();
    try {
      const { results, summary } = await api.repair();
      for (const item of results) {
        const row = document.createElement('li');
        row.className = statusClass[item.status] || 'bad';
        const label = document.createElement('strong');
        label.textContent = (statusText[item.status] || statusText.failed)() + ' · ';
        row.append(label, document.createTextNode(T(...item.text)));
        $('repairResults').append(row);
      }
      $('repairSummary').textContent = summary.fixed + summary.needsYou + summary.failed === 0
        ? T('Everything was checked. Nothing needed fixing.')
        : T('{0} fixed, {1} need you, {2} could not be fixed.', summary.fixed, summary.needsYou, summary.failed);
      // Pages that show links, characters or the folder load again.
      document.dispatchEvent(new CustomEvent('companion-connection-changed'));
    } catch (error) {
      $('repairSummary').textContent = error?.message || T('This action could not be completed.');
    } finally {
      buttons.forEach(button => { button.disabled = false; });
    }
  }

  for (const id of BUTTONS) $(id)?.addEventListener('click', () => void run());
  $('btnRepairClose').addEventListener('click', () => $('repairDialog').close());
  // The website links in the menu open in the member's language.
  const webLinks = () => {
    for (const link of document.querySelectorAll('.web-link')) {
      try { const url = new URL(link.href); url.searchParams.set('lang', window.companionLanguage.language); link.href = url.href; } catch { /* keep the link */ }
    }
  };
  webLinks();
  document.addEventListener('companion-language', webLinks);
})();
