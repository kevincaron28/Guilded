// Marks the header link for the section being read. Without JavaScript every link still jumps to its section.
(() => {
  const pairs = [...document.querySelectorAll('.page-links a[href^="#"]')]
    .map(link => [link, document.getElementById(link.getAttribute('href').slice(1))])
    .filter(([, section]) => section);
  if (!pairs.length) return;
  const header = document.querySelector('.site-header');
  let frame = 0;
  const update = () => {
    frame = 0;
    const line = (header ? header.offsetHeight : 0) + 96;
    let current = null;
    for (const [link, section] of pairs) if (section.getBoundingClientRect().top <= line) current = link;
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = pairs[pairs.length - 1][0];
    for (const [link] of pairs) {
      if (link === current) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
  };
  const schedule = () => { if (!frame) frame = window.requestAnimationFrame(update); };
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  update();
  // site.js closes the menu on Escape from inside the header; this covers focus elsewhere and taps outside it.
  const toggle = document.querySelector('.menu-toggle');
  const closeMenu = () => { if (header && toggle && header.classList.contains('is-open')) toggle.click(); };
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });
  document.addEventListener('click', event => { if (header && !header.contains(event.target)) closeMenu(); });
})();
