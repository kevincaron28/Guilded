// Compile only repository-owned public guides. This does not publish or start a bot.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, cpSync, existsSync, readdirSync } from "node:fs";
import { dirname, posix } from "node:path";
import { marked } from "marked";

const guides = ["HOSTED_PILOT", "SUPPORT_GUILDED", "OWNER_WALKTHROUGH", "QUICK_START", "MEMBER_INSTALL", "GUILD_OWNER_SETUP", "DEPLOY_ORACLE", "AI_SETUP_HELP", "ONLINE_COMPANION_CHECK"];
const sources = new Set(guides.map(name => `docs/${name}.md`));
const out = "dist/site";
mkdirSync(`${out}/docs`, { recursive: true });
for (const name of ["index.html", "style.css", "site.js"]) copyFileSync(`site/${name}`, `${out}/${name}`);
cpSync("site/creator", `${out}/creator`, { recursive: true });
// Google's public ownership files are curated separately from other local files.
// They are served on both sites by the existing static asset binding.
if (existsSync("site/verification")) {
  for (const name of readdirSync("site/verification")) {
    if (!/^google[a-f0-9]{8,64}\.html$/.test(name)) continue;
    const source = `site/verification/${name}`;
    if (readFileSync(source, "utf8").trim() !== `google-site-verification: ${name}`) {
      throw new Error(`Unexpected Google verification content: ${source}`);
    }
    copyFileSync(source, `${out}/${name}`);
  }
}
copyFileSync("docs/branding/guilded-logo-400.png", `${out}/logo.png`);
cpSync("docs/images/owner-setup", `${out}/docs/images/owner-setup`, { recursive: true });
const escape = text => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const siteHeader = (prefix, french = false) => `<header class="site-header"><div class="header-inner"><a class="brand" href="${prefix}${french ? 'quebec-gold/' : 'index.html'}"><img src="${prefix}logo.png" alt="" width="44" height="44"><span>${french ? 'QUEBEC GOLD' : 'GUILDED'}<span class="brand-caption">${french ? 'ON SE RETROUVE EN JEU.' : 'YOUR GUILD, CONNECTED.'}</span></span></a><button class="menu-toggle" type="button" aria-controls="main-navigation" aria-expanded="false" hidden>Menu <span aria-hidden="true">☰</span></button><nav id="main-navigation" aria-label="${french ? 'Navigation principale' : 'Main navigation'}"><a href="${prefix}features/">${french ? 'Guilded' : 'Features'}</a><a href="${prefix}docs/QUICK_START.html">Guides</a><a href="${prefix}index.html#start">${french ? 'Télécharger' : 'Download'}</a><a class="nav-companion" href="/companion/">${french ? 'Compagnon' : 'Open companion'} <span aria-hidden="true">↗</span></a></nav></div></header>`;
for (const source of sources) {
  const md = readFileSync(source, "utf8");
  const title = md.match(/^# (.+)$/m)?.[1] || "Guilded guide";
  const body = marked.parse(md, { walkTokens(token) {
    if ((token.type !== "link" && token.type !== "image") || /^(https?:|#|mailto:)/.test(token.href)) return;
    const [path, fragment] = token.href.split("#");
    const target = posix.normalize(posix.join(dirname(source).replaceAll("\\", "/"), path));
    if (!existsSync(target)) throw new Error(`Missing guide target: ${source} -> ${target}`);
    if (sources.has(target)) token.href = path.replace(/\.md$/, ".html") + (fragment ? `#${fragment}` : "");
    else if (token.type === "link") token.href = `https://github.com/kevincaron28/Guilded/blob/main/${target}` + (fragment ? `#${fragment}` : "");
  }}).replace(/<h([1-6])>(.*?)<\/h\1>/g, (_, level, content) => {
    const slug = content.replace(/<[^>]*>/g, "").toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s+/g, "-");
    return `<h${level} id="${slug}">${content}</h${level}>`;
  });
  writeFileSync(`${out}/${source.replace(/\.md$/, ".html")}`, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#111312"><title>${escape(title)} · Guilded</title><link rel="icon" href="../logo.png" type="image/png"><link rel="stylesheet" href="../style.css"><script src="../site.js" defer></script></head><body class="site-page docs-page"><a class="skip" href="#main">Skip to content</a>${siteHeader('../')}<main class="guide" id="main">${body}</main><footer class="page-footer"><a href="../index.html">← Back to Guilded</a><span>Guides updated 16 October 2026 · Guilded 6.3.1 Release</span></footer></body></html>`);
}
// Public content is explicitly curated; never import guild/database data here.
const origin = "https://guilded.kcaron.top";
const pages = JSON.parse(readFileSync("site/pages.json", "utf8"));
const publicUrls = ["/", ...guides.map(name => `/docs/${name}.html`)];
for (const page of pages) {
  const prefix = "../".repeat(page.path.split("/").filter(Boolean).length);
  const french = page.lang === "fr";
  const body = marked.parse(readFileSync(`site/pages/${page.source}`, "utf8"));
  const communityNav = french ? `<nav class="community-subnav" aria-label="Dans Quebec Gold">${[['quebec-gold/', 'La communauté'], ['g/quebec-gold/', 'World of Warcraft'], ['quebec-gold/poe2/', 'Path of Exile 2']].map(([path, label]) => `<a href="${prefix}${path}"${page.path === path ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav>` : '';
  mkdirSync(`${out}/${page.path}`, { recursive: true });
  writeFileSync(`${out}/${page.path}index.html`, `<!doctype html>
<html lang="${page.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#111312"><title>${escape(page.title)}</title><meta name="description" content="${escape(page.description)}"><link rel="canonical" href="${origin}/${page.path}">${page.draft ? '<meta name="robots" content="noindex,follow">' : ''}<meta property="og:title" content="${escape(page.title)}"><meta property="og:description" content="${escape(page.description)}"><meta property="og:type" content="website"><meta property="og:url" content="${origin}/${page.path}"><meta property="og:image" content="${origin}/logo.png"><link rel="icon" href="${prefix}logo.png" type="image/png"><link rel="stylesheet" href="${prefix}style.css"><script src="${prefix}site.js" defer></script></head>
<body class="site-page ${french ? 'community-page' : 'features-page'}"><a class="skip" href="#main">${french ? 'Aller au contenu' : 'Skip to content'}</a>${siteHeader(prefix, french)}<main class="guide recruitment" id="main">${communityNav}${page.draft ? '<aside class="note"><strong>Aperçu de recrutement</strong><p>Les informations de guilde et le contact public restent à confirmer avant publication.</p></aside>' : ''}${body}</main><footer class="page-footer"><a href="${prefix}index.html">Guilded · ${french ? 'Le produit' : 'The product'}</a><a href="${prefix}quebec-gold/">Quebec Gold · ${french ? 'La communauté' : 'The community'}</a><a href="https://kcaron.top/">${french ? 'Par' : 'By'} KCaron ↗</a><p>${french ? 'Site indépendant, sans affiliation avec Blizzard Entertainment ou Grinding Gear Games.' : 'Independent project, not affiliated with Blizzard Entertainment or Grinding Gear Games.'}</p></footer></body></html>`);
  if (!page.draft) publicUrls.push(`/${page.path}`);
}
writeFileSync(`${out}/sitemap.xml`, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${publicUrls.map(path => `<url><loc>${origin}${path}</loc></url>`).join('')}</urlset>\n`);
writeFileSync(`${out}/robots.txt`, `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`);
console.log(`Built ${out}: landing page, ${pages.length} feature/community pages and ${sources.size} guides. No deployment performed.`);
