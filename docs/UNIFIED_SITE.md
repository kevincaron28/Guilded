# One Guilded website and companion address

The owner's public address is https://guilded-wow.kcaron.workers.dev/.
The website, guides and Quebec Gold companion share that address:

- `/` and `/docs/` serve the static website and installation guides.
- `/companion/` serves the existing online companion through the Worker.
- `/health` and the explicitly listed `/api/v1/` routes forward to the existing
  Oracle bot at `https://guildedqc.duckdns.org`.

The Worker uses a fixed HTTPS upstream, bounded request bodies, manual redirect
handling, no caching of companion/API responses, and no logs containing credentials.
It forwards personal credentials only on supported API routes. Cookies and user
proxy headers are not forwarded. Oracle still checks pairing, guild membership,
roles and request limits. No database binding, bot token or global upload credential
is placed in Cloudflare. The Discord bot keeps running on Oracle.

The landing page's Quebec Gold link is relative. The proxied companion adds a
Website & guides link. Other guilds with independent bots continue using their
own addresses; this change does not establish a public shared-bot pilot.

Browser sessions are stored per origin. Members opening this address for the
first time need their own new `/character pair` or `/poe pair` code. Pairing a
new session replaces the previous companion credential; finish queued uploads
before switching. This also applies when the Cloudflare subdomain is renamed.
Do not copy credentials between sites or commit them.

Desktop companions may use the same public base address with
`/api/v1/addon-imports`; the existing Oracle address remains available.

Run `npm run worker:build` for a dry run. Production deploys from main through
the existing Cloudflare Git integration after the required repository checks
and final-commit CI. No Oracle restart or database migration is needed for this
Worker-only routing change. Verify the website, companion assets, connection
check, health and unauthorized API behavior at the deployed address. Real paired
sync and in-game standings acceptance remain required separately.
