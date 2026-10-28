// Compile only repository-owned public guides. This does not publish or start a bot.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, cpSync, existsSync, readdirSync } from "node:fs";
import { dirname, posix } from "node:path";
import { createHash } from "node:crypto";
import { marked } from "marked";
import { localizedHref, navLinks } from "../site/nav.mjs";
import { editionCards, editionPages } from "../site/editions.mjs";

const guides = ["PRIVACY", "HOSTED_PILOT", "SUPPORT_GUILDED", "OWNER_WALKTHROUGH", "QUICK_START", "MEMBER_INSTALL", "DUNGEONS_GUIDE", "EPGP_GUIDE", "GUILD_OWNER_SETUP", "DEPLOY_ORACLE", "AI_SETUP_HELP", "ONLINE_COMPANION_CHECK"];
const origin = "https://guilded.kcaron.top";
const guideDescriptions = {
  PRIVACY: "Guilded privacy: data, permissions, retention and private support requests. English and French.",
  DUNGEONS_GUIDE: "Set up Guilded Dungeons, sync runs with Discord sign-in, manage your player profile and find open raids. English and French.",
  HOSTED_PILOT: "Free hosted Guilded bot: start with Guilded Lite, set up your server and connect with Discord sign-in after approval. English and French guide.",
  SUPPORT_GUILDED: "Optional coffee support for Guilded. Downloads and hosted access stay free; support never buys approval. English and French information.",
  OWNER_WALKTHROUGH: "Illustrated independent-hosting walkthrough for Guilded owners, with setup prerequisites and checks.",
  QUICK_START: "Choose addon-only play, EPGP or optional Discord sync for Guilded on WoW Forever. English and French quick setup.",
  MEMBER_INSTALL: "Install Guilded for WoW Forever, Classic or Retail, select the matching edition and connect the optional companion. English and French instructions.",
  EPGP_GUIDE: "Use Guilded EP/GP, core pools, loot methods and standings, with or without Discord. Practical English and French raid workflow.",
  GUILD_OWNER_SETUP: "Configure Guilded roles, permissions and optional Discord synchronization for your own guild.",
  DEPLOY_ORACLE: "Independent Guilded hosting on Ubuntu: prerequisites, installation, maintenance and service checks.",
  AI_SETUP_HELP: "Troubleshoot Guilded setup with safe diagnostic prompts and clear member and owner checks.",
  ONLINE_COMPANION_CHECK: "Check Guilded companion connection, SavedVariables, returned standings and permissions without exposing private codes."
};
const sources = new Set(guides.map(name => `docs/${name}.md`));
const out = "dist/site";
mkdirSync(`${out}/docs`, { recursive: true });
// The creator's static JSON-LD remains allowed without enabling arbitrary inline scripts.
const structuredData = [...readFileSync("site/creator/index.html", "utf8").matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
const hashes = structuredData.map(match => `'sha256-${createHash("sha256").update(match[1]).digest("base64")}'`).join(" ");
writeFileSync(`${out}/_headers`, readFileSync("site/_headers", "utf8").replace("script-src 'self'", `script-src 'self' ${hashes}`));
// Published provider versions are independent of a local candidate/package bump.
const { guilded: publishedGuilded } = JSON.parse(readFileSync("site/releases.json", "utf8"));
const version = publishedGuilded.github.version;
const renderVersions = content => content.replaceAll("{{GUILDED_VERSION}}", version).replaceAll("{{GUILDED_CURSEFORGE_VERSION}}", publishedGuilded.curseforge.version);
// Static pages link relative to the site root (so a project subpath works); bot pages stay absolute.
const staticHref = (prefix, home = false) => item => item.bot || item.key === "companion" ? item.href
  : item.key === "download" ? (home ? "#start" : `${prefix}index.html#start`) : prefix + item.href.slice(1);
const homeNav = navLinks({ href: staticHref("", true), label: item => item.en === item.fr ? item.en : `<span data-en="${item.en}" data-fr="${item.fr}">${item.en}</span>` });
for (const name of ["index.html", "style.css", "site.js", "design-tokens.css", "atelier.css", "language.js", "nav.mjs"]) {
  const content = renderVersions(readFileSync(`site/${name}`, "utf8")).replace("{{SITE_NAV}}", homeNav).replace("{{EDITION_CARDS}}", editionCards());
  writeFileSync(`${out}/${name}`, content);
}
cpSync("site/fonts", `${out}/fonts`, { recursive: true });
cpSync("site/creator", `${out}/creator`, { recursive: true });
writeFileSync(`${out}/creator/index.html`, renderVersions(readFileSync("site/creator/index.html", "utf8")));
mkdirSync(`${out}/images/showcase`, { recursive: true });
for (const name of readdirSync("site/images/showcase")) {
  if (/\.(png|jpe?g|webp)$/.test(name)) copyFileSync(`site/images/showcase/${name}`, `${out}/images/showcase/${name}`);
}
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
const siteNav = (prefix, { french = false, current = null, bilingual = false } = {}) => navLinks({ href: item => french ? localizedHref(staticHref(prefix)(item), "fr") : staticHref(prefix)(item), current, label: item => bilingual ? `<span data-en="${item.en}" data-fr="${item.fr}">${item.en}</span>` : french ? item.fr : item.en });
const languageControls = `<div class="language-switch" role="group" aria-label="Language / Langue"><button type="button" data-set-language="en" aria-pressed="true">EN</button><button type="button" data-set-language="fr" aria-pressed="false">FR</button></div>`;
const siteHeader = (prefix, french = false, current = null, bilingual = false) => `<header class="site-header"><div class="header-inner"><a class="brand" href="${prefix}${french ? 'quebec-gold/' : 'index.html'}"><img src="${prefix}logo.png" alt="" width="44" height="44"><span>${french ? 'QUEBEC GOLD' : 'GUILDED'}<span class="brand-caption">${french ? 'ON SE RETROUVE EN JEU.' : bilingual ? '<span data-en="YOUR GUILD, CONNECTED." data-fr="VOTRE GUILDE, CONNECTÉE.">YOUR GUILD, CONNECTED.</span>' : 'YOUR GUILD, CONNECTED.'}</span></span></a><button class="menu-toggle" type="button" aria-controls="main-navigation" aria-expanded="false" hidden>Menu <span aria-hidden="true">☰</span></button><nav id="main-navigation" aria-label="${french ? 'Navigation principale' : 'Main navigation'}"${bilingual ? ' data-label-en="Main navigation" data-label-fr="Navigation principale"' : ""}>${siteNav(prefix, { french, current, bilingual })}${bilingual ? languageControls : ""}</nav></div></header>`;
for (const source of sources) {
  const md = readFileSync(source, "utf8");
  const title = md.match(/^# (.+)$/m)?.[1] || "Guilded guide";
  const description = escape(guideDescriptions[source.slice(5, -3)]);
  const canonical = `${origin}/${source.replace(/\.md$/, "")}`;
  // The four main guides, with this one marked; the guide sources no longer repeat these links.
  const guideLinks = [["QUICK_START", "Quick start"], ["MEMBER_INSTALL", "Install"], ["DUNGEONS_GUIDE", "Dungeons"], ["EPGP_GUIDE", "EPGP"], ["HOSTED_PILOT", "Discord bot"]]
    .map(([name, label]) => `<a href="${name}.html"${source === `docs/${name}.md` ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  const relatedGuides = `<nav class="guide-nav" aria-label="Guilded guides">${guideLinks}${md.includes('id="fr"') ? '<a class="guide-fr" href="#fr" lang="fr">Français ↓</a>' : ''}</nav>`;
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
  writeFileSync(`${out}/${source.replace(/\.md$/, ".html")}`, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#111312"><title>${escape(title)} · Guilded</title><meta name="description" content="${description}"><link rel="canonical" href="${canonical}"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${description}"><meta property="og:type" content="article"><meta property="og:url" content="${canonical}"><meta property="og:image" content="${origin}/logo.png"><link rel="icon" href="../logo.png" type="image/png"><link rel="stylesheet" href="../design-tokens.css"><link rel="stylesheet" href="../style.css"><link rel="stylesheet" href="../atelier.css"><script src="../site.js" defer></script></head><body class="site-page docs-page"><a class="skip" href="#main">Skip to content</a>${siteHeader('../', false, 'guides')}<main class="guide" id="main" tabindex="-1">${relatedGuides}${body}</main><footer class="page-footer"><a href="../index.html">← Back to Guilded</a><a href="https://ko-fi.com/wowguilded">Buy me a coffee ↗</a><span>Installation and setup guides · Check each store's listed release</span></footer></body></html>`);
}
// Public content is explicitly curated; never import guild/database data here.

const pages = [...JSON.parse(readFileSync("site/pages.json", "utf8")), ...editionPages(version)];
const publicUrls = ["/", ...guides.map(name => `/docs/${name}`)];
for (const page of pages) {
  const prefix = "../".repeat(page.path.split("/").filter(Boolean).length);
  const french = page.lang === "fr";
  const bilingual = !!page.sourceFr || !!page.bilingual;
  const pageText = (en, fr) => bilingual ? `<span data-en="${escape(en)}" data-fr="${escape(fr)}">${en}</span>` : french ? fr : en;
  const descriptionAttributes = bilingual ? ` data-content-en="${escape(page.description)}" data-content-fr="${escape(page.descriptionFr)}"` : '';
  const titleAttributes = bilingual ? ` data-content-en="${escape(page.title)}" data-content-fr="${escape(page.titleFr)}"` : '';
  const enBody = page.body ?? marked.parse(readFileSync(`site/pages/${page.source}`, "utf8"));
  const body = page.sourceFr ? `<div data-language-copy="en" lang="en">${enBody}</div><div data-language-copy="fr" lang="fr" hidden>${marked.parse(readFileSync(`site/pages/${page.sourceFr}`, "utf8"))}</div>` : enBody;
  const communityNav = french ? `<nav class="community-subnav" aria-label="Dans Quebec Gold">${[['quebec-gold/', 'La communauté'], ['g/quebec-gold/', 'World of Warcraft'], ['quebec-gold/poe2/', 'Path of Exile 2']].map(([path, label]) => `<a href="${prefix}${path}"${page.path === path ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav>` : '';
  mkdirSync(`${out}/${page.path}`, { recursive: true });
  writeFileSync(`${out}/${page.path}index.html`, `<!doctype html>
<html lang="${page.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#111312"><title${bilingual ? ` data-en="${escape(page.title)}" data-fr="${escape(page.titleFr)}"` : ""}>${escape(page.title)}</title><meta name="description" content="${escape(page.description)}"${descriptionAttributes}><link rel="canonical" href="${origin}/${page.path}">${page.draft ? '<meta name="robots" content="noindex,follow">' : ''}<meta property="og:title" content="${escape(page.title)}"${titleAttributes}><meta property="og:description" content="${escape(page.description)}"${descriptionAttributes}><meta property="og:type" content="website"><meta property="og:url" content="${origin}/${page.path}"><meta property="og:image" content="${origin}/logo.png"><link rel="icon" href="${prefix}logo.png" type="image/png"><link rel="stylesheet" href="${prefix}design-tokens.css"><link rel="stylesheet" href="${prefix}style.css"><link rel="stylesheet" href="${prefix}atelier.css"><script src="${prefix}site.js" defer></script>${bilingual ? `<script src="${prefix}language.js" type="module"></script>` : ""}</head>
<body class="site-page ${page.path.startsWith('editions/') ? 'edition-page' : french ? 'community-page' : 'features-page'}"><a class="skip" href="#main">${pageText('Skip to content', 'Aller au contenu')}</a>${siteHeader(prefix, french, page.path.startsWith('editions/') ? 'editions' : page.path === 'features/' ? 'features' : null, bilingual)}<main class="guide recruitment" id="main" tabindex="-1">${communityNav}${page.draft ? '<aside class="note"><strong>Aperçu de recrutement</strong><p>Les informations de guilde et le contact public restent à confirmer avant publication.</p></aside>' : ''}${body}</main><footer class="page-footer"><a href="${prefix}index.html">Guilded · ${pageText('The product', 'Le produit')}</a><a href="${prefix}quebec-gold/">Quebec Gold · ${pageText('The community', 'La communauté')}</a><a href="https://kcaron.top/">${pageText('By', 'Par')} KCaron ↗</a><a href="https://ko-fi.com/wowguilded">${pageText('Buy me a coffee', 'Offrir un café')} ↗</a><p>${pageText('Independent project, not affiliated with Blizzard Entertainment or Grinding Gear Games.', 'Site indépendant, sans affiliation avec Blizzard Entertainment ou Grinding Gear Games.')}</p></footer></body></html>`);
  if (!page.draft) publicUrls.push(`/${page.path}`);
}
writeFileSync(`${out}/sitemap.xml`, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${publicUrls.map(path => `<url><loc>${origin}${path}</loc></url>`).join('')}</urlset>\n`);
writeFileSync(`${out}/robots.txt`, `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`);
// Each bilingual public page has crawlable EN/FR alternatives. The Worker
// renders ?lang=fr on the server, including for clients without JavaScript.
function languageAlternates(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) { languageAlternates(path); continue; }
    if (!entry.name.endsWith('.html')) continue;
    let html = readFileSync(path, 'utf8');
    const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];
    if (!canonical || !html.includes('data-fr=')) continue;
    const french = new URL(canonical); french.searchParams.set('lang', 'fr');
    html = html.replace('</head>', `<link rel="alternate" hreflang="en" href="${escape(canonical)}"><link rel="alternate" hreflang="fr" href="${escape(french.href)}"><link rel="alternate" hreflang="x-default" href="${escape(canonical)}"></head>`);
    writeFileSync(path, html);
    if (canonical.startsWith(origin) && !publicUrls.includes(french.pathname + french.search)) publicUrls.push(french.pathname + french.search);
  }
}
languageAlternates(out);
writeFileSync(`${out}/creator/sitemap.xml`, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://kcaron.top/</loc></url><url><loc>https://kcaron.top/?lang=fr</loc></url></urlset>\n`);
writeFileSync(`${out}/sitemap.xml`, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${publicUrls.map(path => `<url><loc>${escape(origin + path)}</loc></url>`).join('')}</urlset>\n`);
console.log(`Built ${out}: landing page, ${pages.length} feature/community pages and ${sources.size} guides. No deployment performed.`);
