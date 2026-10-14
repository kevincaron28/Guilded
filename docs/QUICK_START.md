# Guilded: quick setup

**Start with the addon only (default).** The addon works alone; optional Discord synchronization adds a
companion and either the approved hosted bot or your independently hosted bot.

**Want to add the existing Guilded bot? [Request hosted pilot access](HOSTED_PILOT.md).**
KCaron must approve your Discord server first. Invite, wait for approval, then
run `/setup start` and pair with the online companion. This free pilot accepts
only a small number of guilds; no hosting accounts are needed for approved guilds.

New to hosting? Open the [illustrated owner walkthrough](OWNER_WALKTHROUGH.md)
for account links, Discord/Oracle screenshots and copyable commands.

| You are | Download | Setup target |
| --- | --- | --- |
| Addon-only player | `Guilded-v6.0.0.zip` | 5–10 minutes |
| Member of a configured guild | Addon; Discord linking and companion sync are optional | 5–10 minutes for the addon |
| Owner joining the hosted pilot | Addon + hosted bot invitation + online companion | Owner approval first; setup time depends on your server |
| Owner setting up Discord sync | Matching bot source + addon + companion | About 30 minutes **after infrastructure is ready** |

These are planning estimates, not measured acceptance results. Public release
downloads must actually be present on [GitHub Releases](https://github.com/kevincaron28/Guilded/releases)
or [CurseForge](https://www.curseforge.com/wow/addons/guilded). A local build is not a published download.
For a private test, use the matching files supplied by the maintainer.

## Hosted guild owners: three steps

1. [Request pilot access](HOSTED_PILOT.md) and wait for KCaron's approval.
   An invite alone does not activate the bot.
2. After approval, run `/setup start` in Discord. Choose your language and
   features, place the bot role above roles it must assign, then run
   `/setup start status:true` to find missing settings.
3. For WoW sync, follow the member steps below with one player first. Confirm
   that their character and standings match in Discord and in game, then share
   [the member guide](MEMBER_INSTALL.md) with your guild. Use the
   [hosted companion](https://guilded-wow.kcaron.workers.dev/companion/) and your
   own Discord server ID.

Community activities and polls need no WoW addon or character pairing. Hosted
owners can stop here; the independent hosting sections below are optional.

## Members: addon only by default

1. Close WoW and extract **Guilded** into your actual client's `Interface/AddOns`.
   Check `Guilded/Guilded.toc` exists. Open WoW, open Guilded, then `/reload`.
2. Use **In-game only** in `/guilded setup` and start playing. You can stop here.
   New candidate source selects this mode automatically; published builds may
   show the chooser. No Discord character link or companion is required.

### Optional: link a main and alts without a companion

Press **Link my WoW character / Lier mon personnage WoW** in the welcome panel.
Log in on your intended main and copy `/guilded character` into Discord's
`/character import` → **code**, leaving **main** unset. The first character is
your main. Repeat on each alt with **main** unset; your main stays the same.
`/character list` confirms the result. Viewing the instructions does not generate
a companion connection code.

### Optional: connect the online companion

1. Choose **Connect optional companion** in that private reply, or use
   `/character pair`. Open its online companion button. The link prefills the
   server ID on a first visit; check it, enter your private code, then **Connect**.
2. Enable WoW and choose your account's SavedVariables folder. Use **Save standings
   to addon** once to choose `Interface/AddOns/Guilded`. After `/reload`, click
   **Sync now** on your main first if none is linked. Choose
   `/guilded setup connected` for Discord standings, then `/reload` again.

The Windows companion is optional for automatic file watching, background sync
and PoE2 log tracking, especially useful for leaders and officers.

**Already connected with a main?** Log in on an alt, `/reload`, then **Sync now**
with the same companion. Your main stays linked; no new code needed. A new code
is for connecting or reconnecting a companion, and using it replaces the previous
companion connection. `/character list` shows the result after syncing.

See [Member installation](MEMBER_INSTALL.md)
for the detailed UI steps, the manual browser option, French steps and fixes.

### Online companion folders

The Windows companion remembers Guilded.lua and derives the addon folder from
its WTF path. In the online companion, choose two folders once on each PC:
`WTF/Account/<your account>/SavedVariables` for reading and
`Interface/AddOns/Guilded` with **Save standings to addon** for writing.
Supported browsers remember those choices locally. Once output access is allowed,
**Sync now** uploads and saves returned standings together.
Use `/reload` before syncing and again afterward to load the new standings.
If the browser asks to renew access, use **Save standings to addon** again.
No fixed drive or account path is assumed for other players.

## Independent hosting only: before starting the timer

Have these ready:

- A Discord server you manage and access to the Discord Developer Portal.
- A dedicated Ubuntu 22.04/24.04 server with SSH/sudo access.
- An empty PostgreSQL 16+ database and its connection string.
- Your own DNS hostname pointing to the server, with TCP 80/443 allowed by its
  cloud firewall. The server needs outbound internet access for installation.
- Matching release source and addon ZIP; optional Windows companion installer.

New cloud accounts, payment verification, available server capacity and DNS
propagation can take longer than 30 minutes. These infrastructure requirements apply only to independent hosting. Approved
[hosted pilot](HOSTED_PILOT.md) guilds use the existing bot and skip these steps.

## Independent hosting only: the 30-minute target

| Target | Action | Visible success |
| --- | --- | --- |
| Minutes 0–5 | Create your Discord application, enable Server Members Intent, invite it with the documented permissions, move its role above managed roles | Correct bot is in your server |
| Minutes 5–15 | Run the Ubuntu installer from the selected source, fill four required settings, run `setup:check`, start the service | Public `/health` and `/companion/` open; `/report ping` responds |
| Minutes 15–22 | `/setup start`: choose language, create missing roles/channels, update bot messages; `/core setup` for your first roster | Setup status shows the required roles/channels configured |
| Minutes 22–30 | Pair one officer, upload after `/reload`, load returned standings, give members the filled-in pinned handout | Correct character and standings appear |

Follow [Guild owner setup](GUILD_OWNER_SETUP.md) for Discord and configuration,
and [Ubuntu hosting](DEPLOY_ORACLE.md) for the exact installation commands.
Leave AI answers, Warcraft Logs and optional community features off until basic sync works.

Before guild-wide rollout, also test an ordinary member's access. Continue the
fresh-PC, recovery and real-raid follow-up checks in the
[release testing record](V6_0_RELEASE_TESTING.md). Setup speed alone does not prove
permissions, accounting or recovery work.
