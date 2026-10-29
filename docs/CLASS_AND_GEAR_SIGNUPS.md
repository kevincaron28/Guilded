# WoW class icons and gear in Discord

Version remains 5.0.0, protocol 2. No migration or client data reset is needed.
Raid signup posts and core rosters show the selected character's localized
class and specialization, character level, and average equipped item level from its latest
inspection. Primary and backup characters each use their own information.
Neither a Discord account's global main nor a different core's primary is
used to fill a selected character's class/gear.

French example: `Ray · Prêtre — Discipline · niv. 13 · ilvl 4,2`, preceded by
the class and specialization icons. A missing specialization is shown as
`spé à préciser`; raid roles never imply a specialization. Average equipped
item level is not GearScore. Unavailable or
invalid gear displays `ilvl —`; inspections older than 24 hours display an
asterisk and an explanation. Imported inspection time now retains the actual
addon inspection/export time rather than replacing it with upload arrival
time, so uploading an older inspection cannot make it appear current.
Existing character-name/realm signup snapshots remain intact.

All 13 supported classes have ASCII custom emoji names in
`CLASS_EMOJI_NAMES`. Quebec Gold's emojis use Blizzard's WoW class icons from
its rendering CDN. Existing emojis are retained. Icons are loaded by name
and availability from the guild over REST, so no additional gateway intent
is needed. Class text remains visible if an emoji is unavailable or an API
refresh fails; cached icons can still be used.

All 41 supported specialization names (including Classic Rogue Combat and
Retail Devourer) have class-scoped French/English mappings in
`src/wow-specializations.ts`. Guilded's application-owned spec emojis avoid
consuming the guild's limited emoji slots and need no external-emoji permission.
App catalogs are cached for five minutes, concurrent fetches are coalesced,
and server emojis with the configured names take precedence. Existing emoji
catalogs are preserved. Blizzard CDN assets are verified before upload.

References: [Discord application emoji documentation](https://docs.discord.com/developers/resources/emoji)
and [Blizzard's Dévoration specialization announcement](https://worldofwarcraft.blizzard.com/fr-fr/news/24235744/plongez-au-c%C5%93ur-de-la-nouvelle-sp%C3%A9cialisation-de-chasseur-et-chasseuse-de-d%C3%A9mons-d%C3%A9voration).

The addon retains Retail specialization detection and now exports Classic's
unique talent tree with the most spent points. Zero points or tied trees
remain unknown. Talent changes refresh the character block, owned-character
export and paced readiness broadcast. Install the rebuilt addon, preserving
SavedVariables; reload/logout and the existing companion then supply the
actual spec. No existing character's specialization is guessed during setup.

For guilds using character signups, accepted addon imports queue edits for
affected core rosters and active raid signup posts in the same database
transaction. Hourly refreshes re-evaluate inspection age even without an
upload or signup click. Delivery failures retry through the existing outbox;
edits reuse the existing posts rather than adding announcements. General and
core signup messages continue to share one generated embed and buttons.
Core display refreshes do not reopen completed raids or change signups/loot.

Expanded rosters preserve complete custom emoji tokens when truncation is
necessary and respect both the 1024-character field limit and the overall
6000-character embed limit. Tests cover localized classes, primary/backup
gear, unknown/stale/future inspections, emoji fallback, large rosters,
guild-scoped refresh jobs and native PostgreSQL inspection ordering/outbox
backup/restore. Required release checks, Windows packaging, ledger preflight
and backup precede deployment. Real-client gates remain separate.

## Melee and ranged DPS (29 October 2026)

`src/services/dps-kind.ts` sorts each class and spec into tank, healer, melee or
ranged for the guild's WoW edition. Survival Hunters are melee on Retail only and
ranged everywhere else. A tank or healer spec signed up as DPS falls back to the
class's usual damage kind; Druids and Shamans with no damage spec stay unknown and
are listed under "DPS · spec unknown". A signup without a character uses the
member's main character.

- **Signup post:** once any DPS player's kind is known, or the raid has a limit,
  the DPS block becomes Melee, Ranged (and unknown) blocks with their own counts;
  the summary keeps the DPS total and its cap. Open seats name melee and ranged.
- **Spec for one raid:** the signup reply offers "Playing a different spec for
  this raid?" when the class has two or more specs for the chosen role. The choice
  (`RaidSignup.spec`) changes the player's icon and melee/ranged group for that
  raid only. Changing role or character clears it.
- **Limits:** `/lead create` and `/lead edit` take optional `melee` and `ranged`
  caps (`Raid.meleeLimit`, `Raid.rangedLimit`, copied to weekly repeats). A full
  kind waitlists like a full role, core members bump the latest non-core player of
  the same kind, and freed seats promote the earliest waiting player of that kind.
  A spec change into a full kind is refused and the old spec is kept. Players whose
  kind is unknown count against the DPS cap only.
- **Elsewhere:** `/lead roster`, `/lead fill`, the core roster (DPS field shows the
  split), `/who` (damage specs say melee or ranged) and recruitment listings
  (`/mod recruit roles: melee, ranged`; such a listing still matches a DPS search).
