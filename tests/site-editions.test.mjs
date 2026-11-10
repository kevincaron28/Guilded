import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { WOW_EDITIONS, editionPages } from '../site/editions.mjs';
import { editionSection } from '../site/nav.mjs';

// Guilded supports WoW Forever only (docs/plans/FOREVER_ONLY_REMOVAL.md): the build makes the WoW Forever pages only.
beforeAll(() => execFileSync(process.execPath, ['scripts/build-site.mjs'], { stdio: 'pipe' }), 30000);
const page = path => readFileSync(`dist/site/${path}`, 'utf8');
const published = JSON.parse(readFileSync('site/releases.json', 'utf8')).guilded.github.version;
const curseforge = JSON.parse(readFileSync('site/releases.json', 'utf8')).guilded.curseforge;

describe('edition-specific downloads', () => {
  it('offers the WoW Forever download and section before features', () => {
    expect(WOW_EDITIONS.map(edition => edition.id)).toEqual(['forever']);
    const home = page('index.html');
    expect(home.indexOf('id="wow-versions"')).toBeLessThan(home.indexOf('id="features"'));
    expect(home).toContain('href="#wow-versions"');
    expect(home.indexOf('id="wow-versions"')).toBeLessThan(home.indexOf('id="paths"'));
    expect(home).toContain('href="/forever/"');
    expect(home).toContain('class="edition-card edition-forever featured"');
    for (const other of ['classic-era', 'classic-tbc', 'classic-mists', 'retail']) expect(home).not.toContain(`edition-card edition-${other}`);
    expect(home).not.toMatch(/Choose your WoW|Choisir votre WoW|every version|choose your edition|Choisir votre édition/i);
    expect(home).not.toContain('class="edition-menu"');
    expect(home).not.toContain('data-nav-group="edition"');
    expect(home).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });

  it('keeps the WoW Forever downloads, metadata and language alternatives together', () => {
    const html = page('editions/forever/index.html');
    const downloads = [...html.matchAll(/href="(https:\/\/github\.com\/[^" ]+\.zip)"/g)].map(match => match[1]);
    expect(downloads).toEqual(['Guilded', 'GuildedDungeons'].map(addon => `https://github.com/kevincaron28/Guilded/releases/download/v${published}/${addon}-v${published}-forever.zip`));
    expect(html).toContain('href="https://guilded.kcaron.top/editions/forever/?lang=fr"');
    expect(html).toContain('data-fr="Installer dans le bon dossier de jeu"');
    expect(html).toContain('https://apps.microsoft.com/detail/9N680XX3QFL9');
    for (const path of ['/leaderboards/', '/recruitment/', '/players/']) expect(html).toContain(`href="/forever${path}"`);
    expect(html).toContain('href="/forever/"');
    if (curseforge.version === published) for (const url of Object.values(curseforge.editions?.forever ?? {})) expect(html).toContain(`href="${url}"`);
    expect(html).not.toContain('undefined');
    const sitemap = page('sitemap.xml');
    expect(sitemap).toContain('https://guilded.kcaron.top/editions/forever/?lang=fr');
    expect(sitemap).toContain('https://guilded.kcaron.top/editions/forever/</loc>');
    for (const other of ['classic-era', 'classic-tbc', 'classic-mists', 'retail']) expect(sitemap).not.toContain(`/editions/${other}/`);
  });

  it('does not label an older CurseForge file as the current GitHub release', () => {
    const older = { version: '0.0.1', editions: { forever: { guilded: 'https://example.invalid/old-file' } } };
    const forever = editionPages(published, older).find(page => page.path === 'editions/forever/');
    expect(forever.body).not.toContain('https://example.invalid/old-file');
  });

  it('shows the CurseForge and zip links in the first download section', () => {
    const html = page('editions/forever/index.html');
    const download = html.indexOf('id="download-title"');
    const install = html.indexOf('id="install-title"');
    expect(download).toBeGreaterThan(0);
    expect(download).toBeLessThan(install);
    expect(html).toContain('https://www.curseforge.com/wow/addons/guilded');
    expect(html).toContain('https://www.curseforge.com/wow/addons/guilded-dungeons');
    expect(html).toMatch(/href="(?:\/downloads\/Guilded-v|https:\/\/github.com\/kevincaron28\/Guilded\/releases\/download\/)/);
  });

  it('routes edition pages through the Worker for server-rendered French', () => {
    const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
    expect(config.assets.run_worker_first).toEqual(expect.arrayContaining(['/editions', '/editions/*']));
  });
});

// 29 October 2026 website review: new pages, search listing, lighter images, plain wording.
describe('website refresh', () => {
  it('publishes the officer page in both languages, with server-rendered French', () => {
    for (const path of ['officers']) {
      const html = page(`${path}/index.html`);
      expect(html).toContain(`<link rel="canonical" href="https://guilded.kcaron.top/${path}/">`);
      expect(html).toContain(`hreflang="fr" href="https://guilded.kcaron.top/${path}/?lang=fr"`);
      expect(html).toContain('data-language-copy="fr"');
      expect(html).toContain('<nav class="footer-cols"');
      expect(html).not.toContain('<details class="nav-group has-current"');
    }
    const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
    expect(config.assets.run_worker_first).toEqual(expect.arrayContaining(['/officers', '/officers/*', '/forever', '/forever/*']));
  });

  it('lists the public data pages and the guild-page sitemap for search engines', () => {
    const sitemap = page('sitemap.xml');
    for (const path of ['/forever/leaderboards/', '/forever/recruitment/guilds/', '/forever/players/', '/officers/', '/forever/']) expect(sitemap).toContain(`<loc>https://guilded.kcaron.top${path}</loc>`);
    for (const slug of ['retail', 'tbc', 'mists', 'classic-era']) expect(sitemap).not.toContain(`guilded.kcaron.top/${slug}/`);
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

// The WoW Forever section, its hub page first.
describe('edition hubs', () => {
  it.each(WOW_EDITIONS)('gives $id its hub: leaderboard first, then download, guilds and first steps', edition => {
    const { slug } = editionSection(edition.id);
    const html = page(`${slug}/index.html`);
    expect(html).toContain(`<link rel="canonical" href="https://guilded.kcaron.top/${slug}/">`);
    expect(html).toContain(`hreflang="fr" href="https://guilded.kcaron.top/${slug}/?lang=fr"`);
    expect(html).toContain(`data-live-summary="/${slug}/leaderboards/summary.json"`);
    const board = html.indexOf('class="live-strip hub-board"');
    expect(board).toBeGreaterThan(0);
    expect(board).toBeLessThan(html.indexOf('id="download"'));
    expect(html.indexOf('id="download"')).toBeLessThan(html.indexOf('id="community-title"'));
    for (const path of ['leaderboards/', 'leaderboards/guilds/', 'recruitment/guilds/', 'recruitment/', 'players/']) expect(html).toContain(`href="/${slug}/${path}"`);
    const downloads = [...html.matchAll(/href="(https:\/\/github\.com\/[^" ]+\.zip)"/g)].map(match => match[1]);
    expect(downloads).toEqual(['Guilded', 'GuildedDungeons'].map(addon => `https://github.com/kevincaron28/Guilded/releases/download/v${published}/${addon}-v${published}-${edition.id}.zip`));
    for (const other of ['classic-era', 'classic-tbc', 'classic-mists', 'retail']) expect(html).not.toContain(`-${other}.zip`);
    expect(html).not.toContain('class="edition-menu"');
    expect(html).not.toMatch(/Choose your WoW|Choisir votre WoW|Je joue à/i);
    expect(html).not.toContain('data-nav-group="edition"');
    expect(html).not.toContain('undefined');
    expect(html.includes('id="dates-title"')).toBe(edition.id === 'forever');
  });
  it('routes the section and the removed editions\' old sections through the Worker (it redirects them)', () => {
    const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
    for (const slug of ['forever', 'classic-era', 'tbc', 'mists', 'retail']) expect(config.assets.run_worker_first).toEqual(expect.arrayContaining([`/${slug}`, `/${slug}/*`]));
  });
});
