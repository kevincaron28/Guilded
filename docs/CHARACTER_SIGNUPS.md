# Character signups and WoW layout

Version remains 5.0.0, protocol 2. Apply additive migration
`20261026090000_character_signups` after the core loot migration. Enable
`GuildSettings.characterSignups` for Quebec Gold after backup and deployment;
other guilds retain their existing policy by default.

Each person has one primary character plus approved backups per core. The same
character may belong to several cores, and different cores may use different
characters. Changing one core never changes another core or a previous raid.
EP/GP remain per person within each core's pool; this change does not repartition
the financial ledger.

New core membership, applications and raid signups require an owned character
in this guild. IDs distinguish same-name characters on different realms. A
private paginated selector appears when a person has several characters. Add
or pair characters with `/character add` or `/character pair`. Officers adding
a player select one of that player's characters.

Each raid stores the selected character ID and name/realm snapshots. Signing
up again changes that person's character or role for that raid; it does not
create a second player slot. Both general and core signup messages show the
same selection. Priority applies to the core's primary and approved backups,
not every character on the account. Calendar imports retain the invited
character. Ownership and capacity are checked inside the raid transaction;
the database also enforces one person and one character per raid.

Historical signups without a character stay intact. Cancelled and deleted
character identities retain name/realm snapshots. Existing core memberships
without a selected character need a choice in `/core edit`; no main is guessed.

The approved Discord rollout renames the WoW voice/chat categories in French,
moves Show-off channels into Jasette without syncing their permissions, and
removes only the resulting empty category. Channel histories and private
exceptions stay intact. `bilan-hebdo-wow` is a read-only managed WoW channel
whose permissions copy the general raid signup channel. Human announcements
and automated reminders keep separate destinations. Signup instructions and
current guild/WoW rules are pinned; obsolete rule messages are backed up before
replacement. Carl-bot's reaction-role message is preserved.

Automated coverage includes private selector pagination/ownership/timeouts,
primary/backup priority, and native PostgreSQL concurrency, independent core
choices, stable snapshots, ownership rejection and backup/restore. Required
release checks and Windows packaging run before publication/deployment.
Diablo channels/season, shared discussions and future non-WoW reports stay
deferred. Carl-bot dashboard and real WoW client checks remain separate gates.
