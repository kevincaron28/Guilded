# Guilded 6.7.0 — Members see only their commands

Feature release, October 18, 2026. Addon, bot and Windows companion move together to 6.7.0;
protocol remains 2. No database migration. The addon changes one hint only.
In-game results are in the [checklist](V6_2_GAME_ACCEPTANCE.md).

## Read first: one setting per server for leaders

Discord now hides officer and leader commands from members. It decides that with Discord
permissions, while Guilded still checks role names, so after updating:

- A **Raid Leader without Manage Events** no longer sees `/lead`.
- An **Officer or Guild Master without Manage Server** no longer sees `/officer`, `/organize`,
  `/setup`, `/config`, `/mod`, `/import`, `/poll` and `/system`.

Fix it once per server: **Server Settings → Integrations → Guilded**, then allow the Officer,
Guild Master and Raid Leader roles on those commands. For raid leaders, giving the Raid Leader
role Manage Events also works. `/setup` and `/system status` now warn when a role can't see
these commands. Nobody gains access: the bot's own role checks are unchanged.

## Members see fewer commands

| Command | Before | After |
| --- | --- | --- |
| `/raid` | 21 | 8 |
| `/epgp` | 7 | 3 |
| `/loot` | 7 | 3 |
| `/dungeon` | 18 | 12 |
| `/community` | 37 | 15 |
| `/character` | 25 | 20 |
| Top-level commands a member sees | 24 | 17 |

## Where the leader and officer tools moved

| Before | Now |
| --- | --- |
| `/raid create`, `edit`, `cancel`, `start`, `end`, `attendance`, `boss`, `note`, `award-ep`, `fill`, `season`, `history` | `/lead create` … `/lead history` |
| `/raid wcl report` | `/lead wcl-report` |
| `/character readiness member` / `raid` | `/lead readiness-member` / `readiness-raid` |
| `/epgp award-ep`, `award-gp`, `decay`, `reverse` | `/officer epgp …` |
| `/loot auction`, `award`, `close`, `priority` | `/officer loot …` |
| `/dungeon admin …` | `/officer dungeon …` |
| `/character unclaimed`, `link`, `autolink` | `/officer character …` |
| Community organizer tools (seasons, quizzes, honors, creating lotteries, gaming nights, challenges) | `/organize …` |

Members keep `/raid signup`, `cancel-signup`, `status` and `roster`, and every button on
signup posts works as before. `/help`, `COMMANDS.md` and the guides use the new paths.

## Guilded Lite

Lite servers get `/lead create`, `edit` and `cancel` (still without the `core` and `weekly`
options) instead of the old `/raid` versions.

## Website

- Owner-only downloads at `kcaron.top/owner`, behind a Cloudflare Access email-code login.
  They are already live; this note records them.

## Checked

- Automated: TypeScript, ESLint, the addon validator and the full test suite, with tests for
  command visibility, the moved subcommands, the Lite set and the new `/setup` warning.
- Not checked on a live server before release: what members and leaders see, and the
  Integrations warning. These are checked right after the deploy.
