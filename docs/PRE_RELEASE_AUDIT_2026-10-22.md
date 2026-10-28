# Pre-release audit — 22 October 2026

Historical audit: many recommendations below are now implemented and 7.3.2 is deployed for
testing. Use [24 October launch readiness](LAUNCH_READINESS_2026-10-24.md) for current gates.
That historical promotion hold was superseded by the owner's release decision
and explicit remaining manual-testing waiver. Current implementation and provider
gates are in the [8.0.1 final audit](FINAL_8_0_1_AUDIT_2026-10-28.md) and
[8.0.2 evidence](V8_0_2_RELEASE_EVIDENCE_2026-10-28.md).

Full system audit before the next public release (main is 7.3.1, protocol 2). One part at a
time; tick each part when it is done so a later session can resume here.

## Plan and progress

- [x] 1. **Current state.** Versions, open branches, what is live versus on main.
- [x] 2. **Quality gates.** `tsc`, `vitest`, `eslint`, addon validator, `npm audit`, outdated packages.
- [x] 3. **Code audit.** Bot, addons, companion, website/Worker: bugs, security, dead code.
- [x] 4. **Accuracy audit.** README, ROADMAP, RELEASE_CHECKLIST, CLAUDE.md, COMMANDS.md, site,
      in-product help/FAQ: versions, dates, feature lists, links.
- [x] 5. **Market research.** Current WoW Forever guild tools (Discord bots, addons, web);
      where Guilded can stand out.
- [x] 6. **Fixes.** Accuracy fixes on branch `audit/pre-release-2026-10-22` (not committed yet).
- [x] 7. **Report.** Findings and the recommended upgrades, enhancements and quality-of-life items.
- [ ] Next: owner picks which recommendations to build; each becomes its own branch.

## Findings

### 1. Current state (checked 22 October 2026)

| Where | Version |
| --- | --- |
| `main`, `package.json`, `release.json` | 7.3.1 |
| Live bot (`guilded.kcaron.top/health`) | 7.3.1, protocol 2, commands ok |
| GitHub release | v7.3.1 |
| CurseForge file | 7.3.0 (game version 1.60.1, Forever); listing text still says 7.1.0 |

Open pull requests: #185 companion update (now overlaps #190's fix in the same four files:
close or rebase), #186 housekeeping and Dependabot, #187 TypeScript 7 / Vitest 5 / Electron 45,
#188 Prisma 7, #189 draft release-day guides.

WoW Forever launches **4 November 2026** (Blizzard). The beta closed 21 October, name
reservation opens 27 October, raids unlock 9 December. The real-client checks still owed (G6-G8
dungeon runs, G10 French client) can only run on live servers from launch day.

### 2. Quality gates

`tsc`, ESLint, both addon validators: pass. Vitest: 251 files, 2,123 tests pass.
`npm audit`: 4 moderate, all through `fengari` (test-only Lua harness) → `sprintf-js`, no fix
upstream; CI's `--audit-level=high` is unaffected. Major updates waiting: Prisma 7 (#188),
TypeScript 7 and Vitest 5 (#187), dotenv 18; minor: wrangler 4.151, zod 4.6.7, marked 18.1.

### 3. Code audit (targeted: newest and riskiest surfaces)

- **Web pages** (`/recruitment/`, `/me/`, profiles, leaderboards): every player- or guild-typed
  field checked is escaped; pages send a strict no-script CSP, forms carry CSRF tokens. No issue.
- **Companion Sign in with Discord**: request IDs are 256-bit and stored hashed, 10-minute
  lifetime, one-time grant, matching code plus a "if someone sent you this link, close the page"
  warning. No issue.
- **Companion API**: lockout after failed credentials, rate limits on sign-in, public uploads
  and companion edits; uploads need a guild-scoped personal credential. No issue.
- **Launch risk — game folder.** The desktop companion watches the exact `Guilded.lua` the
  player picked. Every tested install points into the beta client (`_classic_beta_`, beside
  `WowB.exe`). If the live Forever client uses another folder on 4 November, those companions
  keep watching a file that never changes and upload nothing, with no error. Blizzard has not
  confirmed the launch folder.
- **Launch risk — Interface number.** All three addons declare `16001` (game 1.60.1). If the
  live client reports a newer number, players see "out of date" until a re-tagged file is uploaded.
- **Addon restrictions.** Forever uses Retail's (Midnight) addon restrictions. Guilded does not
  read the combat log; dungeon and boss detection use `ENCOUNTER_START/END`, `BOSS_KILL` and zone
  events, which stay available. No change needed.
- **Dungeon Season 1** starts 4 November 23:00 UTC with provisional targets; 16 dungeons wait for
  live map IDs (runs kept, unrated). `/officer dungeon recalibrate` exists for real-run targets.
- Bot has no raid presets for Forever's first raids (Barrow Deeps 10, Hyjal Summit 20; Onyxia's
  Lair 40 later); the addon only knows them as attunement presets.
