# Command visibility: phases 1 and 2 (18 October 2026)

Goal: members only see the slash commands they can use. Today the bot registers 24 top-level
commands with 232 subcommands, and before this change none set `default_member_permissions`,
so every member saw `/mod ban`, `/epgp decay`, `/setup reset`, `/uninstall` and so on (the
handlers refused them, but they cluttered every member's `/` list).

## How the bot decides who is an officer (read this first)

`hasPermission` (`src/permissions.ts`) checks **role names** (Guild Master, Officer, Raid Leader,
DKP Officer, Loot Leader, Class Leader, in English or French) or Discord's Administrator
permission. `/setup` creates those roles with no Discord permissions. Discord's
`default_member_permissions` can only test **Discord permission bits**, never a role name, so no
setting matches the handlers exactly:

- A command hidden behind Manage Server is also hidden from an Officer whose roles do not grant
  Manage Server, until a server admin allows the Officer role for that command in
  **Server Settings → Integrations → Guilded** (a per-command role override). The bot cannot set
  that override itself: Discord only accepts it with a user's OAuth token.
- The handler checks stay. Discord's setting is only a default that admins can change, and a
  hidden command can still be run from an old client or by an admin who allowed it to anyone.

This is the price of phase 1 and the main question for phase 2: raid leaders are almost always
role-only, so hiding raid-leader tools behind a Discord permission would hide them from the
people who use them most, unless each server sets the Integrations override.

## Phase 1 (this PR)

Commands whose **every** subcommand is refused to members now carry
`default_member_permissions` (`HIDDEN_FROM_MEMBERS` in `src/commands/index.ts`; tested in
`tests/command-visibility.test.ts`):

| Command | Subcommands | Handler check | Discord default |
| --- | --- | --- | --- |
| `/setup` | start, testraid start/finish/dungeon/cleanup, selfroles, reset | Officer (`setup.ts`, `testraid.ts`, `selfroles.ts`); reset: owner or Administrator (`uninstall.ts`) | Manage Server |
| `/config` | view, set, welcome, farewell, roles, channel, timezone, weekly-report, auto-import, wcl-guild, loot-mode, merit | Officer for every change (`settings.ts`); `view` is not checked | Manage Server |
| `/mod` | warn, timeout, kick, ban, history; application ×5; faq ×7; page ×8 | Officer (`moderation.ts`, `application.ts`, `faq.ts`, `guild-page.ts`) | Manage Server |
| `/import` | upload, apply, held | Officer (`import*.ts`) | Manage Server |
| `/poll` | create, close | Officer (`poll.ts`); members vote with buttons | Manage Server |
| `/system` | status, retry, permissions | Officer (`system.ts`) | Manage Server |
| `/uninstall` | (none) | Server owner or Administrator (`uninstall.ts`) | Administrator (exact match) |

Notes:

- `/config view` was open to members. It is a settings dump with no member use; members lose it.
- `/setup start` on a Lite server keeps the permission too (`liteCommandJson` copies it); the
  owner who runs it there is the server owner.
- `/help` gained one officer line explaining the Integrations override (English and French);
  `COMMANDS.md` has a "Commands members don't see" section.
- Nothing else changes: no handler, no command name, no French key, no migration.

What the owner should do after deploying: in each server where an Officer lacks Manage Server,
allow the Officer and Guild Master roles on those six commands in Integrations. (Without that,
those officers simply stop seeing them; nothing breaks for anyone with Manage Server.)

## Inventory of the mixed commands (before phase 2)

From each handler's checks (not the descriptions). M = member, RL = Raid Leader or higher,
DKP = DKP Officer or higher, O = Officer or higher.

| Command | Member | Leader / officer |
| --- | --- | --- |
| `/raid` (21) | progress, report, signup, cancel-signup, status, roster, wcl check, wcl list | RL: create, edit, cancel, start, end, attendance, boss, note, award-ep, fill (`raid.ts` `management`); O: season, history (`raid-season.ts`), wcl report (`wcl.ts`) |
| `/epgp` (7) | balance, leaderboard, history (own; someone else's needs DKP) | DKP: award-ep, award-gp, decay, reverse |
| `/loot` (7) | bid, history, reserves | O: auction, award, close, priority |
| `/dungeon` (18) | catalog, rules, leaderboard, records, player, history, season, archive, hall-of-fame, guide, group, alerts | O: admin invalidate, award, audit, config, target, season-start |
| `/community` (37) | hub, seasons, leaderboard, wallet, dice, honors, lottery join/show/list, gaming join/show/list, challenge submit/show/list | O ("organizer"): start-season, season-settings, end-season, quiz, close-quiz, honors-preview, honors-settings, lottery create/confirm/payments/close/cancel, gaming create/edit/attendance/close/cancel, challenge create/review/claims/close/cancel |
| `/character` (25) | pair, add, import, claim, unlink (own; others' needs O), list, who, profession ×6, attunement ×2, wishlist ×4, readiness me | O: unclaimed, link, autolink; leaders (GM/RL/Loot/Class Leader): readiness member, readiness raid |
| `/core` (13) | show, list, items (action list) | RL: setup, edit, create, add, remove, character, post, delete, rules, rename, items (other actions) |
| `/team` (12) | show, list, sessions, view, respond | RL: create, member, schedule, session, attendance, lineup, archive |
| `/report` (6) | stats, ping, bug | O: inactive, guild, export |
| `/participation` (7) | status, nominate, history | O: settings, claims, review, reverse |
| `/bank` (5) | request, mine, cancel | O: list, handle |
| `/tag` (4) | show, list | O: set, delete |
| `/poe` (5) | pair, status, runs, summary | O: setup |
| `/craft` (9) | all (officer only widens claim/done/release/cancel; `permissions` is O) | O: permissions |
| `/help`, `/profile`, `/apply` | all | — |

Officer/leader subcommands still inside visible parents: about 85 of 232.

## Phase 2 options for the mixed parents (as proposed; B was chosen)

Discord limits that shape this: one level of groups under a top-level command (parent → group →
subcommand), at most 25 options per level, and **4000 characters** of names, descriptions and
choices per top-level command. `tests/commands-shape.test.ts` fails at 3900 to keep a margin
(`/character` is already about 3,740 and `/core` 3,220). Character counts below come from the
current definitions.

### Option A: keep phase 1 only

Members still see the ~85 officer subcommands inside `/raid`, `/epgp` and the rest, and get
"Only officers…" if they run one. No new commands, no retraining. Cheapest; the clutter stays.

### Option B (recommended): two officer parents, `/lead` and `/officer`, plus `/organize`

Move the leader/officer subcommands out of the mixed parents into three hidden parents grouped
by who uses them. Old subcommands are removed from the member parents, so each member list
shrinks.

| New parent | Who | Contents (moved from) | Size |
| --- | --- | --- | --- |
| `/lead` | Raid Leader+ | create, edit, cancel, start, end, attendance, boss, note, award-ep, fill (`/raid`); season, history, wcl-report (`/raid`); readiness-member, readiness-raid (`/character readiness`) | ≈2,200 |
| `/officer` | Officer / DKP | `epgp` group: award-ep, award-gp, decay, reverse; `loot` group: auction, award, close, priority; `dungeon` group: invalidate, award, audit, config, target, season-start; `character` group: unclaimed, link, autolink | ≈3,250 (tight: trim descriptions first) |
| `/organize` | Officer | the 22 community organizer subcommands, as groups `season`, `lottery`, `gaming`, `challenge`, `honors`, `quiz` | ≈2,300 |

Before → after for members:

| Member sees | Before | After |
| --- | --- | --- |
| `/raid` | 21 | 8 |
| `/epgp` | 7 | 3 |
| `/loot` | 7 | 3 |
| `/dungeon` | 18 | 12 |
| `/community` | 37 | 15 |
| `/character` | 25 | 20 |
| top-level commands | 24 (17 visible after phase 1) | 27: 17 visible + 10 hidden |

`/core`, `/team`, `/report`, `/participation`, `/bank`, `/tag` and `/poe` stay as they are in
this option (few officer parts each; `/core rules` alone is 926 characters, so `/core` admin
would not fit in `/lead`).

Default permission for the three: Manage Server for `/officer` and `/organize`. For `/lead`
there is no good bit: raid leaders rarely have Manage Server, Manage Events is the closest
"runs events" permission. Whichever bit, `/setup start`'s checklist should then tell the admin to
allow the Raid Leader role on `/lead` in Integrations, and `/system status` could flag a server
where nobody with the Raid Leader role can see it (the bot can read, not write, those
overrides with `GET /applications/{app}/guilds/{guild}/commands/permissions`).

### Option C: one hidden twin per area

`/raid-admin`, `/epgp-admin`, `/loot-admin`, `/dungeon-admin`, `/community-admin`: same split as B,
one twin per mixed parent (29 top-level commands). Easiest to learn ("the admin version of the
command you know") and no size pressure, but more names in an officer's `/` list.

## Phase 2: what changed (Option B, chosen by the owner on 18 October 2026)

Built in the same PR as phase 1. `src/commands/index.ts` lists the moved subcommands
(`RAID_LEAD`, `EPGP_OFFICER`, `LOOT_OFFICER`, `CHARACTER_OFFICER`, `COMMUNITY_ORGANIZER` and
the three activity lists) and builds `/lead`, `/officer` and `/organize` from them.

- **Router:** a mount can keep `only` some subcommands, leave some out (`except`, also on the
  base), or lift them onto the parent under new names (`flat`: `wcl report` → `/lead wcl-report`,
  `readiness raid` → `/lead readiness-raid`). The handler still sees the old command and
  subcommand (`legacyView`), so no handler changed; autocomplete resolves the same way.
- **Permissions:** `/lead` Manage Events, `/officer` and `/organize` Manage Server. A server can
  give its Raid Leader role Manage Events, or allow the role on `/lead` in Integrations.
  `/setup start`'s checklist does not say this yet; `/help` does (follow-up below).
- **Lite tier:** `/lead create` (without core and weekly), `edit` and `cancel`; `/raid` keeps
  signup, cancel-signup, status and roster.
- **Text:** every in-bot mention of a moved path (replies, setup text, the addon's unlinked-character
  message, `src/i18n-fr.ts` keys and values together), `/help`, `COMMANDS.md`, and the current
  feature guides in `docs/`. Release notes and handoffs keep the old paths: they are history.
- **French:** the three new parents carry French descriptions (`MergedCommand.setDescriptionLocalizations`).
  Moved subcommands keep their own builders' text and localizations.
- **Tests:** `tests/command-visibility.test.ts` (what each parent holds and its permission),
  `tests/router.test.ts` (partial and lifted mounts, real routes), `tests/guilded-lite.test.ts`,
  `tests/command-docs.test.ts` (the new parents are in `/help`).

Still open:

- `/setup start`'s checklist could tell the admin to allow the Officer and Raid Leader roles on the
  hidden commands, and `/system status` could flag a server where no Raid Leader can see `/lead`
  (the bot can read, not write, those overrides).
- Officers on live servers must learn the new paths; this belongs in the next version's release
  notes. The bot announces a version only when `package.json` changes, and this PR does not bump it.
