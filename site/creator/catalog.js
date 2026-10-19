(() => {
  const buttons = [...document.querySelectorAll('[data-project-filter]')];
  const cards = [...document.querySelectorAll('[data-stage]')];
  const count = document.querySelector('#project-count');
  if (!buttons.length || !count) return;
  for (const button of buttons) button.addEventListener('click', () => {
    const filter = button.dataset.projectFilter;
    for (const choice of buttons) choice.setAttribute('aria-pressed', String(choice === button));
    for (const card of cards) card.hidden = filter !== 'all' && card.dataset.stage !== filter;
    count.textContent = `${cards.filter(card => !card.hidden).length} / ${cards.length}`;
  });
})();
