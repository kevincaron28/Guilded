# Pre-launch system audit, upgrade plan and website redesign — 29 October 2026

Scope: review of the Codex/Claude work merged up to `daf0d4b` (8.1.0 candidate), a live check of
`guilded.kcaron.top`, and recommendations. Read-only: no code, deployment or data was changed.
Not independently verified: real-game behaviour, two-PC sync, store/CurseForge state (the owner's
manual-test waiver stands). The online search tool failed (HTTP 504) during this session, so the
competitor section reuses the primary-source review in
[LAUNCH_AUDIT_2026-10-29.md](LAUNCH_AUDIT_2026-10-29.md) plus general market knowledge; re-verify
competitor claims before publishing any comparison.

## 1. Review of the work done

**Verdict: engineering is in launch-ready shape; remaining risk is operational and first-impression.**

Fresh evidence from this checkout (`daf0d4b`):

| Gate | Result |
| --- | --- |
| `tsc --noEmit` | pass |
| `vitest run` | 345 files / 2952 tests pass |
| Addon validators (Guilded, Dungeons) | pass |
| `npm audit --omit=dev` | 0 vulnerabilities |

What is strong: release discipline (frozen published bytes, evidence docs per provider), the
1016 origin fix with 120/120 probes, bug-inbox overflow fix, personal pairing credentials instead of
a shared token, hand-written migrations, French enforced by tests, loot-history import with preview,
typed confirmation, dedup and undo.

Concerns (ordered):

1. **Docs sprawl and drift.** `AGENTS.md`/`CLAUDE.md` carry overlapping, long status paragraphs with
   dozens of historical pointers; two agents editing them already caused one drift. Keep one short
   "current state" file and move history to `docs/archive/`.
2. **Test suite is slow (214 s, 65 % import time)** — the report itself suggests `isolate: false`.
   Faster CI means faster launch-day hotfixes. Try it behind a flag and compare.
3. **Launch-day single points of failure:** one bot instance, free-tier Aiven, one Oracle host.
   Add an external uptime monitor on `/health`, the companion JS and a leaderboard route, with
   alerts to a Discord webhook; record DB connections/memory during tester traffic.
4. **Unverified real-game paths** (Forever API/build, dungeon IDs, two-PC sync, officer revocation).
   These are the likeliest launch-day bugs; keep the player test sheet and `/report bug` front and centre.
5. **Version-announce side effect:** shipping 8.1.0 posts a notice to every guild. Confirm wording
   and timing before the version bump merges.
