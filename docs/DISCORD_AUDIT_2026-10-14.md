# Discord audit and Diablo plan — 14 October 2026

Initial inspection of ⚜Quebec Gold⚜ used Discord REST and database reads without
a gateway login or second bot. Owner-approved Diablo preview and polish actions
were subsequently applied, as recorded below. Other recommendations remain pending.
221 members (4 bots), 48 roles, 19 categories.

## Permissions: what works and why

Everything the bot needs works today: every bound channel is reachable, and no
text channel is hidden from it or read-only for it. **It works only because the bot holds the `Admin` role**
(Administrator; the Guilded bot is the only holder). Simulating the same server
without that role:

| Area | Without Admin |
| --- | --- |
| Text channels hidden from the bot | **29** (all PoE2 categories, 💬 Chat WoW, #general-admin, #📋wow-personnages) |
| Bound channels broken | `#bilan-hebdo-wow` (weekly report), `#tableau-artisanat` (craft board) |
| Read-only | `#🎮choix-de-jeu` (the welcome game picker) |
| Role assignment | `Exilé` (33) sits above the bot's highest non-admin role `Bot` (32), so acceptance could not grant it |
| `Guilded bot permissions` role | Position **3**: nearly useless for role management at that height |

Administrator is broader than the bot needs, and a leaked token would control
the whole server. Recommended path, done by the owner in Discord's server
settings (the bot cannot safely do it to itself):

1. Drag **Guilded bot permissions** up, just under `Chef de Guerre` (44), above
   `Exilé`, the game roles and the class-leader roles.
2. Give that role: View Channels, Send Messages, Send in Threads, Embed Links,
   Attach Files, Read History, Add Reactions, Manage Messages, Pin Messages,
   Manage Roles, Manage Channels, Manage Threads, Create/Manage Events, Moderate
   Members, Move Members, Connect. Kick/Ban only if `/moderation` is used.
3. Add the role explicitly to the private categories (PoE2 ×6, 💬 Chat WoW,
   🔨 Artisanat, the WoW category for #bilan-hebdo-wow) and allow Send in #🎮choix-de-jeu.
4. Rerun this audit with Admin simulated off; it must report 0 hidden channels and 0 problems.
5. Only then remove `Admin` from the bot.

Do not do step 5 before 1–4: the live bot would lose the weekly report, craft
board and member acceptance immediately.

## Other findings

| Severity | Finding | Suggestion |
| --- | --- | --- |
| High | **FlaviBot** has Administrator + Manage Channels | Confirm it is still used; remove or reduce it |
| High | Server **2FA requirement off** for moderators (mfa_level 0) | Enable *Require 2FA for moderation* (Server Settings → Safety) |
| Medium | Verification level **None**, explicit-content filter **off** | Raise to Low/Medium; scan media from members without roles |
| Medium | `@everyone` may **@everyone** in `#📋noms-ingame` and `#💸loto-liste` | Remove Mention Everyone from those overwrites |
| Medium | `Champion` (19 members) can mention @everyone/@here | Probably unintended for 19 people |
| Info | Two personal roles (`Grand Templier`, `Chaman`) are Administrator, 1 holder each | Fine if those are the owner and a trusted co-admin |
| Info | Bot application is **public** (anyone can invite it) | Intended for the hosted pilot; otherwise turn off in the Developer Portal |
| Info | Portal has all three privileged intents on; config requests Message Content off | Fine, matches CLAUDE.md |

## Diablo: built 14 October (private preview)

**Code.** `DIABLO2` joins `COMMUNITY_GAMES` beside `DIABLO4`. Every game now has an
EN/FR label (`COMMUNITY_GAME_LABELS`, `communityGameLabel`), so `/community start-season`
offers *Diablo II: Resurrected*, *Diablo IV*, and so on instead of raw codes, and
season lists, leaderboards, cards and autocomplete show the readable name.
No migration: `game` is a plain string. Tests: `tests/community.test.ts`.

**Discord.** `scripts/setup-diablo-area.ts` (dry run by default, idempotent) created:

- Role `@Diablo II` (next to the existing `@Diablo IV`; no colour, permissions or pings)
- Category `━━ 😈 DIABLO 😈 ━━`, at the bottom of the list while private:
  `📢diablo-annonces` (read-only), `🩸d2-projet`, `🔥d4-saison`, `🗨diablo-chat`,
  `🤝diablo-groupes` (30 s slow mode), `💎diablo-drops-builds`, `💰diablo-échange`
  (60 s slow mode, no real-money trades), voice `🔊 Diablo · Groupe 1/2`. French topics on every text room.
- Visibility: `@everyone` denied; only the server owner, the bot and `Guilded bot permissions`
  are allowed. Administrator holders (`Grand Templier`, `Chaman`) can always see it, and Discord cannot prevent that.

**To open it after approval:** `npx tsx scripts/setup-diablo-area.ts --publish` adds
`@Diablo II`, `@Diablo IV` and `@Chef de Guerre` and moves the category above WoW.
Then add both roles to the welcome picker (`/setup start`, step 5), and start the
season with `/community start-season game:Diablo II: Resurrected role:@Diablo II channel:#🩸d2-projet`.

## Community polish audit (whole server)

**Applied 14 October** with `scripts/polish-community.ts` (dry run by default, idempotent):
pings turned off on the rank roles (except `Grand Templier`, which sits above the bot: change it by hand),
the five typo/accent renames (code now creates the accented names and still recognises the old ones),
and French topics on all 45 empty text channels (0 left). Everything else below is still a proposal.

### 1. Discord's Community features are off

The server lacks the `COMMUNITY` feature, so it has no native Onboarding, Rules Screening,
Welcome Screen or Server Guide. Enabling it requires what the security section already
recommends (verification ≥ Low, media scan for everyone) plus a rules and an updates channel
(`🔴règles`, `📢wow-annonces`, or a new general one). Native Onboarding could then replace
`🎮choix-de-jeu` with a game question (WoW / PoE 2 / Diablo II / Diablo IV) asked on join.
The server's preferred language is **en-US**; set it to French. There is no description or banner.

### 2. Inconsistent naming

| Today | Problem | Proposal |
| --- | --- | --- |
| `⬛Bienvenue⬛`, `⬛AFK⬛`, `⬛Voice PoE 2⬛`, `Communauté`, `Admin`, `💬 Chat WoW` | Three category styles | Game banners `━━ … ━━` + sub-categories `emoji Name` |
| `🏆・leaderboard`, `🏅・palmares` vs `📢annonces` | Two emoji separators | One style (`📢annonces`, the most common) |
| `⏩ Acceuil ⏪` | Typo | `⏩ Accueil ⏪` |
| `🖥️liens-utile` | Grammar | `🖥️liens-utiles` |
| `activites`, `chat-communaute`, `palmares` | Missing accents (others have them) | `activités`, `chat-communauté`, `palmarès` |
| `leaderboard`, `guild-info`, `music-bot`, `streamer-hub`, `hideout`, `price-check`… | English mixed into a French server | French equivalents, or keep established PoE jargon deliberately |
| `chat-wow`, `infos-wow`, `wow-patch-notes`, `bilan-hebdo-wow`, `guilded-annonces`… | No emoji when neighbours have one | Add emoji consistently |

### 3. Missing topics

**45 of 68 text channels have no topic** (almost all of PoE 2, the welcome channels,
`chat-wow`, `chat-raids`, the raid-team rooms). A topic is the cheapest polish there is.
I can write French topics for all of them for review.

### 4. Structure

- **PoE 2 has 6 categories / 24 channels** for one game; Diablo gets 1, WoW 6.
  Suggest merging `Chat Room`, `Show-off` and `Trade` into one category (e.g. `💬 PoE 2`).
- **Duplicate announcement areas in WoW:** `infos-wow`, `📢wow-annonces`, `guilded-annonces`, `wow-patch-notes`.
- **Two staff areas:** `Admin` (Chef de Guerre + one member) and `🔒 Officiers` (WoW officers). Fine if deliberate; otherwise merge.
- **No cross-game voice room** besides Accueil/AFK. A `🎙 Communauté` voice room under Communauté would suit a multi-game server; `🎧music-bot` belongs there too.
- Many PoE category overwrites name roles with no permission bits (Champion, Errant, Server Booster…). They do nothing but make permissions hard to read.

### 5. Roles

- **Anyone can ping 202 people:** `Exilé`, `Errant` (64), `Champion` (19), `Exalté`, `Ancien`, `Grand Templier`, `Chef de Guerre` are mentionable. Turn off "Allow anyone to @mention" on rank roles.
- Rank ladder names (Exilé → Errant → Champion → Exalté → Ancien) are PoE-themed on a multi-game server. That's the owner's choice; just noting it. `Exilé` is hoisted but has no colour.
- **Unused roles:** 6 `LFG *` (0 members), `Ancien` (0), `Frumpy's Core` (1), the 9 class-leader roles (0, waiting on the 4 Nov raid restart), `Chef de raid`, `Officier DKP`, `Chef du butin` (0).
- **16 members have no game role at all** (WoW / PoE 2 / Diablo), so they only see the welcome and community areas.
- **Composio** (an AI integration bot) is a member. Confirm someone still uses it; remove it otherwise.

## Diablo: state before this work

- Role `Diablo IV` (id `1337405574987645011`, position 29) exists with **0 members**.
- It is **not** in the welcome game picker (`welcomeRoleIds` offers only WoW and PoE2).
- No Diablo channels or categories. No `DIABLO4` community seasons.
- Code: `DIABLO4` is already a valid `/community` season game
  (`src/services/community-rules.ts` `COMMUNITY_GAMES`). `game` is a plain string column, so
  adding a game needs no migration.

## Diablo integration proposal

Blizzard publishes no game-data API for D2R or Diablo IV, and the games write no
readable combat/map logs like PoE2's, so a companion/stats pipeline is not
realistic. Integrate at the **community** layer, which Guilded already does well,
and make the game list data-driven so Diablo 5 is a one-line addition when it exists.

**Phase 1 (before 31 Oct, D2 project):**
- Code: add `DIABLO2` to `COMMUNITY_GAMES` (plus EN/FR labels); allow a game's
  role to gate a season's audience, as PoE2 does. Small and test-covered.
- Discord (owner): create role `Diablo II`; category `━━ 😈 DIABLO ━━` with
  `#📢diablo-annonces`, `#💬diablo-chat`, `#🤝d2-groupes`, `#🤝d4-groupes`,
  `#💎diablo-drops`, one voice room; gate it on the two Diablo roles; add both
  roles to the welcome game picker.
- Use existing features: `/community` season + challenges for the D2 project,
  Discord scheduled events for run nights, polls.

**Phase 2:** shared group finder for Diablo (reusing the dungeon-group queue
patterns: Baal/Chaos runs, ladder rush, D4 Pit/Helltide/world bosses), season-reset
reminders (D2R ladder, D4 seasons), per-game self-declared character/build profile.

**Phase 3:** Diablo 5 slot once the game exists. Recheck whether Blizzard ships an API.
