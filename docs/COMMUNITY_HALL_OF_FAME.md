# Community hall of fame

Recognition on top of the public Discord community seasons (the 🏆 podium's
points). Code: `src/services/community-honors.ts`.

## What members see

- **Weekly MVP.** When a week ends, the `⭐ MVP of the week` role moves to the
  member who earned the most community points that week (ties share it; a
  silent week frees it). Spending lottery points never lowers the score.
- **Rookie of the week.** The member with the most points that week whose
  first community point ever came within the last 28 days. The MVP is never
  also the rookie. Mentioned in the post; no role.
- **Monthly podium.** When a monthly season ends, its top 3 get
  `🥇 Champion`, `🥈 Runner-up` and `🥉 Third of the month` until the next
  month ends. Ties share a place, as on the leaderboard.
- **The `🏅・hall-of-fame` channel** (`🏅・palmares` in French) in the Community
  category, read-only for members: the weekly post (MVP with "2nd time!" for
  repeat winners, the week's top 3, the rookie, and a recap of the guild's
  week: points, messages, voice hours, activities, raids, dungeons, new
  members) and the month-end top 3. Posts show names, never bare mentions.
- **`/community honors`:** recent weekly winners, the most MVP titles and the
  last monthly podium.

## Officers

- `/community honors-preview`: privately, what the weekly post would say if
  the week ended now. Nothing is saved or posted.
- `/community honors-settings`:
  - `weekly`: turn the weekly MVP and post off or on. Off frees the role and
    announces nothing.
  - `week-start`: Monday to Sunday in server time (default), or from one WoW
    weekly reset to the next (Tuesday 15:00 UTC). Switching marks the last
    complete week of the new kind as done, so no week is announced twice.
  - `ping`: notify the MVP. Only that member is notified; every other bot
    message still notifies nobody.

## Setup

`/setup start` → **Set up community** creates the channel and the four roles
(reused if they exist, even renamed) and shows a "Hall of fame" line on the
checklist. Servers whose community section existed before this feature got
them once at bot startup. The bot needs **Manage Roles** and its own role
above the four honor roles; a failed role move is retried every 15 minutes.

## Data

`CommunityHonors` holds the channel, roles, settings, the last week and season
handled and the current holders. `CommunityHonorAward` keeps every MVP
(`WEEK`), rookie (`ROOKIE`) and podium place (`MONTH`). Each week and each
season is decided once, in one transaction with its post (a `DiscordJob`).
