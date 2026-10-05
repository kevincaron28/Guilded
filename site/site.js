const form = document.querySelector('#open-companion');
form?.addEventListener('submit', event => {
  event.preventDefault();
  const result = document.querySelector('#address-result');
  try {
    const url = new URL(document.querySelector('#guild-address').value.trim());
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Use your guild’s HTTPS address without a username, password or token.');
    const guild = url.searchParams.get('guild');
    url.pathname = '/companion/'; url.search = ''; url.hash = '';
    if (guild && /^\d{17,20}$/.test(guild)) url.searchParams.set('guild', guild);
    const link = document.createElement('a'); link.href = url.href; link.textContent = 'Continue to ' + url.hostname + ' →';
    result.replaceChildren(link);
  } catch (error) { result.textContent = error.message || 'Enter your guild’s complete HTTPS address.'; }
});
for (const block of document.querySelectorAll('pre')) {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'copy'; button.textContent = 'Copy';
  button.setAttribute('aria-label','Copy this command block');
  button.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(block.querySelector('code').textContent); button.textContent = 'Copied'; }
    catch { button.textContent = 'Select and copy the text'; }
  });
  block.before(button);
}
