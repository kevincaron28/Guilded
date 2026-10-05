// Compile only repository-owned public guides. This does not publish or start a bot.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, cpSync, existsSync } from "node:fs";
import { dirname, posix } from "node:path";
import { marked } from "marked";

const guides = ["OWNER_WALKTHROUGH", "QUICK_START", "MEMBER_INSTALL", "GUILD_OWNER_SETUP", "DEPLOY_ORACLE", "AI_SETUP_HELP", "ONLINE_COMPANION_CHECK"];
const sources = new Set(guides.map(name => `docs/${name}.md`));
const out = "dist/site";
mkdirSync(`${out}/docs`, { recursive: true });
for (const name of ["index.html", "style.css", "site.js"]) copyFileSync(`site/${name}`, `${out}/${name}`);
copyFileSync("docs/branding/guilded-logo-400.png", `${out}/logo.png`);
cpSync("docs/images/owner-setup", `${out}/docs/images/owner-setup`, { recursive: true });
const escape = text => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
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
  writeFileSync(`${out}/${source.replace(/\.md$/, ".html")}`, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · Guilded</title><link rel="stylesheet" href="../style.css"><script src="../site.js" defer></script></head><body><a class="skip" href="#main">Skip to content</a><header><a class="brand" href="../index.html"><img src="../logo.png" alt="" width="44" height="44">GUILDED</a><nav aria-label="Main"><a href="../index.html#downloads">Downloads</a><a href="OWNER_WALKTHROUGH.html">Owner guide</a><a href="../index.html#online">Online companion</a></nav></header><main class="guide" id="main">${body}</main><footer><a href="../index.html">← Back to Guilded</a><span>Guide checked 5 October 2026 · Guilded 6.0.0 Release</span></footer></body></html>`);
}
console.log(`Built ${out}: landing page and ${sources.size} illustrated guides. No deployment performed.`);
