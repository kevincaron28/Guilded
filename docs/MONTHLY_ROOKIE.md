# Rookie of the Month

Guilded creates a cosmetic green **🐣 Recrue du mois** / **🐣 Rookie of the month** role automatically for servers with community honors configured. No permissions or character link are required.

At the close of each public Discord monthly season, the newcomer with the highest earned community score qualifies if their Discord join date is within the preceding 60 days, they participated on at least three distinct guild-time days, and they have never won the monthly rookie award. Point spending does not lower the earned score. Ties use more active days, then earliest join date, then Discord ID. Current Discord membership is verified; bots and test accounts are excluded.

An active day has recorded messages, reactions, voice participation, or a positive community point award. The Hall of Fame monthly announcement includes points, active days, messages, reactions and voice hours. This replaces the former weekly rookie mention; historical weekly mentions remain visible and do not disqualify monthly newcomers.

The role transfers to the next winner. If nobody qualifies, the role is cleared and no rookie is announced. Awards and the announcement queue are committed together under the existing honors lock, so retries do not award twice. Join history is independent of characters and Member records. Join/leave events retain the earliest observed join date; month-end candidates are also checked through Discord. History before installation that Discord no longer exposes cannot be reconstructed.

Deployment requires the `20261109090000_monthly_rookie` migration and the normal release gates. Existing honors installations automatically provision the new role; no owner setup command is needed. No version bump or character reset is part of this change.
