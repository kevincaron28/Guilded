import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { WOW_EDITIONS, editionPages } from '../site/editions.mjs';
import { GAME_EDITIONS } from '../companion/game-edition.mjs';

beforeAll(() => execFileSync(process.execPath, ['scripts/build-site.mjs'], { stdio: 'pipe' }), 30000);
const page = path => readFileSync(`dist/site/${path}`, 'utf8');
const published = JSON.parse(readFileSync('site/releases.json', 'utf8')).guilded.github.version;
const curseforge = JSON.parse(readFileSync('site/releases.json', 'utf8')).guilded.curseforge;

describe('edition-specific downloads', () => {
  it('offers every packaged client and makes the choice available before features', () => {
    expect(WOW_EDITIONS.map(edition => edition.id)).toEqual([...GAME_EDITIONS]);
    const home = page('index.html');
    expect(home.indexOf('id="wow-versions"')).toBeLessThan(home.indexOf('id="features"'));
    expect(home).toContain('href="#wow-versions"');
    for (const edition of WOW_EDITIONS) expect(home).toContain(`href="/editions/${edition.id}/"`);
    expect(home).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });

  it.each(WOW_EDITIONS)('keeps $id downloads, metadata and language alternatives together', edition => {
    const html = page(`editions/${edition.id}/index.html`);
    expect(html).toContain(`<strong>${edition.name}</strong>`);
    expect(html).toContain('aria-current="page"');
    const downloads = [...html.matchAll(/href="(https:\/\/github\.com\/[^" ]+\.zip)"/g)].map(match => match[1]);
    expect(downloads).toEqual(['Guilded', 'GuildedDungeons'].map(addon => `https://github.com/kevincaron28/Guilded/releases/download/v${published}/${addon}-v${published}-${edition.id}.zip`));
    expect(html).toContain(`href="https://guilded.kcaron.top/editions/${edition.id}/?lang=fr"`);
    expect(html).toContain('data-fr="Installer dans le bon dossier de jeu"');
    expect(html).toContain('https://apps.microsoft.com/detail/9N680XX3QFL9');
    const query = edition.id === 'forever' ? '' : `?edition=${edition.id}`;
    for (const path of ['/leaderboards/', '/recruitment/', '/players/']) expect(html).toContain(`href="${path}${query}"`);
    if (curseforge.version === published) {
      for (const url of Object.values(curseforge.editions?.[edition.id] ?? {})) expect(html).toContain(`href="${url}"`);
    }
    expect(html).not.toContain('undefined');
    const sitemap = page('sitemap.xml');
    expect(sitemap).toContain(`https://guilded.kcaron.top/editions/${edition.id}/?lang=fr`);
    expect(sitemap).toContain(`https://guilded.kcaron.top/editions/${edition.id}/</loc>`);
  });

  it('does not label an older CurseForge file as the current GitHub release', () => {
    const older = { version: '0.0.1', editions: { retail: { guilded: 'https://example.invalid/old-file' } } };
    const retail = editionPages(published, older).find(page => page.path === 'editions/retail/');
    expect(retail.body).not.toContain('https://example.invalid/old-file');
  });

  it('routes edition pages through the Worker for server-rendered French', () => {
    const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
    expect(config.assets.run_worker_first).toEqual(expect.arrayContaining(['/editions', '/editions/*']));
  });
});

// 29 October 2026 website review: new pages, search listing, lighter images, plain wording.
describe('website refresh', () => {
  it('publishes the officer and Forever pages in both languages, with server-rendered French', () => {
    for (const path of ['officers', 'forever']) {
      const html = page(`${path}/index.html`);
      expect(html).toContain(`<link rel="canonical" href="https://guilded.kcaron.top/${path}/">`);
      expect(html).toContain(`hreflang="fr" href="https://guilded.kcaron.top/${path}/?lang=fr"`);
      expect(html).toContain('data-language-copy="fr"');
      expect(html).toContain('<details class="nav-group has-current" data-nav-group="help">');
    }
    const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
    expect(config.assets.run_worker_first).toEqual(expect.arrayContaining(['/officers', '/officers/*', '/forever', '/forever/*']));
  });

  it('lists the public data pages and the guild-page sitemap for search engines', () => {
    const sitemap = page('sitemap.xml');
    for (const path of ['/leaderboards/', '/recruitment/guilds/', '/players/', '/officers/', '/forever/']) expect(sitemap).toContain(`<loc>https://guilded.kcaron.top${path}</loc>`);
    expect(page('robots.txt')).toContain('Sitemap: https://guilded.kcaron.top/recruitment/guilds/sitemap.xml');
  });

  it('uses light images and a large link preview', () => {
    expect(statSync('dist/site/logo-88.webp').size).toBeLessThan(10_000);
    expect(statSync('dist/site/logo.png').size).toBeLessThan(150_000);
    const home = page('index.html');
    expect(home).toContain('<meta property="og:image" content="https://guilded.kcaron.top/images/social/guilded-card.png">');
    expect(home).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect([...home.matchAll(/<img src="([^"]+)"/g)].map(match => match[1]).filter(src => src.endsWith('.png'))).toEqual([]);
    expect(page('docs/QUICK_START.html')).toContain('images/social/guilded-card.png');
    expect(page('editions/forever/index.html')).toContain('href="../../favicon.png"');
  });

  it('adds no analytics script or policy change until a beacon token is configured', () => {
    expect(JSON.parse(readFileSync('site/analytics.json', 'utf8')).cloudflareBeaconToken).toBe('');
    expect(page('index.html')).not.toContain('cloudflareinsights');
    expect(page('_headers')).not.toContain('cloudflareinsights');
  });

  it('keeps release-process wording off the public download pages', () => {
    for (const html of [page('index.html'), page('editions/forever/index.html'), page('docs/QUICK_START.html')]) {
      for (const phrase of ['in-game checks remain pending', 'Build availability does not mean', 'Store certification', 'not measured acceptance results']) expect(html).not.toContain(phrase);
    }
    expect(page('editions/forever/index.html')).toContain('href="/forever/"');
  });
});
