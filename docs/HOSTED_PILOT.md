# Guilded hosted bot (free)

The hosted bot lets guilds use the same running Guilded bot for free. Your guild
does not need to download the bot, create a database, or keep a computer running.
Every server starts on Guilded Lite right away; full Guilded needs the Guilded owner's
approval for each Discord server, given by hand or automatically once a server is
set up and active (see below). Hosting capacity is limited, so approval is not guaranteed.

**[Add Guilded to your server](https://discord.com/oauth2/authorize?client_id=1552633893587394590&scope=bot+applications.commands&integration_type=0&permissions=2269718703631440)**

Adding the bot puts your server on **Guilded Lite** straight away and sends KCaron a
request. **Full Guilded unlocks with KCaron's approval.** When the host has turned on
automatic approval, it also unlocks by itself after a few days once you ran
`/setup start`, your server has a few members and someone used Guilded that week.

## What Guilded Lite includes

While your server waits for approval (up to 50 servers at a time):

| Included in Lite | Unlocked by approval |
| --- | --- |
| `/setup start`: language, roles and channels (steps 1 to 4, then the checklist) | Welcome, auto-roles, EPGP and automation steps of `/setup start` |
| `/help` | Addon and companion sync, `/character pair` |
| `/mod faq` (saved answers) | EPGP, loot, raid cores, seasons, attendance |
| `/report bug` and `/report ping` | Community activities, polls, participation points |
| `/dungeon group` | Dungeon leaderboards and records |
| Basic `/raid` signups: create (without core or weekly repeat), edit, cancel, signup, status, roster | Weekly reports, reminders and every scheduled job |
| | The public guild page |

When the server is approved, every command appears right away (no reinvite).
If the 50 Lite places are taken, your server waits with no access, as before.
A Lite server where nobody uses a command for 30 days gets a notice (system channel,
or the server owner's DMs); if nobody uses one in the next 7 days, Guilded leaves
to free the place. You can add it back later.
The hosted bot is free. Optional support never buys approval or priority.

## Joining with your guild

1. Open the **Add Guilded to your server** link above as a server
   owner or someone allowed to manage your server.
2. Guilded starts on Lite (see above) and sends its application owner a private
   Discord message with **Approve** and **Block** buttons. You can run
   `/setup start` for roles and channels now; the rest unlocks on approval.
   The owner can also preapprove your server ID and send a server-specific invite.
   When the server is approved from that message, Guilded sends **the server's owner**
   a private welcome (English and French) with the next steps below. Keep DMs from
   server members open to receive it; the server's system channel also gets a greeting.
3. Run **`/setup start`** in your server. Choose English or French, your timezone,
   and the features/channels you want. Use `/setup start status:true` to check
   anything still missing. Move Guilded's bot role above roles it needs to assign.
4. Members can use community activities and polls immediately; they do not need
   linked WoW characters for those features.
5. For WoW features, install the addon. The owner provides the shared browser
   [online companion](https://guilded.kcaron.top/companion/). Choose **Sign in with Discord**,
   then your server. Older companions can use the private one-time code from
   `/character pair`. Every member connects separately. The desktop companion is
   optional; see the [member guide](MEMBER_INSTALL.md).

An invitation is not an approval. Changing the server ID in a copied invite does
not grant full access. Unapproved servers get Lite at most; companion credentials
do not work there. Reapproval does not erase saved guild data.

<section id="fr" lang="fr" aria-label="Bot Discord en français">

## Ajouter le bot : gratuit et facultatif

L'addon Guilded fonctionne sans Discord. Pour les inscriptions aux raids,
les classements connectés et les activités Discord, votre guilde peut demander
l'accès au bot hébergé. Aucun hébergement ni base de données n'est à créer
pour une guilde approuvée. Le serveur commence en Guilded Lite tout de suite; tout
Guilded se débloque avec l'approbation de KCaron, ou automatiquement après quelques
jours si l'hôte l'a activé et que le serveur est configuré et actif.

1. Un propriétaire ou gestionnaire du serveur utilise **Add Guilded to your server**.
2. Le serveur passe tout de suite en **Guilded Lite** (50 serveurs au plus) :
   `/setup start` pour les rôles et les salons, `/help`, `/mod faq`, `/report bug`,
   `/dungeon group` et les inscriptions `/raid` simples (sans core ni répétition).
   L'approbation de KCaron débloque tout le reste : synchronisation de l'addon,
   EPGP, saisons, activités, page de guilde et tâches planifiées.
   Un serveur Lite sans aucune commande pendant 30 jours reçoit un avis; sans
   commande dans les 7 jours suivants, Guilded quitte le serveur pour libérer la place.
   Le plafond est de **cinq serveurs, celui du propriétaire inclus**; les places
   dépendent de la capacité disponible. Aucun délai d'admission n'est garanti.
3. Après l'accord, lancez `/setup start`, choisissez la langue et les fonctions,
   puis contrôlez `/setup start status:true`. Placez le rôle du bot au-dessus
   des rôles qu'il doit attribuer.
4. Testez un membre ordinaire et un officier. Les sondages et activités communautaires
   ne nécessitent ni addon WoW, ni personnage lié.
5. Pour synchroniser WoW, installez l'addon. Dans le compagnon, chaque membre
   choisit **Sign in with Discord**, puis son serveur. Les anciens compagnons
   peuvent utiliser le code privé à usage unique de `/character pair`.
   Faites `/reload`, synchronisez, vérifiez le bon personnage et rechargez les classements.

Le bot hébergé et l'addon restent gratuits. Le soutien Ko-fi est facultatif et ne
donne ni approbation, ni priorité, ni permissions supplémentaires. L'hébergement
indépendant reste possible pour les guildes qui disposent de leur infrastructure.

[Installation et dépannage](MEMBER_INSTALL.md#fr) · [Fonctionnement EPGP](EPGP_GUIDE.md#fr)

</section>

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

### Approve from Discord

`npm run pilot -- request-link` prints the invitation you can share with applicants.
Inviting requests access; it never grants approval. New servers start on Guilded Lite
(see above) until the Discord application's owner clicks **Approve** in the bot's DM.
`HOSTED_LITE_LIMIT` (default 50, separate from `HOSTED_GUILD_LIMIT`) caps how many
waiting servers get Lite; `0` restores the old behaviour (no access until approved).
Lite servers get only the Lite command list (`src/commands/lite.ts`); any other
command is refused even if an old registration is still visible. Scheduled jobs,
the companion API and guild pages check full approval only, so Lite servers get no
sync, EPGP, seasons or public page.
For team-owned applications, only the team's owner receives and can use these buttons.
The DM shows the server name, ID, owner ID and member count. Names are unverified
labels; verify the ID before admitting a server.

Approval respects the five-server cap, saves to `.env.local`, updates access
immediately and registers the setup commands without restarting. It then DMs the
approved server's owner a bilingual welcome (`src/services/pilot-welcome.ts`); your
confirmation says whether that DM was delivered. A closed DM never undoes the approval.
CLI approvals (`npm run pilot -- approve`) do not send it. **Block** (also from Lite) saves
the decision, leaves the server and silently leaves on subsequent invitations.
Only an explicit owner CLI approval overrides a block. Duplicate or old buttons
cannot change a completed decision. Keep DMs from Guilded enabled; delivery
failures retry hourly and after restart (Lite, if granted, stays on meanwhile).
When the bot is removed from a waiting server, its entry is dropped and the Lite place freed.
An hourly check warns Lite servers idle for 30 days (`warnIdleLite` in
`src/services/pilot-welcome.ts`) and leaves them 7 days later if still unused; any
command use resets the clock. Leaving for inactivity drops the entry (it is not a
block), so a later invite sends you a new request.

### Automatic approval

Off by default. Set `HOSTED_AUTO_APPROVE_DAYS` (1-60) in `.env.local` and the hourly check
approves a Lite server by itself once it has been on Lite that many days, ran `/setup start`
(its bot-guide channel exists), has at least `HOSTED_AUTO_APPROVE_MEMBERS` Discord members
(default 5) and used a command in the last 7 days. Your request DM shows the date; **Block**
before then is the veto. An automatic approval follows the same path as the button (saved to
`.env.local`, commands registered, owner welcome) and sends you a DM with the server, its member
count and `npm run pilot -- revoke ID`. It respects `HOSTED_GUILD_LIMIT` (raise it, up to 100,
to leave room); when full, waiting servers stay on Lite. Restart the bot after editing these values.

Pending, Lite and block decisions and delivered-message IDs live in
`backups/pilot-requests.json` (private, preserved by deployment). Back up this
file alongside `.env.local`. There are at most 100 pending requests; additional
unapproved invites are left until that queue is reduced. Already-approved guilds
do not generate approval DMs. A lost/deleted request DM can be recovered by the
owner CLI using its server ID.

### CLI fallback

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

Restart the service to apply CLI changes. It disables unapproved servers, blocks their
commands and companion requests, and excludes their pending scheduled work.
Guild records are retained so an accidental revocation is recoverable. This is
not a data deletion command. Keep the current server environment when deploying;
approval changes made only in a local checkout do not update Oracle.

### Pilot rollout and optional support

Start by approving only a couple of additional guilds. The five-server cap
includes the owner's server and any approved test server; it is a safety ceiling,
not a target that must be filled. Check each guild's setup, pairing and activity
before approving the next one. No guild is approved automatically; Lite is not approval.

[Support Guilded](SUPPORT_GUILDED.md) explains voluntary support. Donations do
not unlock the addon, hosted approval, extra permissions or a guaranteed uptime.

`AI_GLOBAL_DAILY_LIMIT` caps attempts across the whole host; `AI_DAILY_LIMIT`
caps attempts per guild. Either can be zero to stop provider requests. These are
request limits, not a currency guarantee: configure provider-side billing limits
too. Usage is in `AiDailyUsage`, with UTC day, global/guild scope and attempts;
usage older than 90 days is pruned. Questions and credentials are not stored there.

## Hosting budget and launch checks

This change skips database reads for empty/solo voice channels and removes a
redundant keepalive. Completed delivery cleanup now runs with six-hour retention
instead of every minute (four scheduled checks/day instead of 1,440). Leaderboards
fetch only the three point fields they need. Admission decisions use local files,
not database polling. **Scheduled jobs still query the database every minute.**
Production moved from Neon to Aiven Free on 9 October 2026. See the
[migration record](AIVEN_MIGRATION.md). Aiven avoids a monthly compute-hour budget,
but its storage, memory and connection limits still require monitoring.
Do not assume a shared bot can grow indefinitely on free hosting.
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
