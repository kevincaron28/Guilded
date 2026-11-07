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

---

# 9.0: maximum sharing and optimal sync

Owner request (6 November 2026): "make sure we share the most data possible and we are optimal to
sync." Goal: whenever any companion user is online, the bot learns everything the guild's addons
know, including Guilded Dungeons-only players and players with no addon.

## Audit: every message a Guilded addon hears from guildmates

| Prefix (module) | What it carries | Kept in SavedVariables (with author and time) | Uploaded by the companion |
| --- | --- | --- | --- |
| `Guilded` READINESS (Core.lua) | Level, class, race, spec, professions, readiness, verify code | `peerRoster[name]`, `seenAt`, `reportedBy` | Yes (`characters`, readiness) |
| `GuildedDgn` SUM (Dungeon.lua, both addons) | Finished runs | `dungeon.runs[id]`, `reporters` | Yes (`dungeonRuns`) |
| `GuildedDgn` HELLO/START/ACTIVE/DEATH/END | The live run in your own group | Into your own run | Yes, as part of the run |
| `GuildedDgn` ACK (new) | "My bot already has this run" | `syncedVia`, `syncedViaAt` on your copy | No (local bookkeeping) |
| `GuildedRcp` (Recipes.lua) | Recipes, names, cooldowns | `recipeBook.people/cooldowns`, `v` stamp | Yes (`recipes`, `cooldowns`) |
| `GuildedDuel` (Duels.lua) | Duel results, from one of the two players | `duels.results` | Yes (`duelResults`) |
| `GuildedLedger`, `Guilded` LEDGER (officers) | EP/GP entries | `epgp` | Yes (officers) |
| `GuildedRes` (Reserve.lua) | The keeper's soft-reserve list | `reserves` | Yes |
| `GuildedRly` HI (GuildRelay.lua) | Protocol, carrier flag | `relay.carriers` | No (local) |
| `GuildedCatch` (CatchUp.lua, new) | Catch-up digests, forwarded runs and digests | Into `dungeon.runs` / `peerRoster` with `forwardedBy` / `via` | Yes, like first-hand copies |
| `GuildedMile` GOFF | The officer switch for announcements | `milestones.guild` | No (a setting) |
| `GuildedSeason`, `GuildedSync`, `GuildedBridge`, `GuildedRating`, `GuildedScore` | Bot data passed down to members, version check | Standings, boards | No (comes from the bot) |
| `GuildedFree` (Presence.lua) | Opt-in availability | **Memory only, by design** (consent) | No |
| `GuildedMap` | Positions | **Not kept, by design** (location) | No |
| `GuildedSOS`, `GuildedLC`, `GuildedBid`, `GuildedMotd`, `GuildedRec`, `GuildedHist` | Live calls, council, bids, MOTD helper, welcome, history replies | Transient (their results end up in loot, the ledger or the MOTD) | Through those results |

Heard but dropped, and what happened to each:

1. **Runs heard by a member without a companion** were never passed on: only the run's author
   replayed it (last 7 days, at login, or when an officer asked). **Fixed** by catch-up.
2. **Guildmates' digests heard by a member without a companion**: same. **Fixed** by catch-up
   (level, class, race, spec, professions; never readiness or verify codes).
3. **Guildmates' milestones** are only guild chat text, never an addon message: nothing to keep.
   Level milestones follow from relayed levels; a milestone relay needs a bot rule first (left).
4. **Guildmates' runs nobody's bot confirmed piled up forever** in members' saved files. Now
   dropped after 45 days (the bot takes relayed runs up to 30 days old).

The roster, last online, MOTD, info text, event log and guild bank need no relay: every member's
own client reads them from the game (docs/GUILD_DATA_INVENTORY.md), so any companion user uploads
them for the whole guild, whoever else is online. Catch-up therefore covers runs and digests only.

## Catch-up on login (Modules/CatchUp.lua)

Store and forward, generalizing LedgerSync's digest, offer and request pattern:

