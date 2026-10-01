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
