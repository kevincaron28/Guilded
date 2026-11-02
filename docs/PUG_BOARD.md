# Cross-guild PUG board

Opt-in, auto-expiring requests for outside players ("PUGs"). Separate from the older `/raid pug` open-raids
listing (`src/services/pug-board.ts`, `pugChannelId`), which publishes a raid to everyone; this board is
guild-to-guild and per request.

## How it works

1. **Join (officers, `/raid pugs join [channel]`).** Creates (or reuses) a read-only board channel and stores a
   `PugBoardGuild` row. Until a guild joins, nothing is created for it, nothing is posted to it, and it cannot
   create requests. `/raid pugs leave` closes the guild's own requests and removes every post from its channel.
2. **Ask (officers).** `/raid pugs ask raid tanks healers dps hours note`, or the `Ask for PUGs` button
   (`pugAskButton(raidId, lang)` in `src/commands/pug-requests.ts`, custom id `pugb:ask:<raidId>`, which opens a
   form). Rules: upcoming, planned, non-test raid; at most one OPEN request per raid (also a partial unique index
   in the migration); 3 requests per guild per rolling 24 h; 10 minutes between requests; 1-25 spots per role;
   at most 48 hours, and never past the raid start.
3. **Fan-out.** One `PugPost` row and one `PUG_POST` Discord job per eligible guild: joined, same WoW edition
   (`Guild.gameEdition`), not blocked in either direction, server served by the pilot. The job key is the request
   id, so repeating the fan-out only bumps a revision (idempotent); posts go out two seconds apart through the
   normal job queue. Each guild gets **one** message, edited in place when spots change.
4. **The post** shows an "OTHER GUILD'S RAID" tag, the host guild, raid, the time (Discord timestamp that renders in
   each viewer's own zone, plus the viewer guild's configured zone in text), edition, open spots per role (accepted
   PUGs deducted), the note, and `Sign up: <role>` buttons for roles that still have room. Officers of the viewing
   guild also get `Block this guild`.
5. **Sign-up** by button (modal: character, optional class, optional note) or on the website,
   `/recruitment/pugs` (Sign in with Discord, same fields). One sign-up per person per request; members of the
   host guild and of guilds it blocked are refused. The host's officers see **one** aggregated notice message in
   the raid's signup channel (`PUG_NOTICE`, edited in place, 20 s debounce) with `Review guests` and
   `Close request`; they accept or decline each guest. Accepting only records the guest on the request;
   **nobody joins a roster or server automatically**: officers invite accepted players in game. The notice message
   is the guest list for the raid.
6. **Expiry.** A request closes when the raid starts, is cancelled/deleted, an officer closes it, every spot is
   filled, the guild leaves, or at most 48 hours after creation. Closing queues a refresh for every post: the post
   is edited to "Closed" and deleted. `sweepPugRequests` (every minute, `main.ts`) closes finished requests, follows
   a raid that was moved or renamed, re-queues removal for posts that outlived a closed request or whose guild left,
   and deletes closed requests after 30 days. A deleted channel, missing permission, or a message a moderator
   removed retires the post quietly; it never retries forever or posts an error.

## Privacy

Across guilds only these leave a guild: host guild name, raid title/time, spots, the note, and for a sign-up the
Discord display name, character name, class, role, note, and the signer's server name (shown to the host officers
only). Discord user ids are stored to prevent double sign-ups and are never displayed; the requesting officer's id,
raid and guild ids are never put in a post, the website page, or a sign-up. Blocking (the button or `/raid pugs
unblock guild`) hides requests in both directions, removes existing posts, and refuses sign-ups from that guild's
members.

## Deploying

- Migration `20261211000000_pug_requests` (5 new tables, one partial unique index). `npm run db:update` applies it.
- Bot redeploy only; no command is added at the top level (`/raid pugs ...` is mounted under `/raid`), so the
  next deploy re-registers commands as usual. The website route lives in the bot (`/recruitment/pugs` is already
  forwarded by the Worker), so no Worker or site redeploy is needed.
- No new Discord intents; no automatic messages for a guild that has not joined.

## Not verified without live Discord

Real posting/editing/deleting across servers, the modals and buttons in the client, the Discord timestamp
rendering, the Cloudflare-forwarded sign-in and form post on `/recruitment/pugs`, and the migration against
Postgres (tests use in-memory fakes). Follow-ups: show accepted guests inside the raid's own signup embed (touches
`signup-embed.ts` / `raid.ts`, which the officer-core-tools work is changing), mount the `Ask for PUGs` button in
that session's officer button row, a link to the page from the recruitment page and site nav, and a sign-up
withdraw action.
