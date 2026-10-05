# Guilded 6.0.0: quick setup

Choose your path first. The addon works alone; Discord synchronization adds a
companion and a bot that one guild owner hosts.

New to hosting? Open the [illustrated owner walkthrough](OWNER_WALKTHROUGH.md)
for account links, Discord/Oracle screenshots and copyable commands.

| You are | Download | Setup target |
| --- | --- | --- |
| Addon-only player | `Guilded-v6.0.0.zip` | 5–10 minutes |
| Member of a configured guild | Addon + `Guilded Companion Setup 6.0.0.exe` | 10–15 minutes |
| Owner setting up Discord sync | Matching bot source + addon + companion | About 30 minutes **after infrastructure is ready** |

These are planning estimates, not measured acceptance results. Public release
downloads must actually be present on [GitHub Releases](https://github.com/kevincaron28/Guilded/releases)
or [CurseForge](https://www.curseforge.com/wow/addons/guilded). A local build is not a published download.
For a private test, use the matching files supplied by the maintainer.

## Members: three steps

1. Close WoW and extract **Guilded** into your actual client's `Interface/AddOns`.
   Check `Guilded/Guilded.toc` exists. Open WoW, open Guilded, then `/reload`.
2. Install the companion. In **Connection & setup**, enter your guild's bot address
   and Discord server ID. Run `/character pair` in that server and enter your private code.
3. Enable WoW, use **Find it** to select your account's saved `Guilded.lua`, and
   **Save & start syncing**. `/reload`, wait for upload and standings success,
   then `/reload` again.

Addon-only users stop after step 1. See [Member installation](MEMBER_INSTALL.md)
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

## Owners: before starting the timer

Have these ready:

- A Discord server you manage and access to the Discord Developer Portal.
- A dedicated Ubuntu 22.04/24.04 server with SSH/sudo access.
- An empty PostgreSQL 16+ database and its connection string.
- Your own DNS hostname pointing to the server, with TCP 80/443 allowed by its
  cloud firewall. The server needs outbound internet access for installation.
- Matching release source, addon ZIP and companion installer.

New cloud accounts, payment verification, available server capacity and DNS
propagation can take longer than 30 minutes. There is currently no shared public
Guilded bot or one-click managed hosting included in these downloads.

## Owners: the 30-minute target

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
