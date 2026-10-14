# Per-character dungeon rating

Owner decision, 14 October 2026: competitive dungeon scores belong to the
character that ran the dungeon. Alts must not inherit each other's best runs
or boss records. Future role-specific scoring should subdivide a character's
record, not an account's combined history.

Active-season ratings now group by linked member plus normalized run character
name within the guild. Member identity is retained for permissions and ownership;
it is not sufficient on its own to combine scores. This follows Guilded's
Forever name matching: realm labels are unstable, and older run-player records
do not contain realm or a durable character ID. Character renames/relinking and
multi-realm duplicate-name support would need an explicit identity migration.
Unnamed records do not silently become an account score.

The rating calculation, boss bests, import gain reports, Discord player summary,
leaderboard and companion profiles now retain separate characters. Profiles
contain no alt aliases for character-based results. The addon's current-season
profile lookup/ranking no longer inherits another character's result through
legacy account aliases. An unrun alt has zero in a complete season snapshot.

Existing completed seasons keep their frozen results, including historical
account-based profiles. Newly closed seasons freeze the new character rows.
Account-level participation points, achievements and participation history remain
separate and unchanged. No schema migration, score reset or version bump is
needed: stored runs already record character and role. Roles are not scored yet;
use the recorded run role if adding role categories, never the player's current
profile role retroactively.

Rollout requires the tested bot update, regenerated companion standings, and
updated addon files. No production deployment, live score refresh, database
write or CurseForge publication is implied by these source changes. Do not mark
PostgreSQL/Windows CI or the two-alt real-client check passed without evidence.

Regression coverage includes separate alts on one owner, repeat name casing,
missing identity, separate boss bests, independent import gains, distinct
companion profiles/tooltips, and preserved historical account results. The
PostgreSQL verification script now expects a separate alt gain and two ratings.
