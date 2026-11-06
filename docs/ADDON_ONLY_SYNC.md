# Addon-only members still sync (8.5, Track K)

Goal: a member who never installs the companion still has their data reach Discord and the
website, through any guildmate whose companion is running. Written 6 November 2026 on
`claude/track-k-sync-254114` from `main` 06f12f14 (8.4.7).

## How data leaves a PC

There are only two ways out of the game: the member's own companion uploads their saved data, or
the member's addon tells guildmates in game (addon messages) and a guildmate's companion uploads
what that guildmate's addon heard. The second path already existed for most fields, but the bot
kept guildmates' data only from an **officer's** upload: a paired member's upload was cut down to
that member's own characters (`personalSnapshot`, `src/services/companion-access.ts`), and even
lost that member's own dungeon runs. So an addon-only member reached Discord only while an officer
with the companion was online with them.

## Audit, field by field (before this change)

| Data | Travels by addon message? | Kept by guildmates' addons | Officer's companion upload | Member's companion upload |
| --- | --- | --- | --- | --- |
| Character identity: class, race, level, spec | Yes: `READINESS` digest, `I:` field (Core.lua), GUILD, at login, on change, 10 min heartbeat | `peerRoster[name]` under the game-reported sender, with `seenAt` | Yes (`characters`, discovery) | **Dropped** |
| Professions and skill levels | Yes: same digest, plus `P:` = the author's own clock for a complete list | `peerRoster[name].professions/professionsAt` | Yes (`relayProfessions`, apply) | **Dropped** |
| `/guilded verify` code | Yes: digest `V:` | `peerRoster[name].verify` | Links and confirms | Links provisionally (8.1, unchanged) |
| Guild rank | Read by every client from the guild roster | `roster` | Yes | Own only |
| Dungeon runs | Yes: `SUM` on GUILD after each run, `REQUEST` replay of the last 7 days (Dungeon.lua) | `dungeon.runs[id]` with `reporters` = game-reported senders who were in the run | Yes | **Dropped, own runs included** |
| Recipes and cooldowns | Yes: `GuildedRcp` (Recipes.lua) | `recipeBook.people[name]` | Yes | Own only |
| Attunements | Yes: `ATTUNEMENT|` self-reports | `attunements[name]` | Yes | Own only |
| Duels | Yes: `GuildedDuel D|` on GUILD | `duels.results` | Never (by design) | Only duels the uploader fought |
| Milestones | Announced in guild chat (`GuildedMile`) | Not kept for others | Never (by design) | Own only |
| Raid attendance, loot, reserves, calendar | Recorded by the raid leader's / officer's addon | n/a | Yes | No (officer data) |
| EP/GP ledger | Yes: LedgerSync / LedgerRelay, officer-authorized | Ledger | Yes | Never (officer authority) |
| Readiness (gear, flasks) | Yes: digest | `peerRoster` | Yes | Own only |
| Battleground reports | No (private, consent) | No | No | Own only, with consent |
| Availability | Website and Discord only | n/a | n/a | n/a |

So the most valuable gaps were level, class/race, professions and dungeon runs: all already in
every guildmate's saved data, all thrown away unless the uploader was an officer.

## What changed (this PR)

### Bot: a narrow relay lane for member uploads

`src/services/guildmate-relay.ts`, called from `src/companion-api.ts` for a paired member's upload
(officers' uploads are unchanged):

- **Characters** (`applyGuildmateRelay`): guildmates' digests update characters that are
  **already linked** in this guild. Never creates or links a character (linking stays with
  `/guilded verify`, `character-verify.ts`), never touches the uploader's own characters (their own
  upload is first-hand), and never replaces newer first-hand data:
  - level only goes up (a level never drops in game, so an older relay cannot undo a newer one);
  - class and race only fill a blank;
  - professions only from a complete list stamped by the author's own client, and only when newer
    than what is stored (`syncProfessionSnapshot`, the same rule first-hand uploads follow);
  - digests heard more than 45 days ago, without a time heard, or from the future are ignored.
  Every change stamps `Character.relayedAt` and `relayedById` (migration
  `20261223000000_guildmate_relay`): "reported by a guildmate", and by whom.
