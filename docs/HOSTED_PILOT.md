# Guilded hosted pilot

The hosted pilot lets approved guilds use the same running Guilded bot. Your guild
does not need to download the bot, create a database, or keep a computer running.
Admission is by the Guilded owner's approval for each Discord server. This is a
small pilot, initially limited to five servers including the owner's server.

## Joining with your guild

1. Ask the Guilded owner to approve your **Discord server ID**. In Discord's user
   settings, enable Developer Mode, then right-click your server and copy its ID.
2. Once approval is active, the owner sends you a server-specific invitation.
   Open it as a server owner or someone allowed to manage that server.
3. Run **`/setup start`** in your server. Choose English or French, your timezone,
   and the features/channels you want. Use `/setup start status:true` to check
   anything still missing. Move Guilded's bot role above roles it needs to assign.
4. Members can use community activities and polls immediately; they do not need
   linked WoW characters for those features.
5. For WoW features, install the addon. The owner provides the shared browser
   companion address. Enter **your own Discord server ID**, then use your personal
   `/character pair` code. Every member pairs separately. The desktop companion is
   optional; see the [member guide](MEMBER_INSTALL.md).

An invitation is not an approval. Changing the server ID in a copied invite does
not grant access. Unapproved servers are refused; old companion credentials also
stop working there. Reapproval does not erase saved guild data.

## FAQ and AI

Normal saved FAQ and built-in answers remain available. Reading questions in an
answer channel requires the host's Message Content Intent. Optional AI starts
**off for each new guild**. A guild officer can opt in with `/mod faq ai`, if the
host has configured an AI provider.

All guilds share the host's daily AI budget (100 provider attempts by default),
with a separate 100-attempt ceiling per guild. These limits reset at midnight UTC,
survive restarts, and count failed provider requests too. Reaching a limit stops
AI requests; it does not disable saved FAQ, polls, raids or community points.
If enabled, the provider receives the question and selected guild facts needed
for the answer. Keep private officer information out of public FAQ entries.

## For the host owner

Deploy the pilot code and database migration through the normal release gates
before enabling invitations. In the **live service directory**, use the owner CLI:

```text
npm run pilot -- status
npm run pilot -- enable
npm run pilot -- approve DISCORD_SERVER_ID
```

These commands edit only `HOSTED_PILOT` and `HOSTED_GUILD_IDS` in `.env.local`.
The primary `DISCORD_GUILD_ID` is always approved. Approve any existing personal
test server you intend to retain before restarting. Do not automatically approve
every server the bot happens to be in. The default `HOSTED_GUILD_LIMIT=5` counts
the primary server and rejects excess approvals.

On Oracle, apply changes with `sudo systemctl restart guilded` and verify
`sudo systemctl is-active guilded` and the HTTPS `/health` endpoint. Run the CLI
with an account allowed to edit `/opt/guilded/.env.local`; don't paste that file
into chat. Then generate the invitation:

```text
npm run pilot -- invite DISCORD_SERVER_ID
```

The URL selects the approved server and requests the setup permissions, without
Administrator. In the Discord Developer Portal, enable **Guild Install**, the
`bot` and `applications.commands` scopes, and **Public Bot** if other server
owners will invite it. Keep Require OAuth2 Code Grant off for the simple bot
invite flow. The application setting does not replace Guilded's approval checks.
See [Discord's authorization documentation](https://docs.discord.com/developers/topics/oauth2#bot-authorization-flow).

To withdraw approval:

```text
npm run pilot -- revoke DISCORD_SERVER_ID
```

Restart the service to apply it. It leaves unapproved servers, blocks their
commands and companion requests, and excludes their pending scheduled work.
Guild records are retained so an accidental revocation is recoverable. This is
not a data deletion command. Keep the current server environment when deploying;
approval changes made only in a local checkout do not update Oracle.

`AI_GLOBAL_DAILY_LIMIT` caps attempts across the whole host; `AI_DAILY_LIMIT`
caps attempts per guild. Either can be zero to stop provider requests. These are
request limits, not a currency guarantee: configure provider-side billing limits
too. Usage is in `AiDailyUsage`, with UTC day, global/guild scope and attempts;
usage older than 90 days is pruned. Questions and credentials are not stored there.

## Hosting budget and launch checks

This change skips database reads for empty/solo voice channels and removes a
redundant keepalive. **Scheduled jobs still query the database every minute.**
Do not assume Neon can sleep or that a shared bot will fit a free compute tier.
Before adding more guilds, measure database compute, storage, server memory and
AI usage in the existing provider dashboards. Keep the pilot bounded until a full
activity cycle has been observed. Removing FAQ alone would not fix always-active
database compute.

For every approved guild, check setup as an admin and as an ordinary member,
personal pairing, a community poll and a scheduled announcement. Confirm a
credential from another guild is rejected. Automated tests cover approval
validation, companion admission, guild-scoped credential lookup, and concurrent
AI reservations; they do not replace live Discord acceptance in a new guild.

Independent hosting remains supported with `HOSTED_PILOT=false`; use the
[owner walkthrough](OWNER_WALKTHROUGH.md) for that path.
