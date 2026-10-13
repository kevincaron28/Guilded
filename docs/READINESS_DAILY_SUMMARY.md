# Daily raid readiness summary

Automatic addon-import follow-ups now create at most one readiness summary per
guild-local calendar day, using the configured guild timezone (Toronto fallback).
The first readiness or consumable import supplies the day's summary. Later imports
still save their data without creating extra channel posts.

The summary is one embed, with the most actionable members first. Large reports
are shortened with a pointer to `/readiness raid`. That command now returns the
full current report privately to the authorized requester, including optional
attunement checks, instead of creating additional readiness-channel messages.

An existing DiscordJob keyed by guild and day preserves the cap through restarts
and simultaneous imports. Repeated imports do not reset delivered status or retry
leases. Normal durable delivery handles failures and message deduplication; stale
daily summaries are discarded when their local date has passed. No new migration,
addon/companion update, version bump or automatic deletion of old posts is needed.

After deployment, verify that two same-day imports produce only one new readiness
message, and `/readiness raid` gives a private current report. Real Discord
acceptance remains pending until observed. Earlier same-day posts from the old
implementation are preserved; the new policy can create one initial daily summary.