6. **Dependabot merges straight to main** (#260/#261) days before launch. Freeze dependency bumps
   from Nov 1 until after launch week.

## 2. Competitive position and upgrade plan

Competitors (from the repo's primary-source review): Raid-Helper (scheduling/signups), RCLootCouncil
and Gargul (loot), That's My BiS (priority/wishlists), Raider.IO (dungeon data), Method Raid Tools,
GuildHall (integrated roster/events/analytics), WoWAudit (Retail raid prep/vault tracking),
Warcraft Logs (performance analytics), Guild Roster Manager (roster/notes).

Guilded's edge: **free, in-game + Discord optional, EP/GP + dungeon score + crafters in one product,
French-first, per-edition for Forever/Era/TBC/Mists.** No rival combines these for the Classic-style
editions. Its weakness is the same as any new tool: nobody has data yet and nobody knows it.

### Now → Nov 4 (protect, don't add)
- Uptime monitor + status line on the site (see §3).
- Fix the two live site defects in §3 (CSP beacon error, layout shift).
- One rehearsal with a fresh officer: install → pair → upload → standings → `/report bug`.
- Freeze dependencies; keep 8.0.2 artifacts untouched.

### Launch week → December 9 (first raids)
1. **Time-to-first-value:** a one-command/one-screen "first guild" wizard (addon + `/setup`) with a
   visible progress checklist; measure where guilds drop off.
2. **Coexistence imports:** RCLC/Gargul history is done for loot; add **Raid-Helper signup import**
   and **That's My BiS** wishlist import so guilds adopt without abandoning tools.
3. **Raid-night loop:** signup → reminder → attendance → loot → EP award posted to Discord as one
   thread. This is what makes officers stay.
4. **Public guild page as acquisition:** each guild gets a shareable, SEO-indexed page and OG card
   (roster, recruitment, weekly top runs). Players share these; it is your growth engine.
5. **Seeded content:** leaderboards show "0 runs" at launch. Pre-fill with the founding guild's runs
   (with consent) and show a clearly labelled "sample" board until real data arrives.

### Q1 2027
- Retail vault/wishlist-sim board only if concrete demand appears (per audit).
- Native-speaker review of FR/DE/ES; screen-reader pass with a real user.
- Read-only public API / embeddable widget for guild sites.
- Observability: structured logs, per-guild error rate, p95 latency dashboard.

## 3. Website review (live, 29 Oct)

Lighthouse: mobile home A11y 96, Best Practices 92, SEO 100; `/forever/` desktop 100/92/100.
Pages are fast and clean; design is a coherent dark/gold theme with italic-serif accents.

**Defects (fix first):**

| # | Finding | Fix |
| --- | --- | --- |
| 1 | Console error on every page: Cloudflare's auto-injected `beacon.min.js` is blocked by the CSP (`script-src 'self'`). `site/analytics.json` token is empty, so this is the dashboard's *automatic* Web Analytics injection. | Turn off automatic setup in Cloudflare Web Analytics (or use manual token + CSP allowlist for `static.cloudflareinsights.com`). Removes the Best-Practices failure. |
| 2 | Home mobile CLS 0.376 (poor; target < 0.1). Lazy images lack width/height; the 352 KB `inter-latin.woff2` swaps in late. | Add intrinsic `width`/`height` (or `aspect-ratio`) to hero/showcase images, preload the font with `font-display: optional` or subset it (variable Inter → ~100 KB). |
| 3 | "More screenshots ↗" link contrast against body text 1.08:1 and no underline (WCAG 1.4.1). | Underline links in running text. |
| 4 | `/forever/` hub starts with a big empty band and a bare edition tab row; the first real content is an empty "0 runs" board. | See redesign below. |

## 4. Redesign suggestions for a top-tier site

Principles: show the product before explaining it, make the next step obvious per visitor type
(player / officer / guild-hunter), and never show an empty state as the headline.

1. **Hero:** keep the strong headline; replace the single static screenshot with a short looping
   (muted, ≤ 6 s, < 500 KB, `prefers-reduced-motion` respected) clip or 3-step tab carousel:
   Standings → Loot → Dungeon score. Add one proof line: "Used by N guilds · N runs this week · Free".
2. **Primary action by audience:** two equal CTAs — "I'm a player: get the addon" and "I run a guild:
   set up in 5 minutes" — instead of one generic button plus a text link.
3. **Edition picker as a pill switcher** (sticky under the header, remembers choice via the existing
   `guilded_edition` cookie), with the launch countdown for Forever. Remove the duplicated tab rows
   (header "Playing:" plus hub tabs).
4. **Edition hub order:** download + "what you get" first, live leaderboard second, and when the board
   is empty show a sample board with a "Be the first guild" card instead of zeros.
5. **Social proof band:** guild logos/names (with permission), a quote, a CurseForge download/rating
   badge, GitHub release badge — currently only version numbers appear.
6. **Feature section as a bento grid** with real screenshots per feature (EP/GP, signups, crafters,
   dungeons, loot import) and one-line outcomes ("Stop updating spreadsheets"). Each tile links to
   its guide.
7. **Comparison table** ("Guilded alongside Raid-Helper, RCLC, Gargul, WoWAudit") that frames
   coexistence and imports honestly; strong for SEO and trust.
8. **Trust & privacy strip:** free forever, no login for the landing page, open data practices,
   security contact, store-signed installer. This audience cares about addon safety.
9. **Navigation diet:** 17 links in the menu is too many. Group into Product / Data (Leaderboards,
   Guilds, Players, Recruitment) / Learn (Guides, Officers) / Community; keep Download as a button.
10. **Status & changelog:** a small `/status` page fed by the health probe plus a "what's new in
    8.1.0" card. It turns outages (like the 1016 incident) from silent into explained.
11. **Performance/accessibility targets:** CLS < 0.1, LCP < 2 s on 4G, keep Accessibility ≥ 98,
    underline in-text links, visible focus rings, 44 px tap targets, test at 200 % zoom.
12. **Visual polish:** one accent colour (gold) used sparingly; add subtle card elevation, consistent
    icon set, class/role colour chips on leaderboards, and an OG image per edition and per guild.

Suggested build order: defects (1-3) → empty-state/hero/CTA changes (1, 2, 4) → nav diet and picker
(3, 9) → bento features, comparison, social proof → status page. The first group is small, safe for
November 4 and needs only `site/` and one Cloudflare setting; the rest should wait until after launch
unless it can ship with the normal site build and a rollback to the previous Worker.
