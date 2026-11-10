# Guilded website redesign plan

## Kevin decisions (10 Nov 2026)

Decided by Kevin on 10 Nov 2026. These settle the matching open questions in §11. (f) is still open.

- **(a)** Primary host is kcaron.top (`guilded.kcaron.top` and `www.kcaron.top` 301 to it; canonicals point at kcaron.top).
- **(b)** Drop `/forever/` from leaderboard and community URLs (Guilded is Forever-only now), with 301s from the old URLs.
- **(c)** French pages move to a `/fr/` folder (replacing `?lang=fr` long term, with 301s).
- **(d)** Cloudflare Web Analytics approved.
- **(e)** CurseForge is supposed to be current — being investigated.
- **(f)** Still open: headline "Less organizing. More playing."; PoE2 page public/indexed; self-hosting guides public vs repo-only; translated vs same-name FR slugs.

**Date:** 10 November 2026 (America/Toronto) · **Scope:** https://guilded.kcaron.top (and kcaron.top, same Worker `guilded-wow`) · **Code read:** `origin/main` at `809c3d2b` · **Mode:** read-only. Nothing was changed, committed or deployed.

**Method:** curl of every sitemap URL plus bot pages (EN, browser UA); HTML parsed for words, headings, links and download links; headless Chrome (Playwright) screenshots at 1280 px and 390 px; mobile overflow and tap-target checks; site source (`site/`, `scripts/build-site.mjs`, `site/nav.mjs`, `src/services/*`, `wrangler.jsonc`); SEO audit `/workspace/seo/SEO_AUDIT_2026-11-10.md`; reference sites.

**Not measurable:** real traffic, bounce or conversion (Cloudflare Web Analytics is off: `site/analytics.json` has an empty token), Search Console data (not connected), CurseForge download counts, Core Web Vitals from real users. Page timings below are from one headless run on the box and are only indicative.

Screenshots: `/workspace/redesign/shots/` (`<page>-desktop.png`, `<page>-desktop-full.png`, `<page>-mobile.png`, `<page>-mobile-full.png` for home, start, download (/editions/), forever, companion, features, reference, docs_quickstart, leaderboards, guildboard, recruitment).

---

## 1. Executive summary

1. **Too many doors to the same room.** There are 33 public pages; 26 of them are "how to get/install/use" content. Installing the addon is explained on 6 pages, "the companion is optional" on 20, Discord sign-in/pairing on 15, EP/GP on 13. The footer has 7 different install-type links (Start here, Get the addon, Quick start, Install step by step, Install guide, Setup help, Link your character).
2. **There is no real download page.** The header button "Get the addon" opens `/editions/`, a page with one card ("Forever") that sends you to a second page (`/editions/forever/`). A third page (`/forever/`) has the same H1 ("Guilded for WoW Forever") and the same downloads. The companion, Android APK and Discord bot downloads live on yet other pages. From the main button it takes 3 clicks to reach CurseForge or the zip.
3. **Leftovers from the multi-edition era.** WoW Forever is the only edition since 7 Nov, but the header still has a "Choose your WoW" menu with one option, and the home page still says "Downloads for every version" and "Choose your edition & download".
4. **The quick reference exists but is a wall.** `/reference/` is 12 tables / 119 command rows (English), 9,011 px tall on desktop and 21,144 px on a phone, with no search or filter.
5. **Leaderboards bury the data.** On a phone the first ranking table starts 1,616 px down (about two screens). Two brackets sit side by side, so the Routes column is cut off on desktop and the score is off-screen on mobile. Every row repeats "WoW Forever", and the page shows "No rated dungeon run this week" right above a full season table.
6. **The fix is structural, not cosmetic:** 6 top-level items (Home, Download, Guide, Quick reference, Leaderboards, Community), one page per job, one install guide, one download hub, one language per URL, 301s for everything retired.

---

## 2. Current-state audit

### 2.1 Navigation measured

| Item | Measured |
|---|---|
| Header items | 6 links + "Choose your WoW" drop-down (1 option) + EN/FR switch. Source: `site/nav.mjs` `SITE_NAV` |
| Footer | 24 links in 4 columns (`FOOTER_NAV`) |
| Public pages crawled | 33 (31 in `/sitemap.xml` EN + `/g/quebec-gold/` + `/me/`) |
| Nav depth | Max 3 levels below home (home → /editions/ → /editions/forever/ → file) |
| Docs URL styles | 4 patterns: `/start/`, `/guides/install/`, `/docs/QUICK_START`, `/forever/...`; plus `.html` links that 307 to extensionless |
| Redirect hops on internal links | `/leaderboards/`, `/recruitment/guilds/`, `/players/` → 302 to `/forever/...`; `/docs/*.html` → 307 |

### 2.2 Clicks from the home page to each download

