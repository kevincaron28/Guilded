<p class="eyebrow">OFFICERS · ABOUT 15 MINUTES</p>

# Officers

Run your guild in game with the addon alone, or add the [Discord bot](/guide/discord-bot/) for raid
signups, standings and polls in your server.

## Set it up

1. **Add the bot** (optional) and run `/setup start` in Discord: language, time zone, roles and
   channels. `/setup start status:true` shows what is still missing. Move Guilded’s role above the roles
   it must give.
2. **Ask members to [install the addon](/guide/install/).**
3. **Run the [companion](/guide/companion/)** on at least one officer’s PC: members who only use the
   addon reach Discord through an officer’s sync.
4. **Set raid cores and prices** with `/core setup`, `/core edit` and `/core items`. The
   [EP/GP guide](/guide/epgp/) walks through the rules.
5. **Go public when you are ready:** `/mod page create`, then `/mod page publish`. Open recruitment with
   `/mod recruit set`.

## Everyday tools

| Task | Command |
| --- | --- |
| Plan a raid | `/lead create` · [Raid night guide](/guide/raid-night/) |
| Link a member’s character | `/officer character link` · `/officer character unclaimed` |
| Invite requests and ranks | `/mod invites list` · `/mod rankroles set` · `/officer promotion rule` |
| Reviews of addon data | `/setup import held` · `/setup import apply` |
| Guild bank requests | `/officer bank list` · `/officer bank handle` |
| Polls and activities | `/organize poll create` · `/organize quiz` |

Members do not see `/officer`, `/lead`, `/organize`, `/mod`, `/setup` or `/config`. An officer without
Manage Server does not either: allow the officer role on them in Server Settings → Integrations →
Guilded.

[All commands](/reference/) · [Troubleshooting](/guide/troubleshooting/) ·
[Owner setup notes](/docs/GUILD_OWNER_SETUP.html)
