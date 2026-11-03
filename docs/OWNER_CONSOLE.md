# Owner console (plan and operations)

A private channel in the owner's own server (K Caron Projects, `DISCORD_GUILD_ID`) that shows
every server using the bot and lets the application owner act on them. Source:
`src/services/owner-console.ts` (behaviour), `owner-console-model.ts` (rendering, paging, ids),
`owner-console-tools.ts` (the Discord-heavy actions), `src/commands/owner-console.ts` (`/guilded-console`).

## Who can use it
- Authentication is the same as `/guilded-season`: the Discord **application owner** (`botOwnerId`).
- Every interaction (button, menu, modal) re-checks three things: owner, home server, console channel.
  Anything else gets an ephemeral refusal and nothing runs.
- `/guilded-console` is registered in the home server only. Server administrators can still read any
  channel there; the channel's overwrites hide it from everyone else.

## Setup
`/guilded-console setup` (home server, owner only) creates `#guilded-owner-console` hidden from
@everyone, visible to the owner and the bot, and posts the board. Re-running reuses the channel,
re-applies the overwrites and keeps the board message. If the channel is deleted, the next refresh
clears the stored id once with a console warning (no error report); setup recreates it.

## The board
One message, edited in place every 5 minutes (and after each action). Eight servers per page, with
Prev/Next/Refresh, a menu to open a server, a Help button and the daily digest switch. The embed
opens with a summary line (servers, total members, servers with errors, servers not synced; the last
two count the servers on the page when there is more than one page) and its colour shows health
(green, amber for any errors in 24 hours, red for a spike of 10 or more).

Each server is one embed field: a title line with rank, name, tier badge (✅ approved, 🔹 lite,
⛔ blocked), language and members, then a status row (setup bar such as ▰▰▰▱▱▱▱▱ 3/8 across the 8 key
channels with no Discord calls, errors in 24 hours marked 🟢/🟡/🔴), the toggles with labelled icons
(🏆 achievements, 📣 announcements, 🌐 public sharing, 📰 weekly report), last activity and last
sync/upload, edition data, linked characters, cores, upcoming raids, the version last announced and
the server id in a code span. The per-server detail view (menu) shows the same data in labelled
fields, plus weekly honors.
Only counts and settings are read: no message content, DMs, tokens or `DATABASE_URL`.

## Actions (each: confirm, then audit)
Update bot messages, create missing core channels, run the real setup check (read-only), toggle
approval tier (uses `pilotRequests.setTier`; demotion needs a free Lite slot), toggle achievements,
announcements, public sharing and the weekly report, message the server's admin channel (text you
type, preview, confirm; mentions disabled), and leave the server (type `LEAVE`). The home server
cannot be demoted or left. Confirm buttons expire after 2 minutes.

## Audit
`OwnerConsoleAudit` rows (actor, action, server, short result; never message text) plus a one-line
trail posted in the console.

## Daily digest
Off by default (button on the board). When on: once a day, new and removed servers since the last
digest and servers with 10 or more errors in 24 hours. Turning it on sets the baseline.

## Deployment
- One hand-written migration: `20261211000000_owner_console` (two new tables, no changes to existing ones).
- Redeploy the bot; the command registers on start. Then run `/guilded-console setup` in K Caron Projects.
- No version bump, no new intents, no automatic messages to other servers.