| Download | Fastest path (clicks) | Via the main "Get the addon" button |
|---|---|---|
| Addon on CurseForge | 1 (small "CurseForge ↗" link near the bottom of home) | 3 (/editions/ → /editions/forever/ → CurseForge) |
| Addon .zip (direct) | 2 (hero "WoW Forever leaderboard and download" anchor → /forever/ → zip) | 3 |
| Guilded Dungeons (lighter addon) | 2–3 (same pages) | 3 |
| Companion, Microsoft Store | 1 (small "Windows companion ↗" near the bottom) | 2 (/editions/ → Store) |
| Companion, direct .exe | 2 (/editions/ or /companion/) | 2 |
| Android app (APK, preview 0.2.0) | 1 ("Download for Android" link in the home HTML; visibility depends on the device) | not on the download pages; it is on /companion/ and /features/ |
| iOS app | none published | none |
| Discord bot invite | 2 (/start/ → "Add Guilded to your Discord") | not on the download pages |

### 2.3 Page inventory

"Overlap" = how many of 8 recurring topics the page re-explains (install folder, CurseForge, Microsoft Store, unsigned .exe, "companion is optional", Discord sign-in/pairing, EP/GP, slash commands). 0–2 low, 3–5 medium, 6+ high. Word counts are visible English text in `<main>`; docs that hold a French section inside the same page are marked (FR inside), so their counts include French.

| Page | Purpose / audience | Words | HTML KB | Overlap | Verdict |
|---|---|---|---|---|---|
| `/` | Product home, everyone | 384 | 23 | 3 | Rebuild (5 CTAs in hero, edition leftovers, zero metrics) |
| `/start/` | Role chooser + install, new users | 597 | 25 | 6 | Merge into Guide › Get started |
| `/features/` | Product tour | 1,115 | 45 | 5 | Merge into Home + Guide; 301 |
| `/officers/` | Officer pitch + setup | 567 | 20 | 4 | Merge into Guide › Officers |
| `/companion/` | Companion + Android download, sync steps | 724 | 22 | 4 | Downloads → Download hub; sync steps → Guide |
| `/editions/` | "Get the addon" (one card) | 82 | 11 | 1 | Delete; 301 → /download/ |
| `/editions/forever/` | Forever downloads + folder | 255 | 16 | 5 | Merge into /download/; 301 |
| `/forever/` | Forever hub: board teaser, downloads, dates, steps | 381 | 21 | 2 | Merge (board → Leaderboards, downloads → Download); 301 |
| `/reference/` | Every command | 1,806 | 55 | 2 | Keep URL, rebuild as searchable cheat sheet |
| `/status/` | Service status | 89 | 6 | 0 | Keep (footer) |
| `/quebec-gold/` | Kevin's guild/community page | 520 | 22 | 3 | Keep under Community; trim Guilded pitch |
| `/quebec-gold/poe2/` | PoE2 community (FR only) | 261 | 8 | 0 | Keep under Community (decide if indexed) |
| `/guides/install/` | Illustrated install | 708 | 27 | 5 | Becomes the one install guide |
| `/guides/link/` | Link character | 763 | 27 | 2 | Keep as Guide › Link your character |
| `/docs/QUICK_START` | Quick start | 297 | 13 | 7 | Merge into Get started; 301 |
| `/docs/MEMBER_INSTALL` | Long install + connect (FR inside) | 3,371 | 34 | 8 | Merge into install guide + troubleshooting; 301 |
| `/docs/DUNGEONS_GUIDE` | Dungeons addon + runs (FR inside) | 1,256 | 18 | 6 | Keep as Guide › Dungeons & scores (drop install repeat) |
| `/docs/EPGP_GUIDE` | EP/GP workflow (FR inside) | 1,492 | 20 | 3 | Keep as Guide › EP/GP & loot |
| `/docs/GUILD_OWNER_SETUP` | Self-host setup | 1,676 | 22 | 4 | Merge with walkthrough → Guide › Self-host |
| `/docs/OWNER_WALKTHROUGH` | Self-host from scratch | 2,634 | 32 | 4 | Becomes Guide › Self-host |
| `/docs/HOSTED_PILOT` | Free hosted bot / Lite (FR inside) | 2,194 | 25 | 6 | Split: user part → Guide › Add the bot; host-owner part → internal doc |
| `/docs/SUPPORT_GUILDED` | Ko-fi support (FR inside) | 429 | 12 | 1 | Keep as /support/ (footer) |
| `/docs/PRIVACY` | Privacy EN+FR in one page | 2,997 | 29 | 4 | Keep as /privacy/, one language per URL |
| `/docs/DEPLOY_ORACLE` | Ubuntu hosting | 1,441 | 19 | 4 | Sub-page of Self-host |
| `/docs/AI_SETUP_HELP` | AI prompts for help | 933 | 14 | 2 | Merge into Troubleshooting |
| `/docs/AUTOMATION_QUICK_START` | Optional automation (FR inside) | 474 | 12 | 0 | Section of Guide › Officers |
| `/forever/leaderboards/` | Season 1 dungeon board | 798 | 37 | 0 | Rebuild layout |
| `/forever/leaderboards/guilds/` | Guild rankings | 288 | 24 | 0 | Tab of Leaderboards |
| `/forever/recruitment/` | Open raid spots, LFG | 192 | 18 | 0 | Community › Recruitment |
| `/forever/recruitment/guilds/` | Find a guild (3 guilds) | 95 | 17 | 0 | Community › Find a guild |
| `/forever/players/` | Player directory | 253 | 20 | 0 | Community › Players |
| `/g/quebec-gold/` | Public guild page (FR) | 415 | 22 | 0 | Keep pattern `/g/<slug>/` |
| `/me/` | Signed-in area (401 when signed out) | 39 | 16 | 0 | Keep as account icon, noindex |

