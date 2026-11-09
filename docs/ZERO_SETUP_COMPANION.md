# Zero-setup companion

Owner decision, 9 November 2026: install the Windows companion once and it syncs. It finds the WoW
folder, the bot picks the Discord server from the character's in-game guild, and uploads start with
no sign-in. Discord sign-in becomes optional: it is only for personal things (Discord DMs, the
member's website page, confirming characters). Data from an unsigned companion is "reported" until
confirmed.

## How it works

1. **First start, nothing to choose.** `companion-app/main.cjs` `zeroSetupStep()` runs when no
   connection is signed in (never on a signed-in install, never for a leaderboards-only one):
   - the bot address defaults to the hosted bot;
   - the WoW folder is found the same way as *Find my addon data* (`detectSavedVariables`,
     `pickPrimaryAccount`). Not found, or several WoW accounts: the window keeps its one folder
     picker (the existing "Find WoW" card);
   - `POST /api/v1/device/register` returns a random 256-bit device key. The companion keeps it in
     its encrypted settings (`deviceSecret`, Windows protected storage); the bot keeps only its
     SHA-256 hash (`CompanionDevice.tokenHash`). The window never receives it
     (`ipc-security.cjs` `rendererConfig`).
   - The step retries every 5 minutes until it works. An older bot (404) leaves the companion as it
     was: Sign in with Discord still works.
2. **Uploads.** In device mode (`engine.mjs` `isDeviceMode`) the engine sends
   `POST /api/v1/device/uploads` with the `x-companion-device` header and only:
   the in-game guild (`GuildedDB.guildKey`, split into name and realm) and up to 12 characters on
   this PC (name, realm, class, race, level). Nothing else from the saved file leaves the PC:
   no EP/GP ledger, loot, ranks, guild roster, bank, runs or votes (`device-sync.mjs`
   `deviceUploadBody`). No standings are fetched before a sign-in.
3. **Which server.** `companion-device.ts` `pickServer`: the `WowGuild` rows `/setup` registered for
   that guild name and realm (WoW Forever). One: that one. Several Discord servers: the ones whose
   officers' companion syncs (`Guild.officerSyncAt`); still several: the member picks once under
   *Advanced: choose server* on the Sync page (remembered as `chosenGuildId`). None: the data waits
   and the companion says "Your guild … isn't set up on Discord yet". Guilded Lite servers are left
   out (`hostedPilot.allows`).
4. **Reported.** The bot stores the characters as `DeviceCharacter` rows of the device, never as a
   member's `Character`. Officers see them in `/roster gaps` under "Reported by a companion without
   Discord sign-in" (until a member links them).
5. **Claim.** Sign in with Discord in the same companion (the usual flow). The sign-in start sends
   the device key, so the website's server list puts the device's server first. After the sign-in,
   the companion calls `POST /api/v1/device/claim` with both the device key and the new member
   credential: the device becomes that member's (`claimedMemberId`), and the companion drops its
   device key and switches to the normal signed-in upload. That upload links and **confirms** the
   characters (`Character.confirmedAt`) and sends everything else, as before.

Signed-in companions are unchanged: they never get a device key, and every existing endpoint still
requires a personal credential.

## Threat model (short)

Anyone can install the companion and write any SavedVariables file, so an unsigned upload proves
nothing about who sends it.

| Threat | Defence |
| --- | --- |
| Pose as a member to change their data | Device uploads write only `DeviceCharacter` rows of that device. They never touch `Character`, `Member`, the EP/GP ledger, loot, ranks, guild roster/bank/events, crafting orders, votes or map data: those paths still need a member credential (`companionAccess`). No global write bypass exists. |
| Take over a member's account through a device | Only a Discord sign-in claims a device (member credential + device key in one request). A device already claimed by one member can never be claimed by another (409). A `/guilded verify` code is **not** a device proof: the addon broadcasts it to guildmates (Core.lua `|V:` digest), so any guildmate's saved file may hold it. Verify and officer links still confirm *characters*, not devices. |
| Pump public rankings or scores | Device uploads send no dungeon runs; public runs still come only from signed-in personal or guild uploads with the #203 evidence rules (party confirmations, integrity). Many fake devices therefore cannot "confirm" a run. |
| Flood the bot (1 GB server) | Registration: 5 per IP per hour at the bot plus the Worker's pairing limiter. Uploads: 30 per device and 120 per IP per hour. 12 characters per upload and per device (known ones keep updating). Strict schema (unknown fields dropped, names without `|` or control characters). Unknown keys count toward the shared failed-auth lockout. |
| Steal a device key | It only lets the thief report characters for that device. It is never logged (engine redaction) and never shown in the window. Signing in drops it. |
| Guild name squatting (a second server registers the same guild) | The server with officer syncs wins; otherwise the member chooses. A wrong pick costs only reported rows; nothing is linked until the member signs in and picks the server on the website. |

Data protection: a device row holds no Discord ID until claimed. Deleting a member (Delete my data)
sets `claimedMemberId` to null through the foreign key.

## What the owner should test (fresh Windows PC, no sign-in)

1. Install the companion (direct download or Store build with this change) on a PC where it was
   never signed in. Start WoW Forever with the Guilded addon, log in on a character in a guild that
   `/setup` registered (QG), `/reload`.
2. Open the companion, choose nothing. Within a minute the Sync card says **"Syncing to <server>
   (from your guild <guild>)"** with the button *Sign in with Discord to confirm your characters*.
3. In Discord, as an officer: `/roster gaps` lists the character under "Reported by a companion
   without Discord sign-in".
4. On a character whose guild is not set up anywhere: the card says "Your guild … isn't set up on
   Discord yet".
5. Press *Sign in with Discord to confirm your characters*: the website shows the guild's server
   first; Connect. Back in the companion: Activity says "This PC's earlier uploads now belong to your
   Discord account"; the next sync links the characters as **confirmed** (`/character list`), and
   standings arrive in game after `/reload`.
6. An existing signed-in install (the owner's PC): update and check nothing changed (no device key in
   the log, same server, uploads as before).
7. French: switch the companion to Français and check the Sync card and *Avancé : choisir le serveur*.

## Shipping notes (coordinator)

- Migration `20270129000000_companion_devices` (two new tables, no change to existing ones).
- The website Worker must be redeployed for `/api/v1/device/*` (allow-list in `worker/index.mjs`).
  Until then the companion's registration gets 404 and it simply stays on Sign in with Discord.
- Companion change: needs a companion release (and the Store package) to reach members.
