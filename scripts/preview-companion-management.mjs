// Offline UI acceptance fixture. Never loads credentials or contacts the bot/Discord.
// Run npm run companion:build first, then node scripts/preview-companion-management.mjs.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';

const root = resolve('companion-app/renderer');
const fixture = resolve('tests/fixtures/companion-management-ui.js');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2' };
createServer(async (request, response) => {
  try {
    if (request.method !== 'GET') { response.writeHead(405).end(); return; }
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const file = pathname === '/fixture.js' ? fixture : resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (file !== fixture && (!file.startsWith(root + sep) || !mime[extname(file)])) { response.writeHead(404).end(); return; }
    let content = await readFile(file);
    if (file === resolve(root, 'index.html')) content = content.toString()
      .replace('<script src="app.js"></script>', '<script src="fixture.js"></script>');
    response.writeHead(200, { 'content-type': `${mime[extname(file)]}; charset=utf-8`, 'cache-control': 'no-store' }).end(content);
  } catch { response.writeHead(404).end('Build with npm run companion:build first.'); }
}).listen(8802, '127.0.0.1', () => console.log('Offline management fixture: http://127.0.0.1:8802/?tab=cores (synthetic data, no network writes)'));
