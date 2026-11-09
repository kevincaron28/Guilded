# Guild invite queue (8.5, owner batch 3 items 13 and 14)

Québec Gold recruits through Discord: players post their in-game name, officers invite them by hand. This feature makes
that a queue. On by default in every server, with off switches; automatic actions follow `previewAllows()`
(`FEATURE_PREVIEW_GUILD_IDS`), so a preview server can test it first.

## How it works

1. **Channel.** `/setup` knows a guild-invite channel (`guild-invites`, French `invitation-guilde`, field
   `inviteChannelId`). "Create missing channels" adopts an existing channel with either name (any category, its own
   permissions kept) and rewrites its topic to explain the use. It is open to everyone: newcomers have not got a role yet.
2. **A post.** The bot reads a full Forever name (First Last) in that channel (`src/services/invite-queue.ts`
   `parseInviteName`), stores an `InviteRequest` and reacts 👀. Anything it cannot read gets a short hint reply that deletes
   itself after 45 seconds (officers are never hinted). Reading text needs `MESSAGE_CONTENT_INTENT=true`; without it the
   channel is simply not watched, and the reaction and DM parts still work.
3. **Officers see the queue.**
   - Discord: `/mod invites list`, `/mod invites done name:<First Last>`, `/mod invites settings` (`queue`, `dm`, `role`).
     It lives under `/mod` because `/officer` is at Discord's size limit.
   - In game: the officer's companion writes `GuildedInvites` into `Standings.lua` (officer uploads only, names only, no Discord
     IDs; `personal` part of the standings feed). The addon's **To invite** panel (`/guilded invites`, `Modules/InviteQueue.lua`)
     shows each name with its own **Invite** button: one click, one `GuildInvite`. It hides names already in the guild roster
     and prints a one-line reminder 25 seconds after login. `/guilded invites list` gives copyable `/ginvite First Last` lines.
     The list never leaves the officer's computer (it is not rebroadcast over the guild channel).
4. **Done.** A name is done when it appears in an officer's roster upload, or when an officer reacts ✅ on the post, or with
   `/mod invites done`. The bot then adds ✅ on every waiting post of that name and removes its 👀.
5. **Role DM.** When a member is given the server's World of Warcraft role (chosen with `/mod invites settings role:`, else the
   first role named like "World of Warcraft" / "WoW"), the bot sends one DM linking the channel and asking for the full
   character name. Once per member (`InviteDm`), skipped when they already posted or have a linked character, quiet when DMs
   are closed.
6. **Retiring an old channel.** `/setup` checklist, button **Retire an old channel**: pick the channel, the bot saves all its
   messages to a text file in the officer log channel (or the current channel), and only then shows a red **Delete #name for
   good** button. Nothing is deleted before that click, a plan expires after 15 minutes, and channels Guilded itself uses are
   refused (`src/services/channel-retire.ts`).

## Off switches

`/mod invites settings queue:false` stops the whole queue (posts, reactions, hints, the in-game list stays empty of new names);
`dm:false` stops only the role DM. Both default to on.

## Still to verify with real clients

Post in the live channel, see 👀; upload an officer roster containing the name and see ✅; the **To invite** panel in game on a
real client (`GuildInvite` and `CanGuildInvite` exist on the Forever client); the role DM in a server where the role is given.

## Light recruiting kit (9.0)

On top of the queue, written from scratch (the idea comes from Kinfolk; no code was copied):

- **Recruit record.** Each `InviteRequest` now carries who invited and when (`invitedBy`, `invitedAt`), the `source` (`discord`;
  `website` is reserved for a future web form), a stage and an officer-only `note`. The stage is the existing `status`:
  `PENDING` (asked) -> `INVITED` -> `JOINED` -> `PROMOTED`. A roster upload or an officer check mark still moves asked to
  invited by itself; joined and promoted are set by hand: `/mod invites record name:<First Last> stage:<..> note:<..>`
  (`note: -` clears). Notes and answers are only shown in officer replies (`/mod invites list`).
- **Interview questions.** `/mod invites questions text:"Class? | Raid nights? | Why us?"` (up to five; `-` clears). They are added to
  the World of Warcraft role DM and to a pinned message in the invite channel that the bot keeps up to date. A member answers
  by writing one answer per line under their name in the channel; the lines under the name are saved as `answers` on the record.
