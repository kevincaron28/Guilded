# Core size and launch scheduling

Use `/core edit` for an existing core, or `/core setup` for a new core. In setup,
the player step includes **Size & roles** and **Raid days & launch date**.

Set size and role counts first. For example, a 10-player core could have 2 tanks,
2 healers and 6 DPS; a 20-player core could have 2 tanks, 4 healers and 14 DPS.
These are examples, not forced compositions. Counts must sum to the size (1–40).
The roster displays current main members against each role target; bench and trial
members remain listed separately. Targets do not remove members or restrict the
size of the bench. New raids inherit these signup limits, using the existing
waitlist behavior. Manual `/raid create` limits can override the core defaults.

Select one or more weekdays, then enter:

- A shared start time in the guild's timezone (shown on the form).
- An optional first date, `YYYY-MM-DD`; no raid is generated before this date.
- How many days to prepare, from 1 to 90 (existing cores retain six days).
- Optional separate day/time entries when nights start at different hours. These
  replace the weekday/shared-time selections, for example `mardi 20h; jeudi 21h`.

Review the upcoming dates and click **Enregistrer et préparer les raids**.
Closing or letting the confirmation expire leaves the schedule unchanged.
Select **Arrêter la création automatique / Stop** alone to stop generating raids.

For a December launch, enter the actual December date now and choose, for example,
28 days. The bot immediately prepares the first four weeks from that future date;
it does not create October or November raids while waiting. Discord posts are
delivered through the normal queue. After launch the window moves forward normally.
Local start times stay consistent through daylight-saving changes.

Changes apply to newly generated raids. Already published raids and signups are
preserved, including cancelled occurrences. Use `/raid edit` or `/raid cancel`
to adjust those raids. Reducing the planning window does not delete existing raids.
Two cores have independent capacities, schedules and launch dates.

This update adds nullable composition/start-date fields and a six-day default
planning window. It does not infer settings from core names or change existing cores.
