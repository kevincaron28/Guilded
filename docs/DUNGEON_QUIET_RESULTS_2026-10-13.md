# Quieter dungeon results

The completion window now waits for combat to end and opens as a movable
320 by 280 panel in the lower-right corner. Another pull hides the panel until
combat ends; a dismissed panel stays dismissed. `/guilded dungeon results`
still reopens the latest saved run. No automatic reload is introduced.

Discord results include only characters linked to the importing guild, including
members earning zero points. Guest names and scores are omitted from the roster,
records and achievements; death totals and tracking coverage refer only to guild
members. A run with no linked guild characters produces no public announcement.
Full participant history remains available internally for run validation and
replacement handling. SavedVariables, point awards and version 6.0.0 are unchanged.

Regression coverage exercises combat/lockdown deferral, repeated combat events,
manual dismissal, corner placement, guest filtering, zero-point guild members,
legacy summaries and guild-scoped deaths. Full release checks and deployment
evidence are recorded in the local delivery receipt. Real-client placement and
combat behavior still require the owner's in-game check after `/reload`.
