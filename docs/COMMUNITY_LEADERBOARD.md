# Community podium

The community rankings channel is named `🏆・leaderboard`, under the existing
Community / Communauté category. Provisioning reuses `classement` or
`community-standings`, preserving its ID, messages and season associations.
It does not create or modify a season or award any points.

The pinned French/English panel shows ten members, shared ranks for ties,
earned community points, collective totals, daily dice instructions, wallet
and full-ranking commands, and links to the activities and community chat.
An empty podium invites the first contribution; ended seasons disable the
daily-dice instructions. Spending points does not reduce earned rank.
Participation rewards are described as conditional on `/participation status`.

Only unrestricted Discord seasons hosted in this exact channel are published.
Role-restricted and differently hosted seasons remain accessible through their
existing authorized `/community` commands. Provisioning preserves visibility
overwrites and makes this channel read-only for members, with bot posting and
pinning permissions. No member pings are sent.

Explicit local channel maintenance (REST only; never starts another bot):

```text
npx tsx scripts/update-community-leaderboard.ts EXISTING_COMMUNITY_CATEGORY_ID
```

The bot refreshes existing community podiums on startup and every five minutes
after the updated code is deployed. It edits the same marked, pinned post,
recovers it from recent messages if unpinned, and refuses ambiguous channels.
Scheduled refresh does not create channels or modify permissions. Before the
updated bot is deployed, the pinned panel is a snapshot; the commands in it
always retrieve current points. No migration, installer rebuild or version bump
is required. Follow the existing deployment gates for any bot rollout.

Validation: `tests/community-leaderboard.test.ts` covers ties, earned scores,
empty/ended seasons, Discord size limits, scope, permissions and reuse.