- **Recruiting post and cooldown.** `/mod invites post text:<template> hours:<n>` sets the template and the shared cooldown
  (default 72 h). Post it yourself, then run `/mod invites post posted:true`: the cooldown starts for the whole guild, and a
  second officer is told who posted and when it is free again. When it is over the bot sends one reminder in the officer log
  (hourly check, preview-gated). The bot never posts the recruiting message for you.

Migration `20261230000001_recruiting_kit`. Command size: `/mod` is at 3,888 of the 3,900 test margin, so the `invites`
descriptions are deliberately terse; any new `/mod` text needs trimming elsewhere.

## Request a guild invite button (9.0, owner request)

A member who picks World of Warcraft in the onboarding game menu, or receives the World of Warcraft role DM, sees a
**Request a guild invite** button (`src/services/invite-request.ts`). It opens a form for the full character name (First Last,
validated with `parseInviteName`). On submit the bot posts `<@member> → **First Last**` in the invite channel itself
(mentions switched off, so nobody is pinged), queues it with 👀 and confirms privately with a link to the channel.
A plain DM reply that looks like a full name works too, but only for members the bot already asked (`InviteDm`), so the bot
does not react to random DMs (`DirectMessages` intent plus the channel partial). One request per member per character; a
repeat is answered "already asked" and posts nothing. Follows `queue` and `previewAllows()` like the rest of the queue.

## Why a joined player kept the 👀 (fix, 7 Nov 2026)

Reported on a live post ("Drakka Whitefang"): the player joined in game, the post never got ✅. Cause: the roster check only
looked at the **uploading officer's own characters** (`snapshot.character`/`characters`), never at the guild roster the upload
carries, so a newcomer could only be matched if they happened to be one of that officer's alts. It also ran only on officer
uploads and never at start-up.

Now: `markInvitedByName` compares names folded for case, accents and a `-Realm` suffix, and a first-name-only roster row (older
uploads) matches when exactly one waiting name starts with it. `backCheckInvites` checks every waiting request against the stored
`GuildRosterEntry` rows (`inGuild`) plus linked characters; it runs after any upload that brings a guild roster, at bot start-up,
and hourly. Posts the bot made itself (the **Request a guild invite** flow) carry an officer button **✅ Invited / joined**
(`invite:done:<server>`); player-typed posts keep the officer's ✅ reaction, `/mod invites record` and the in-game list.

## Pre-linking from the invite channel (7 November 2026)

Asking for an invite (button or a typed name) records the name as a request and makes sure the asker has a member row. When any upload then shows that full name in the guild (the uploader's own or guildmates' characters with a class, or the stored guild roster), `src/services/invite-prelink.ts` links the character to the asker, writes a `PROVISIONAL` verify claim (an officer upload or `/guilded verify` still confirms or moves it) and sends one DM (`invite.prelinked`) plus a log-channel line. It never links a name already linked to anyone, a name two people asked for, a first-name-only request, or a character that member unlinked (`BLOCKED`/`REMOVED`).

The welcome panel has a **WoW chat ↔ Discord** button (`onboard:chat`) that explains Blizzard's guild Discord integration and how to link a character. The bot has no guild-chat relay of its own, so the text does not describe one.

## Tagging online officers (7 November 2026)

When someone asks for an invite (button or typed name), `src/services/invite-notify.ts` replies under the request once, tagging up to 3 linked members in the guild's top ranks (guild master plus ranks 1-2) whose character the latest roster upload shows online (last online within 10 minutes; never Discord presence). Nobody known online: it pings the officer role once. `notifiedAt` on the request makes it once per request; `/mod invites settings notify:false` turns it off (on by default). Mentions are limited to exactly the tagged users or role.

## Anyone online can invite, and the bot notices the invite (7 November)

Owner decision: everyone in the guild can invite in game. The "online" tag now picks up to three **guild members** (any rank) whose linked character the roster shows online in the last 10 minutes, most recently online first; the officer-role fallback and the `/mod invites settings notify` off switch are unchanged.

The bot already marks a request done when the character shows up in a roster upload or the stored roster (companion or addon sync, plus an hourly back-check). Now, when that happens, it also edits the tag message ("online?") into a plain "joined the guild, welcome" note (an edit never pings, so the tags stop), edits the bot's own request post, and thanks a member under their own typed post. The check-mark button stays as the manual fallback. `InviteRequest.notifyMessageId` (migration `20270120000200_invite_notify_message`) remembers the tag message.
