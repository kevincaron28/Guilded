import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { WOW_EDITIONS } from '../site/editions.mjs';
import { GAME_EDITIONS } from '../companion/game-edition.mjs';

beforeAll(() => execFileSync(process.execPath, ['scripts/build-site.mjs'], { stdio: 'pipe' }), 30000);
const page = path => readFileSync(`dist/site/${path}`, 'utf8');
const published = JSON.parse(readFileSync('site/releases.json', 'utf8')).guilded.github.version;

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
    expect(html).not.toContain('undefined');
    const sitemap = page('sitemap.xml');
    expect(sitemap).toContain(`https://guilded.kcaron.top/editions/${edition.id}/?lang=fr`);
    expect(sitemap).toContain(`https://guilded.kcaron.top/editions/${edition.id}/</loc>`);
  });

  it('routes edition pages through the Worker for server-rendered French', () => {
    const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
    expect(config.assets.run_worker_first).toEqual(expect.arrayContaining(['/editions', '/editions/*']));
  });
});