### 2.4 Repeated blocks (quotes)

The repetition is mostly paraphrase, not copy-paste: an exact-sentence check found almost no identical sentences, but the same topics are rewritten page after page. Examples:

- "Companion is optional", 20 pages:
  - Home: "Companion (optional, Windows) Sync with Discord and the website."
  - /editions/ and /editions/forever/ (identical): "Guilded works in game on its own. Add the optional Windows companion to sync with Discord and the website, with a separate connection for each guild."
  - /features/: "A free Windows app, optional for the addon alone but needed for Discord and website features."
  - /reference/: "A small free Windows app. It is optional for the addon and needed for Discord and website features."
  - /docs/QUICK_START: "Get the companion (optional, Windows only). It sends your saved game data to Discord and the website."
  - /docs/GUILD_OWNER_SETUP: "…Windows companion (Microsoft Store first; optional for the addon alone, needed for Discord and website features…"
- "Put the addon in Interface/AddOns", 6 pages:
  - /start/: "Close WoW completely, then copy the Guilded folder into Interface/AddOns of the game version you launch."
  - /guides/install/: "Close WoW completely. Open the folder of the Forever game you launch… then open Interface and AddOns. Extract the ZIP there."
  - /docs/QUICK_START: "Close WoW first, then copy the Guilded folder into that game's Interface/AddOns."
  - /docs/MEMBER_INSTALL: "The result must be Interface\AddOns\Guilded\Guilded.toc, with no extra nested Guilded folder."
  - /docs/DUNGEONS_GUIDE: "…the resulting file must be Interface\AddOns\GuildedDungeons\GuildedDungeons.toc."
  - /editions/forever/: "The beta used a _classic_beta_ folder; the live game may use another one." (stale after launch)
- Closest page pairs by shared 6-word phrases: /editions/ vs /editions/forever/ 61% of the smaller page; /editions/forever/ vs /forever/ 16%; / vs /officers/ 9%; /companion/ vs /docs/MEMBER_INSTALL 7%.
- Same H1 on two pages: "Guilded for WoW Forever" (/forever/ and /editions/forever/).

### 2.5 Key problems with evidence

| # | Problem | Evidence |
|---|---|---|
| P1 | No single download page | Header CTA → /editions/ (82 words, 1 card) → /editions/forever/; downloads also on /forever/, /companion/, /features/, /guides/install/, /reference/ |
| P2 | Edition leftovers | "Choose your WoW" with only WoW Forever; home "Downloads for every version →", "Choose your edition & download →" |
| P3 | 7 overlapping install entry points | Footer Help + Product columns; /start/ links to 4 more install docs |
| P4 | Docs in 4 URL styles, 2 languages per page | `/start/`, `/guides/…`, `/docs/UPPER_CASE`, `/forever/…`; 6 docs carry a French section inside the English page |
| P5 | Home hero has too many choices | Start here, WoW Forever leaderboard and download, View leaderboards, My Guilded, Android, plus two version numbers ("CurseForge 9.0.3 · GitHub 9.1.5") |
| P6 | Zero metrics shown as headlines | Home "0 rated dungeon runs this week" and /forever/ the same; leaderboard "No rated dungeon run this week yet" above a full season table |
| P7 | Leaderboards: data below the fold | Mobile: first table at y = 1,616 px; desktop: filters + 3 explanatory lines before data |
| P8 | Leaderboards: crowded tables | Two brackets side by side: Routes column clipped at 1280 px; mobile table 466 px in a 350 px box (sideways scroll, score hidden); guild table 1,017 px in 350 px; every row repeats "WoW Forever"; class in CAPITALS plus class colour |
| P9 | Leaderboards: form needs a submit | "Show rankings" button for 3 selects; "More filters" hidden; separate pages for guild rankings |
| P10 | Quick reference is long and flat | 12 tables, 119 rows; 9,011 px desktop, 21,144 px mobile; no search, no role filter, no copy button |
| P11 | Privacy notice above the H1 | "Your player profile is public by default…" is the first line on the leaderboard |
| P12 | Version mismatch shown to users | CurseForge 9.0.3 vs GitHub 9.1.5 (`site/releases.json`, verified 9 Nov) |
| P13 | Small tap targets on mobile | Links/buttons under 32 px tall: leaderboard 32 of 99, MEMBER_INSTALL 13 of 56, /editions/forever/ 8 of 44 |
| P14 | Heavy fonts for a small site | Cold home load ≈ 492 KB over 13 requests (one box run); Inter woff2 352 KB + Source Serif as a 184 KB TTF used only for an italic accent word |
| P15 | SEO structure (from the SEO audit) | FR on ?lang= not localized on /start/, /docs/, /guides/, /reference/, /quebec-gold/; host duplication; bot pages without canonical/hreflang; 302/307 instead of 301 |