- **Dungeon runs** (`relayableDungeonRuns`, used by `personalSnapshot`): a member's upload now
  carries its own runs and guildmates' runs reported by someone who played them (the addon fills
  `reporterNames` only with the game-reported sender of a `SUM` it accepted from a participant).
  Last 30 days, newest 25 per upload. The usual checks still apply on import: `validateRun`
  requires the recorder and a reporter to be in the run, and one row per run id means a later copy
  (first-hand or from an officer) never counts twice. Provenance: `DungeonRun.importId` names the
  upload, `reporterNames` the witnesses.
- **Provenance in the upload**: the companion export adds `observedAt` (when the uploader's addon
  heard each guildmate's digest) to `characters`. Older companions omit it, and then nothing is
  relayed from a member's upload (officers' uploads are unaffected).

Still excluded from member uploads, on purpose: ledger, loot, raids, prices, reserves, calendar,
guildmates' readiness, recipes and attunements (next steps below), other players' duels and
milestones.

### Addon: what other guild addons do (Modules/GuildRelay.lua)

- **Protocol check with a "please update" line.** Every client says `HI|<protocol>|<carrier>|<version>`
  on GUILD 25 s after login. A guildmate on a newer sync protocol prints, once per session,
  "X runs a newer Guilded sync (8.6.0). Please update Guilded so your data keeps reaching Discord."
  `/guilded relay` lists guildmates on an older one. The existing `VERSION` check (Sync.lua) is
  unchanged.
- **"Synced via Lebowski, 2 h ago."** A client whose companion is connected (it wrote
  `Standings.lua` and that copy is the newest guild data the client knows) announces itself as a
  carrier every 15 minutes. Other members remember carriers for 14 days and show the most recent
  one in `/guilded relay` and in the login digest (`/guilded digest`). Meaning, stated honestly:
  that guildmate's companion was online with you then, and their next sync uploads the digest your
  addon keeps sending. It is not a receipt from the bot.
- **Visible data age and stale pruning.** Guildmates' digests not refreshed in 45 days are dropped
  at login (GuildCrafts uses 45 days); `/guilded relay` shows how many are held and the oldest age.
  The bot ignores relayed digests older than 45 days as well.
- **Hold while in an instance.** `ns.comm.send(..., "hold-in-instance")` keeps background sync
  queued (in order, guard rechecked) while the player is in a dungeon, raid, battleground, arena or
  scenario, and through messaging lockdown. Used by ledger sync (LedgerSync/LedgerRelay) and the
  relay announcements. Run tracking, ready checks and group traffic are never held.

## Plan for the remaining gaps (not in this PR)

1. **Recipes and attunements from member uploads**: same pattern (linked characters only, newer
   timestamp wins, `relayedAt`). Recipes need the per-profession `v` stamp the addon already keeps.
   Recipes.lua belongs to Track E for 8.5, so this waits for that merge.
2. **Bot-confirmed "Synced via"**: the bot knows exactly which relayed rows it applied and when
   (`relayedAt`, `relayedById`). Sending that back through the standings answer would turn the
   in-game line into a receipt. Needs a companion change (Track F area) and an addon field.
3. **Duels between two addon-only members**: today only a participant's own companion uploads a
   duel. A relayed duel would need both participants' addons to report it (two witnesses), like
   dungeon reporters.
4. **Website marking**: show "reported by a guildmate" next to relayed levels and professions,
   using `relayedAt` / `relayedById`.

## What needs a real two-client check

Not run in game. The test suite covers the rules (tests/guildmate-relay.test.ts,
tests/lua/guild-relay.test.ts), not delivery between real clients.

1. Two Forever clients in the same guild: A has no companion and is linked (via `/guilded verify`),
   B is a paired **non-officer** with the companion running.
2. A levels up and opens the profession window (or `/guilded inspect`); both stay online 10+ minutes.
3. B `/reload`s (writes saved data); B's companion uploads. Discord/website: A's level and
   professions updated; `Character.relayedAt` set, `relayedById` = B's member.
4. A finishes a dungeon while B is online in the guild (B not in the group). B's addon receives
   the run (`SUM`), B reloads, B's companion uploads: the run appears on the website once.
   Repeat with B in the group: still one run.
5. A: `/guilded relay` shows "Synced via B, …" and B as a guildmate with a companion; A's login
   digest shows the same line.
6. Inside a dungeon, `/guilded ledgersync` traffic and `HI` wait until the group leaves; check
   nothing is lost and `/guilded relay` still answers.
7. A client with a newer protocol (edit `PROTOCOL` locally) makes the other print the update line once.