1. 40 s after login (and on `/guilded sync peers`), each client sends one `DIG`: for runs (R) and
   guildmates' digests (P) from the last 14 days, a count and a 24-bit hash sum. One message.
2. A guildmate whose digest differs answers with `HAVE`: its item keys (4 characters each: a hash of
   the run id, or of name + level + professions date), `*` marking runs its bot already has. Only
   one guildmate answers: a companion user answers a member first, a member answers a companion
   user first, and everyone else goes quiet once they hear an answer. At most 8 parts, and the same
   asker is answered at most once per 10 minutes.
3. The asker requests what it lacks (`WANT`, up to 40 keys) and pushes what the other lacks (up to
   8 items, newest first). The holder sends up to 8 items per request.
4. Items travel as `RUN` (Dungeon.lua's summary format, with a reporter who was in the run) and
   `PEER` (level, class, race, spec, professions and their date). They are broadcast on GUILD, so
   every online guildmate stores them; the next companion sync uploads them.

Checks are the same as first-hand: a run only with a reporter who played it, ended within 14 days,
nothing from the future; a digest only about a guild member, only when newer than the copy held,
professions never replaced by an older list, never a verify code (a first-hand one is kept).
Forwarded digests feed `characters`, never readiness rows. The bot then applies its own rules
(levels only go up, newer professions only, relayed runs need a participant reporter). A run's `*`
mark sets `syncedVia`: the author stops replaying it and the copy ages out after 30 days.

**Dungeons-only players.** Guilded Dungeons shares Dungeon.lua, so its `SUM` replays are stored
and relayed exactly like Guilded members' runs (credit by character, `reporterNames`), and catch-up
forwards them. New in the shared file: a companion user hearing a replay of a run its bot already
stored answers `ACK|<id>` once, and the author (either addon) stops replaying it. Before, a
Dungeons-only player with no companion replayed the same runs at every login for a week.

## Efficiency

- **Batched**: one `DIG` per login; item lists are 4-character keys, and only missing items travel.
- **Queued in instances**: catch-up traffic, the dungeon `SUM`/`ACK` guild messages and the relay
  use the `hold-in-instance` lane and leave after the group exits. Group messages are never held.
- **Upload size**: the companion already sends one combined upload per save and leaves out ledger
  and loot rows the bot acknowledged (`delta.mjs`); identical bytes are answered "nothing new".
  The addon's sync counters stay out of the upload and out of its revision hash.
- **Compression**: not added (no deflate in WoW's Lua without a library; summaries are short text).

## Measure

- `/guilded sync stats`: this session's messages sent and received with bytes and messages held in
  instances; relayed items in and out, dungeon confirmations heard and sent; totals since the first
  count (saved at logout in `GuildedDB.syncStats`); the last catch-up and with whom.
- The companion's support summary (`syncDiagnosticPreview`) adds `gameSync`: the same numbers and
  two dates, never names.

## Left for later

1. **Guilded Dungeons answering catch-up**: Dungeons-only players replay their own runs and accept
   ACKs, but do not hold or forward others' runs (no CatchUp module in that addon).
2. **Recipes in catch-up**: recipes still travel first-hand only (`Q` makes everyone online
   re-share their own). Forwarding needs per-profession keys and a third-party recipe format.
3. **Milestones relay**: needs a bot rule for milestones of characters the uploader does not own.
4. **Run delta upload**: skipping runs already marked synced would shrink uploads, but a second
   witness's copy may matter to public score evidence; decide with the scoring owner.
5. **Compression** (LibDeflate-style) for long summaries.

## Needs a real client

1. Three Forever clients in one guild: A (Guilded Dungeons only), B (Guilded, no companion),
   C (Guilded with a running companion). A finishes a dungeon with only B online. Later C logs in
   with only B online: within about a minute C's addon holds A's run (`forwardedBy` = B); C's next
   sync puts it on the website once.
2. A logs in with C online: C answers A's replay with `ACK`; A's next login sends no replay.
3. `/guilded sync stats` on B and C shows relayed items and "Last catch-up: ... with ..."; the
   companion's support summary shows `gameSync`.
4. Inside a dungeon, no `GuildedCatch` traffic leaves until the group exits.

---

# 9.1: recipes, cooldowns and attunements reach the bot through any companion

Owner request (ROADMAP item 8): share addon data by addon message to help sync.

## Gap map (what each module shares, and what only a member's own companion could upload)

| Data | Between addons today | Bot kept it from a member's upload? | After 9.1 |
| --- | --- | --- | --- |
| Level, class, race, professions, spec | `READINESS` digest, `GuildedCatch` PEER | Yes (guildmate-relay.ts, linked characters only) | unchanged |
| Dungeon runs | `GuildedDgn` SUM, `GuildedCatch` RUN | Yes (witnessed runs) | unchanged |
| EP/GP ledger | `GuildedLedger` (officers only) | No (officer authority) | unchanged, by design |
| **Recipes** | `GuildedRcp` broadcast by the author at login; **never forwarded** | **Own only** | forwarded in catch-up (kind C); relayed by member uploads |
| **Profession cooldowns** | `GuildedRcp` CD, author only | **Own only** | member uploads relay them (not forwarded between addons: short-lived) |
| **Attunements** | `ATTUNEMENT|` self-report on GUILD; **never forwarded** | **Own only** | forwarded in catch-up (kind A); relayed by member uploads |
| Duels | `GuildedDuel` D| on GUILD | Participants' companions only | left: needs two witnesses per duel |
| Milestones | guild chat text only | Own only | left: needs a bot rule |
| Roster, MOTD, info, event log, guild bank | read from the game by every client | any member's upload | unchanged |

## What changed

- **Addon (`Modules/CatchUp.lua`)**: two more kinds in the existing digest, `C` (recipe lists, one item per
  player, profession and the author's stamp) and `A` (attunements, one item per player, attunement and date),
  kept 45 days. Same exchange as runs and digests (DIG, HAVE, WANT, items), same paced, hold-in-instance
  sending, 24-bit hash sums, one answer per DIG. Items are `RCP|name|profession|stamp|part|parts|keys` and
  `ATT|name|key|0/1|date`. A recipe list over 400 recipes is not forwarded, and only two travel per request.
  An older addon's DIG has no `C`/`A` and is never asked about them; older addons ignore the new messages.
  A forwarded item is only about a guild member who is not you, never from the future or older than 45 days,
  and never replaces a list at least as new (recipes) or a report at least as new (attunements). It is stored
  marked `forwarded` with `via`, so the companion's upload is the same shape as a first-hand one.
- **Bot (`relayableCraftData` in `src/services/guildmate-relay.ts`, used by `personalSnapshot`)**: a paired
  member's upload may now carry other guildmates' recipe lists, cooldowns and attunements, but only for
  characters already linked in this guild, never the uploader's own (first-hand), recipe stamps clamped to the
  upload time and no older than 180 days, attunements only as "completed", and per-upload caps. The usual
  import rules still decide: `applyRecipeData` keeps only the newest list per character and profession, so a
  relay never doubles anything and never replaces newer data.

Residual risk, stated plainly: a relayer who edits their own saved file could claim a recipe list for a
linked guildmate. Clamping the stamp to the upload time bounds the damage: the owner's next profession-window
scan (stamped later) replaces it. There is no per-row provenance column; the upload's import record names the
uploader.

## Left for later

1. Duels between two addon-only members (two witnesses per duel, as with dungeon reporters).
2. Cooldowns between addons (they expire within days; the bot lane already takes them from any upload).
3. Milestones of other players (needs a bot rule).
4. Real-client check: three clients as in "Needs a real client" above, with `/guilded recipes` opened on one
   of them; the carrier's next upload shows the author's recipes on the website's craft board.