- Discord: discord.js 14.27, no Components V2 layouts yet (signup posts still use embeds).

### 4. Accuracy audit

Out-of-date "current version" statements: `README.md` (6.0.0, "next is 6.1.0"), `AGENTS.md`
(6.1.2/6.2.0), `CLAUDE.md` (7.3.0), `ROADMAP.md` (7.2.1), `RELEASE_CHECKLIST.md` (6.0.0),
`docs/GUILD_OWNER_SETUP.md` and `docs/OWNER_WALKTHROUGH.md` (6.0.0), `docs/CURSEFORGE_COPYPASTE.md`
and `docs/RELEASE_CURSEFORGE.md` (6.2.0/6.0.0), `addon/Guilded/README.md` (6.2.0 "not yet
published"), `site/README.md` (6.1.2). The live CurseForge description says 7.1.0 and leads with
"approval is required for each server", although Guilded Lite works at once since 6.6.0; the
website's home FAQ says the same. Example raid names use Molten Core, which is not a Forever
raid. Draft PR #189 already rewrites `GETTING_STARTED`, `MEMBER_INSTALL` and `QUICK_START`
(left untouched here), but pins "7.3.0" and keeps the beta-folder wording.

### 5. Market research (22 October 2026)

WoW Forever: Blizzard's official "Classic+", launch 4 November 2026 3 PM PST, level cap 60,
rulesets instead of realms, names with surnames, first raids 9 December (Barrow Deeps 10, Hyjal
Summit 20), hardcore later; included with a WoW subscription.

| Tool | Model | Strengths Guilded lacks | Gaps |
| --- | --- | --- | --- |
| GuildOS (addon + guildos.me + Windows app) | Free, ~14.7K downloads, updated almost daily | 9 languages, gear/ilvl roster with missing-enchant flags, attendance score, buff coverage, guild alliances, ban list on tooltips, trial tracking | No dungeon scores or leaderboards |
| Guild Order (web + addon + bot) | From US$3.99/month | Signup deadlines and reminders, Tentative/Late buttons, launch board, world-buff board, talent calculator | Paid, no dungeon scores |
| CoGM (Discord + web, addon in beta) | Free to 30 members, Pro US$10/month | Barrow/Hyjal/Onyxia raid templates with seats, voice-channel attendance, sealed-bid auctions with outbid DMs, guild bank, screenshot gear upload | Addon not released, paid core loot tools |
| Raid-Helper (Discord bot) | Free, premium templates | The default signup bot most guilds already know | No in-game side |
| Gargul / RCLootCouncil / softres.it | Free | Loot habits many raiders already have | Loot only |

Where Guilded stands out: free with nothing behind payment; works fully in game with no Discord
or website (officer ledger sync); Raider.IO-style dungeon seasons, public leaderboards and
player profiles (no competitor has these); standalone Guilded Dungeons; English and French
throughout; cross-guild raid vacancies and recruitment. Where it is weakest: discovery (Guilded
175 downloads, Guilded Dungeons 18) and storefront text that leads with an approval gate.

### 6. Fixes made on this branch

- `README.md`: current version 7.3.1 with links to the latest release and notes, Guilded Dungeons
  and the website's leaderboards/profiles/recruitment, Guilded Lite instead of "approval first",
  Sign in with Discord, launch-folder wording.
- `CLAUDE.md`, `ROADMAP.md`, `RELEASE_CHECKLIST.md`: current status 7.3.1, Forever launch dates,
  older sections marked historical. `AGENTS.md` got the same banner, but it is local only (listed
  in `.git/info/exclude`), so the change stays on this PC.
- `docs/GUILD_OWNER_SETUP.md`, `docs/OWNER_WALKTHROUGH.md`, `docs/RELEASE_CURSEFORGE.md`,
  `addon/Guilded/README.md`, `site/README.md`: stale 6.x "current" statements replaced.
- `docs/CURSEFORGE_COPYPASTE.md`: rewritten listing (summary, description, 7.3.1 file changelog,
  Guilded Dungeons summary) that leads with "free, works in game" and Season 1.
- `site/index.html`: home FAQ says Guilded Lite works right away (English and French).
- Example raid names: Molten Core → Hyjal Summit (`COMMANDS.md`, addon README, `/core setup` wizard).

Checks after the fixes: `tsc` and ESLint pass; site build passes; command-docs, commands-shape,
core-wizard, release-metadata, site-nav and worker-routing tests pass (37 tests).
For PR #189 (not edited here, to avoid conflicts): say 7.3.1, not 7.3.0, in `MEMBER_INSTALL.md`
(English and French), and replace the `_classic_beta_` wording in `MEMBER_INSTALL.md` and
`GETTING_STARTED.md` with "the folder beside the game's .exe you launch".

### 7. Recommendations

Effort: S = under 2 hours, M = about a day, L = several days.

**A. Before launch (now to 4 November)**

1. **Companion follows the live game folder (M, highest risk).** When the watched file sits in a
   `*beta*` folder, or has not changed for 3 days while another `_..._` folder beside it has a
   newer `Guilded.lua` / `GuildedDungeons.lua`, show one button: "Switch to the live game
   folder". Without it, every tested companion silently stops uploading on launch day.
2. **Upload 7.3.1 to CurseForge and paste the new listing (S).** CurseForge still serves 7.3.0
   (without the Update now repair) and a description that says 7.1.0. Add Guilded ↔ Guilded
   Dungeons as related projects.
3. **Launch-day runbook (S).** On 4 November: read the live Interface number
   (`/dump select(4, GetBuildInfo())`) and folder name; if either changed, ship 7.3.2 the same day
   (TOC and docs only); check `/health`; watch Season 1 start at 23:00 UTC; run `npm run bugs`.
4. **Pull requests (S).** Close #185 (its fix landed in #190, same files). Merge #186 (Dependabot).
   Hold #187 (TypeScript 7, Vitest 5, Electron 45) and #188 (Prisma 7) until after launch week:
   no database-layer or toolchain change in the last 13 days. Fix #189's two lines above, merge
   with the next release.
5. **Name reservation opens 27 October (S).** Reserve the test characters needed for G6-G8 on live.

**B. Launch week**

6. **Run G6-G8 and G10 on live servers.** The beta is closed; these are the only dungeon and
   French-client checks still owed before Season 1 scores count.
7. **Recalibrate Season 1 targets from real runs** (`/officer dungeon recalibrate`) once each
   bracket has a week of runs; announce it so players trust the leaderboard.
8. **Map IDs for the unrated dungeons (M).** 16 dungeons (45-59 and 60) wait for live map IDs.
   Have the bot list "unknown route" receipts for the owner so the data update can ship within days.

**C. Before raids open (9 December)**

9. **Raid presets for Barrow Deeps (10), Hyjal Summit (20) and Onyxia's Lair (40) (M)** in
   `/lead create` and `/core setup`: size and role seats in one click (CoGM already has them).
10. **Raid loot data (M).** Item names, prices and tooltips for both raids as soon as Blizzard
    publishes loot tables; seed GP prices per core.
11. **A real raid night** with two officers: the oldest open acceptance gate.

**D. Stand-out upgrades**

12. **Make dungeons the headline.** No Forever competitor has scored seasons or public
    leaderboards. Launch-day posts (Forever forums' Community Connections, r/classicwow,
    barrens.chat), and ask the "which addons have Forever files" guide sites to list Guilded and
    Guilded Dungeons (18 downloads today).
13. **Shareable run cards (M).** Open Graph images on character and run pages, so a link pasted
    in Discord shows the score; a weekly "top runs" post from the bot.
14. **Remove the last approval gate (M).** Auto-approve a Lite server once it has a few linked
    members and an addon upload, with an owner veto; call it "free", not "pilot". Competitors are
    self-serve.
15. **Windows installer code signing (S to set up, about US$10/month).** The installer is
    unsigned, so SmartScreen warns every non-technical member.
16. **German and Spanish in the addon (L, community translators).** GuildOS ships nine languages;
    Guilded has English and French. `Locale.lua` already supports more.
17. **Discord Components V2 for signup and leaderboard posts (M).** Cleaner layouts than embeds
    (discord.js 14.27 supports them).
18. **Gear audit column (M).** The data already exists in readiness; show item level and missing
    enchants per member in the guild window, as GuildOS does.

**E. Quality of life**

19. **Companion status line:** "Watching <folder> · last upload <time>", amber after 3 days
    without a change while the game was played.
20. **One version source (S).** Guides link "latest release" instead of pinning numbers; a test
    fails when `README.md`/`ROADMAP.md`/`CLAUDE.md` "current" lines differ from `package.json`.
    Today's drift touched 10 files.
21. **Docs tidy (S).** Shrink `AGENTS.md` to a pointer to `CLAUDE.md`; move V4-V6 handoffs and
    dated reports into `docs/archive/` (132 files in `docs/` now).

**F. Technical**

22. After launch week, one at a time with the PostgreSQL restore rehearsal: Prisma 7 (#188),
    TypeScript 7 / Vitest 5 (#187), dotenv 18.
23. `fengari` → `sprintf-js` moderate advisories are test-only with no upstream fix: accept and note.

Sources: Blizzard's [WoW Forever page](https://worldofwarcraft.blizzard.com/en-us/forever),
[Warcraft Wiki](https://warcraft.wiki.gg/wiki/World_of_Warcraft:_Forever),
[GuildOS](https://www.curseforge.com/wow/addons/guild-os), [Guild Order](https://guildorder.com/games/wow_forever),
[CoGM](https://cogm.app/games/wow-forever), [Gargul](https://www.curseforge.com/wow/addons/gargul),
[Icy Veins on Forever addons](https://www.icy-veins.com/wow-forever/news/addons-in-wow-forever-blizzard-devs-just-addressed-the-big-question/),
[Forever addon folder guide](https://wowdee.com/articles/wow-forever-addons).

## Implementation progress (owner's picks, 22 October 2026)

Every PR below has green CI (both `Guilded quality` jobs). All seven branches merged together in a
throwaway branch pass `tsc`, ESLint, both addon validators and Vitest (255 files, 2,152 tests).

| Item | Status | PR |
| --- | --- | --- |
| 1, 19 Companion follows the live folder; status line | Done (separate session); Windows check before release | #197 |
| 4 PR housekeeping | #185 closed; #189 fixed (release line, live folder, Lite-first wording); hold notes on #187/#188; **#186 waits for the owner** | GitHub |
| 20 One version source | Done: `tests/current-version-docs.test.ts` | #191 |
| 21 Docs tidy | Done: 32 docs to `docs/archive/`, no new broken links; `AGENTS.md` is a pointer (local file) | #191 |
| 12 Launch posts | Drafts in `docs/LAUNCH_POSTS.md`; the owner posts them | #191 |
| 14 Automatic approval, "free" not "pilot" | Done, off until `HOSTED_AUTO_APPROVE_DAYS` is set | #192 |
| 13 Share cards, weekly report link | Done (logo as card image, no generated images) | #193 |
| 18 Gear audit page | Done; in-game check owed | #194 |
| 17 Components V2 | Done for `/dungeon leaderboard`; signup posts stay embeds until a Discord check | #195 |
| 16 German and Spanish | 149 lines each plus the CSV kit; native review owed | #196 |

Suggested merge order: #191, #186, #192, #193, #194, #195, #196, #197 (keep both CHANGELOG bullets
when #197 meets #192), then #189 with the release. #187 and #188 after launch week.