---

## 3. What the best sites do (references)

| Pattern | Who does it well | What to copy |
|---|---|---|
| Tiny addon site, three exits | WeakAuras (https://weakauras.wtf/): one sentence, then GitHub, CurseForge, Discord, and a separate Companion block | Home says what it is in one line and gives the 2–3 doors that matter |
| Download hub with OS detection | Obsidian (https://obsidian.md/download): one big "Download for Windows" chosen from your OS, then every platform in rows (iOS, Android incl. APK, Windows, Mac, Linux), version + "last updated" | Primary button picked by platform; every other platform one row below; version and date visible |
| Flavour-per-file on CurseForge | Details! (https://www.curseforge.com/wow/addons/details): main file per game flavour, update date, version | Show the Forever file, version and date on our hub; send CurseForge users to the exact file |
| Command list grouped by audience | Dyno (https://dyno.gg/commands): commands grouped Info / Manager / Moderator, one line each, `[required]` `(optional)` legend at the top, hides manager commands from normal users | Group by role, one line per command, a legend for argument syntax, anchors per command |
| Leaderboard filters + tabs | Raider.IO character rankings (https://raider.io/mythic-plus-character-rankings/season-mn-1/world/all/all/0): season / class-role / region selectors at the top, role tabs (Overall, M DPS, R DPS, Healer, Tank), compact rows (rank, name, realm, best runs, score), First/Prev/Next/Last paging; score rules on a help page | Filters as one bar on top, role tabs, one table, score explained elsewhere |
| Docs structure | Linear docs (https://linear.app/docs): short groups (Getting started, Planning, …) each with a few task pages | A left sidebar with 5–6 groups; one task per page |
| Language versions | Google Search guidance (https://developers.google.com/search/docs/specialty/international/managing-multi-regional-sites): separate URLs per language, hreflang, do not switch content automatically by browser language | `/fr/` URLs (or fixed `?lang=fr`), a switcher that keeps the same page, no Accept-Language switching on indexable pages |

---

## 4. Proposed information architecture

Top-level navigation (6): **Home · Download · Guide · Quick reference · Leaderboards · Community**. Utility (right side): **My Guilded** (account icon), **EN | FR**. One primary button: **Download (free)**.

```
/                         Home
/download/                Download hub (addon, Dungeons addon, companion, Android, Discord bot, checksums)
/guide/                   Guide home (pick: Player · Officer · Server owner)
  /guide/start/           Get started in 3 steps (player)
  /guide/install/         Install the addon (the one install page)
  /guide/companion/       Companion: sign in, sync, settings
  /guide/link-character/  Link your character
  /guide/dungeons/        Dungeons, runs and how scores work
  /guide/officers/        Officers: set up the guild, raids, automation
  /guide/epgp/            EP/GP and loot
  /guide/discord-bot/     Add the free hosted bot (Lite)
  /guide/self-host/       Host your own bot (+ /guide/self-host/ubuntu/)
  /guide/troubleshooting/ Fixes + AI help prompts
/reference/               Quick reference (searchable cheat sheet)
/leaderboards/            Characters (default) · Guilds · Dungeon records · This week
/community/               Community hub
  /community/guilds/      Find a guild
  /community/recruitment/ Raid spots and players looking
  /community/players/     Player directory
  /g/<slug>/              Public guild pages (unchanged)
  /quebec-gold/           Quebec Gold (+ /quebec-gold/poe2/)
/me/                      My Guilded (noindex)
/status/ /privacy/ /support/   Footer only
/fr/...                   French mirror of every page above (recommended; see §8)
```

Footer shrinks from 24 to about 12 links: Download, Guide, Quick reference, Troubleshooting, Leaderboards, Find a guild, Discord ↗, Status, Privacy, Support, Releases ↗, By KCaron ↗.

---

## 5. Key page wireframes

### 5.1 Home
1. Header: logo · 6 items · My Guilded icon · EN|FR · [Download free].
2. Hero: H1 "Your guild, organized — right inside WoW." (keep "Less organizing. More playing." if Kevin prefers); one line of value; [Download free] (primary) + "See Season 1 leaderboards" (text link); under it: "WoW Forever · v9.1.5 · Updated <date> · Free, Discord optional". One screenshot.
3. Three pillars (cards): In game (standings, loot, crafters, dungeon runs) · Discord (signups, standings, polls) · Companion & phone (sync, profile). Each: one sentence + one link into the Guide.
4. "Pick your path": Player → /guide/start/, Officer → /guide/officers/, Server owner → /guide/discord-bot/.
5. Live strip (only when numbers are above zero): top 3 characters this season + top guild, link to Leaderboards.
6. 4 FAQs (Is it free? Do I need Discord? Do I need the companion? Raid-Helper?), link to Guide.
7. Footer.
Removed from home: edition card, "Built for WoW Forever" block, duplicate CTA bar, two version numbers.

### 5.2 Download hub (/download/)
1. H1 "Download Guilded" · "Everything is free. Start with the addon; add the rest only if you need it."
2. Step 1 — The addon (required), large card: [Get on CurseForge] primary · "Direct .zip (v9.1.5, size)" secondary · "or the lighter Guilded Dungeons (dungeon runs only)" as a toggle, with one line on how to choose. One-line folder hint + "Install guide →". Collapsed details: SHA-256, GitHub mirror, release notes.
3. Step 2 — Companion (optional, Windows): platform-aware. Windows visitor: [Get it from Microsoft Store] primary, "Direct .exe (unsigned, Windows may warn)" secondary. Mac/Linux/phone visitor: "The companion is Windows-only. The addon works without it." (no fake button).
4. Step 3 — Discord bot (for server owners): [Add to Discord] + "What Lite includes" link.
5. Phone (preview): Android APK 0.2.0 with size + SHA-256 and "preview" label; iOS "not yet available".
6. "What's new" (3 latest release bullets) → Releases ↗.
7. All versions read from `site/releases.json` (already the single source).

### 5.3 Quick reference (/reference/)
1. Sticky toolbar: search box ("/" focuses it), surface tabs **In game · Discord · Companion**, role chips **Everyone · Raid leader · Officer · Admin**.
2. "Most used" card: about 10 commands most people need (e.g. `/guilded`, `/character pair`, `/help`).
3. Command rows: `command` + copy button · what it does (one line) · who (badge) · anchor link. Sub-commands as chips, not run-on text (today: "/character pair add import claim unlink list").
4. Legend once at top: `<required>` `[optional]`.
5. Keybinds and main-window tabs as small cards.
6. Print stylesheet: 2-page PDF cheat sheet; "Download PDF" link.
7. No-JS fallback: full list renders; JS only filters.

### 5.4 Leaderboards (/leaderboards/)
1. Sticky header: "Season 1 leaderboards" · season pill ("Season 1 · since 4 Nov 2026") · (i) "How scores work" opens a drawer or links to /guide/dungeons/#scores.
2. Tabs: **Characters** (default) · **Guilds** · **Dungeon records** · **This week**.
3. Filter bar, one row that wraps, auto-applies (GET params so links are shareable; plain form fallback): Bracket segmented **15–29 | 30–44** (one table at a time, instead of two side by side) · Role chips **All / Tank / Healer / DPS** · Class select · Dungeon select · Period (Season / This week) · Search name.
4. Table (desktop): # · Character (class colour, small guild name under it) · Role icon · Score (right-aligned, bold) · Routes (n/5) · Last run. 25 rows + "Show more" / pages. Header row sticks on scroll. Remove the per-row "WoW Forever" label and the CAPITALS class column.
5. Mobile: card rows (no sideways scroll): rank badge · name + class·role · score on the right; tap to expand routes and guild.
6. Signed-in: a pinned "You" row.
7. Empty states: if a tab has no data, one sentence + "how to get on the board" link; never a 0 metric.
8. Privacy notice moves under the table ("Profiles are public by default; hide yours in My Guilded").

### 5.5 Guide (docs)
1. Desktop: left sidebar with 4 groups — Get started · How-to · Officers & owners · Help; right "On this page"; breadcrumb; prev/next at the bottom. Mobile: sidebar becomes a "Guide menu" drawer.
2. Every page starts with "Who this is for" + "Time: 5 min" + prerequisites; one task per page; screenshots per step.
3. Each fact lives once (install folder, companion optional, Discord sign-in): other pages link to it.
4. One language per URL; "Edit on GitHub" link (repo is public) optional.
5. Troubleshooting page with a symptom index ("Addon not in list", "Companion can't see my characters", "Run missing from board") and the AI prompt block.

---

## 6. Content consolidation map

| Today | Action | New home | Redirect |
|---|---|---|---|
| /editions/ | Delete | /download/ | 301 |
| /editions/forever/ | Merge | /download/ | 301 |
| /forever/ | Merge (downloads, board teaser, dates) | /download/, /leaderboards/, Home | 301 → / |
| /companion/ | Split | /download/#companion + /guide/companion/ | 301 → /download/#companion |
| /features/ | Merge | Home pillars + Guide pages | 301 → / |
| /start/ | Merge | /guide/start/ | 301 |
| /docs/QUICK_START | Merge | /guide/start/ | 301 |
| /guides/install/ | Keep (base of the one install page) | /guide/install/ | 301 |
| /docs/MEMBER_INSTALL | Merge (install → /guide/install/, fixes → troubleshooting) | /guide/install/ | 301 |
| /guides/link/ | Keep | /guide/link-character/ | 301 |
| /officers/ | Merge | /guide/officers/ | 301 |
| /docs/AUTOMATION_QUICK_START | Merge as a section | /guide/officers/#automation | 301 |
| /docs/EPGP_GUIDE | Keep | /guide/epgp/ | 301 |
| /docs/DUNGEONS_GUIDE | Keep (drop install repeat) | /guide/dungeons/ | 301 |
| /docs/HOSTED_PILOT | Split (user part public; host-owner budget/launch checks → repo docs only) | /guide/discord-bot/ | 301 |
| /docs/GUILD_OWNER_SETUP + /docs/OWNER_WALKTHROUGH | Merge | /guide/self-host/ | 301 both |
| /docs/DEPLOY_ORACLE | Keep as sub-page | /guide/self-host/ubuntu/ | 301 |
| /docs/AI_SETUP_HELP | Merge | /guide/troubleshooting/#ask-ai | 301 |
| /docs/PRIVACY | Split EN/FR | /privacy/ and /fr/privacy/ | 301 |
| /docs/SUPPORT_GUILDED | Move | /support/ | 301 |
| /forever/leaderboards/ (+ /guilds/) | Rebuild | /leaderboards/ (+ ?tab=guilds) | 301 (today /leaderboards/ 302s the other way) |
| /forever/recruitment/, /forever/recruitment/guilds/, /forever/players/ | Move | /community/recruitment/, /community/guilds/, /community/players/ | 301 |
| /classic-era/, /tbc/, /mists/, /retail/, /editions/<id>/ | Already 301 → Forever | Re-point to the new URLs (avoid chains) | 301 |
| `*.html` docs links | Fix internal links | extensionless | 301 (not 307) |

Rule: every retired URL gets one 301 hop straight to its final address, and the sitemap lists only final URLs.

---

## 7. Design system notes

- **Keep:** dark base `#111416`, surfaces `#1a2023` / `#232b2f`, text `#f3f0e8`, muted `#aab5ba`, gold accent `#d9b66f`, focus ring, reduced-motion and forced-colours rules (`site/design-tokens.css`). Measured contrast on the base: text 16.2:1, muted 8.8:1, gold 9.6:1, control grey `#738087` 4.55:1 (passes AA only for normal text, keep it off small labels).
- **Type:** Inter for everything; Source Serif italic only for one accent word in hero H1s (convert to subset woff2). Scale: 14 / 16 / 18 / 22 / 28 / 40 / 56 px; body 16 px, tables 15 px; line length 60–75 characters on docs.
- **Spacing:** 4-px base (4, 8, 12, 16, 24, 32, 48, 64, 96); section gaps 64 px desktop / 40 px mobile; content width 1180 px, docs text column 720 px.
- **Buttons:** exactly 3 — Primary (gold fill), Secondary (outline), Text link. One primary per screen. Minimum tap height 44 px.
- **Components to build once** (shared by the static site and `src/services/web-layout.ts`): Header, Footer, DownloadCard, PlatformBadge, Tabs, Segmented, FilterBar, Chip, DataTable with sticky header, RankCard (mobile row), CommandRow with copy, Callout (info/warning), Stepper, Breadcrumb, DocsSidebar, LangSwitch, EmptyState.
- **WoW flavour, kept clean:** official class colours on names only (already used), item-quality colours for rank 1–3 badges (gold/silver/bronze already present), a subtle gilded border on the hero screenshot and on the season pill, the crest logo. No parchment textures behind text; no Blizzard art or icons (IP).
- **Icons:** one line-icon set (role: tank/healer/dps; platform: Windows/Android/Discord/CurseForge) as inline SVG sprites.

---

## 8. Bilingual approach

- One language per URL. Recommended: `/fr/` sub-folder for every page (`/fr/telecharger/` or `/fr/download/` — Kevin to choose translated slugs or not). Alternative with less work: keep `?lang=fr`, but then the Worker must localize every page (SEO1) and bot pages must stop switching by Accept-Language (SEO3).
- `hreflang` en, fr, x-default on every page; canonical self-referencing per language.
- Language switcher keeps the same page and remembers the choice for the next visit, but never changes content at an indexable URL by browser language.
- Remove French sections from inside English docs (6 pages today) and English sections from French pages.
- Quebec French glossary in the repo (e.g. "compagnon", "classements", "butin", "cores de raid") so Claude and translators stay consistent.
- Pages that are French-only by nature (Quebec Gold, PoE2) say so and have no empty English twin.

---

## 9. Performance and SEO tie-ins

- Consistent with SEO audit items SEO1–SEO4 (`/workspace/seo/SEO_AUDIT_2026-11-10.md`): this plan needs the same canonical host decision (SEO2), self-canonicals and hreflang on bot pages (SEO3), 301s instead of 302/307 and lastmod in sitemaps (SEO4). Do SEO1–SEO4 first or inside Phase 1; do not ship new URLs without them.
- Fonts: subset Inter to Latin + Latin-1 used glyphs and convert Source Serif to woff2; preload only Inter. Expected to cut most of the ≈492 KB cold home load (estimate; re-measure after).
- Images: serve `.webp` everywhere (PNG fallbacks exist next to WebP in `site/images/showcase/`), width/height attributes to avoid layout shift, lazy-load below the fold.
- Leaderboards: server-render the first 25 rows; filter changes via GET (cacheable at the edge for 60 s); no client framework needed.
- Structured data: `SoftwareApplication` on /download/ with version and OS; `BreadcrumbList` on Guide pages; `FAQPage` only if FAQs stay visible.
- Turn on Cloudflare Web Analytics (cookie-free; token goes in `site/analytics.json`) before Phase 1 so the redesign can be measured.

---

## 10. Phased rollout (Claude-ready spec stubs)

### Phase 0 — quick wins this week (no URL changes)

**R0.1 Remove single-edition leftovers**
- Goal: no "Choose your WoW" menu and no "edition/every version" wording.
- Files: `site/nav.mjs` (`editionMenu`, version switcher), `scripts/build-site.mjs` (`versionMenu`), `site/index.html`, `src/services/web-layout.ts`.
- Acceptance: header on static and bot pages has no edition drop-down; `grep -ri "every version\|choose your edition\|Choose your WoW"` in built `dist/site` and bot HTML returns nothing (EN and FR equivalents too); site tests pass.

**R0.2 "Get the addon" goes straight to the downloads**
- Goal: 2 clicks max from home to CurseForge or the zip.
- Files: `site/nav.mjs` (`SITE_NAV` cta href → `/editions/forever/`), `worker/index.mjs` (301 `/editions/` → `/editions/forever/`, keep `?lang`).
- Acceptance: `curl -sI https://guilded.kcaron.top/editions/` → 301 to `/editions/forever/`; header button lands on a page whose first screen shows the CurseForge and zip buttons at 1280 and 390 px.

**R0.3 Hide zero metrics**
- Goal: never show "0 … this week" as a headline.
- Files: `site/index.html` + `site/site.js` (live strip), `site/editions.mjs` (Forever hub), `src/services/public-leaderboard.ts` ("Top runs this week" block).
- Acceptance: with 0 weekly runs the home strip and the weekly block are hidden or replaced by one sentence + link; with >0 they render as today.

**R0.4 Leaderboard readability pass**
- Goal: data first, no clipping, less noise.
- Files: `src/services/public-leaderboard.ts`, `src/services/web-layout.ts` (CSS).
- Acceptance: brackets shown one at a time with a 15–29 / 30–44 switch (or stacked full width); no "WoW Forever" text inside rows; class shown once (colour + text, not capitals); privacy line moved below the table; at 390 px no table needs sideways scroll and the first ranking row is within 900 px of the top; at 1280 px no column is cut off (Playwright screenshot check).

**R0.5 Footer and install-link cleanup**
- Goal: one install path.
- Files: `site/nav.mjs` (`FOOTER_NAV`).
- Acceptance: footer Help column has at most 4 links (Install guide → `/guides/install/`, Quick reference, Setup help, Status); "Quick start" and "Install guide (MEMBER_INSTALL)" removed from nav (pages still reachable).

**R0.6 Version line**
- Goal: one version users can trust.
- Files: `site/index.html`, `site/releases.json`, `scripts/build-site.mjs`.
- Acceptance: home shows one version + date; if CurseForge lags, a small note "CurseForge updates can take a day" instead of two numbers (depends on Kevin's answer).

**R0.7 Fonts**
- Goal: lighter first load.
- Files: `site/fonts/`, `site/design-tokens.css`.
- Acceptance: Source Serif shipped as woff2; total font bytes on cold home load at least 40% lower than today's 536 KB of font files; no visual change in screenshots.

### Phase 1 — new structure (about 2–3 weeks)

**R1.1 Download hub** — Goal: `/download/` as in §5.2. Files: new `site/pages/download.md` (+ `.fr.md`) or a template in `scripts/build-site.mjs`, `site/releases.json`, `site/site.js` (platform detection, progressive), `wrangler.jsonc` run_worker_first, `worker/index.mjs` 301s from /editions/, /editions/forever/, /forever/, /companion/. Acceptance: every download (CurseForge, zip, Dungeons, Store, exe, APK, bot invite) is on this page with version, size and SHA-256 from releases.json; Windows UA sees Store primary, other UAs see the Windows-only note; works with JS off; old URLs 301 in one hop.

**R1.2 Navigation to 6 items** — Files: `site/nav.mjs`, `src/services/web-layout.ts`. Acceptance: header = Home logo + Download, Guide, Quick reference, Leaderboards, Community + My Guilded icon + EN|FR; same on static and bot pages; mobile menu lists the same 6.

**R1.3 Guide consolidation** — Goal: §4 Guide tree, each fact once. Files: `docs/*.md` → `site/pages/guide/*.md` (EN/FR pairs), `scripts/build-site.mjs` (sidebar, breadcrumb, prev/next), worker 301 map from §6. Acceptance: install-folder instructions exist on exactly one page; "companion is optional" sentence on at most 3 pages (Download, Guide start, Companion); all §6 redirects return 301 in one hop; site build fails on broken internal links (already does for relative targets).

**R1.4 Quick reference v2** — Files: `site/pages/reference.md` → structured data file (e.g. `site/reference.json`) rendered by `scripts/build-site.mjs`, `site/site.js` (filter). Acceptance: search, surface tabs and role chips work; each command has an anchor and copy button; print CSS fits on 2 A4/Letter pages; full list visible with JS off; FR version complete.

**R1.5 Leaderboards v2** — Files: `src/services/public-leaderboard.ts`, `src/services/web-layout.ts`, `src/services/community-leaderboard.ts`, worker routes. Acceptance: §5.4 tabs and filter bar; filters auto-apply via GET and produce shareable URLs; sticky table header; mobile card rows; paging 25 per page; canonical/hreflang per SEO3; Playwright screenshots at 390/1280 attached to the PR.

**R1.6 Bilingual URLs** — Decide `/fr/` vs fixed `?lang=fr`. Files: `scripts/build-site.mjs`, `worker/localized-assets.mjs`, `src/services/web-layout.ts`. Acceptance: every indexable page has exactly one language, self-canonical, hreflang trio; switcher keeps the page; no Accept-Language switching on indexable URLs.

**R1.7 Analytics on** — Files: `site/analytics.json` (token from Kevin). Acceptance: beacon loads on static pages only; CSP updated by build; privacy page mentions it.

### Phase 2 — polish and growth

**R2.1 Community hub** (`/community/` + moved recruitment/guilds/players, Quebec Gold card). **R2.2 Home rebuild** (§5.1) with live top-3 strip. **R2.3 Shared component CSS** for static site and bot pages (one stylesheet, design tokens doc). **R2.4 Docs search** (static index, e.g. Pagefind) once the Guide is consolidated. **R2.5 Player and guild pages** polish (score history, routes, recruitment card). **R2.6 Mobile app page** when Android leaves preview / iOS exists. **R2.7 Visual regression** in CI: Playwright screenshots of 6 key pages at 390/1280 compared per PR. Each follows the same Goal / Files / Acceptance format when moved into `docs/AI_HANDOFF.md`.

---

## 11. Risks and open questions

**Risks**
- URL changes can dip search traffic for a few weeks; mitigated by one-hop 301s, updated sitemaps and doing it once (Phase 1), not in pieces.
- Bot pages and static pages render the header/footer in two places (`site/nav.mjs` is shared, CSS is not fully); the redesign must change both or the site will look split.
- Translation workload doubles every new page; consolidation reduces the total, but FR parity needs a check per PR.
- Removing `/forever/` from data URLs closes the door to multi-edition URLs later; adding a section back later is possible with redirects.
- The companion and in-game addon link to some current URLs (e.g. `/docs/MEMBER_INSTALL`, `/start/`); old releases in the wild will rely on the 301s, so they must stay permanently.

**Open questions for Kevin**
1. Main host for Guilded pages: `guilded.kcaron.top` or `kcaron.top`? (Same as SEO2.)
2. Drop `/forever/` from leaderboard/recruitment URLs (recommended), or keep it for future editions?
3. French URLs: `/fr/` folder (recommended) or keep `?lang=fr`? Translated slugs (`/fr/telecharger/`) or same slugs?
4. CurseForge 9.0.3 vs GitHub 9.1.5: is CurseForge behind on purpose? Which version should the site show?
5. Keep "Less organizing. More playing." as the headline?
6. Is the PoE2 page staying public and indexed?
7. OK to turn on Cloudflare Web Analytics (cookie-free) so we can measure the redesign?
8. Should self-hosting docs stay on the public site, or move to the GitHub repo only (most users use the hosted bot)?
