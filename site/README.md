# Guilded download and setup website

A static landing page with CurseForge/releases links, an illustrated owner guide,
member installation and a link builder for each guild's own online companion.
It has no login, credentials, analytics, database or shared bot service.

## Build and preview

From the repository root, with Node 24 and dependencies installed:

```text
npm run site:build
npm run site:preview
```

Open http://127.0.0.1:8800. Output is `dist/site/`; the preview binds only to the
local PC. Edit guide Markdown in `docs/`, then rebuild. Do not edit generated HTML.
`npm run release:prepare` builds this site alongside the addon and companion.
The site build refuses missing relative guide/image targets.

## Publish

### Cloudflare Worker (static assets)

`wrangler.jsonc` defines the `guilded-wow` Worker with only `dist/site` as its
public asset directory. No bot code, database bindings, secrets or proxy routes
are included. Static asset requests use Cloudflare's free asset hosting.

```text
npm run worker:build
```

This builds the site and runs Wrangler's **dry run**; it does not publish.
The manual deployment command is `npm run worker:deploy`. The existing Workers
Git integration uses build `npm run site:build`, deploy `npx wrangler deploy`,
and production branch `main`. Use Node 24. No bot
environment variables belong in the Worker.

Cloudflare browser access was restored on 5 October 2026. The public landing page
is verified at https://guilded-wow.kevincaron28.workers.dev/. Worker configuration
is now integrated with the companion/setup release branch for publication on main.
See `docs/WEB_COMPANION_ROLLOUT.md` for deployment and acceptance evidence.

Reference: https://developers.cloudflare.com/workers/static-assets/get-started/

### Other static hosts

Publish **only the contents of `dist/site/`** to a static HTTPS host. For GitHub
Pages, use a Pages artifact containing that directory, with build command
`npm ci && npm run site:build`. This is independent of the Oracle bot service.
Never upload the repository root, local environment files, backups or SSH keys.
No production host was configured or published during the local rehearsal.

Before public launch, confirm the intended release assets are actually available,
replace any beta status text when acceptance is complete, and check the download
links from a signed-out browser. All paths support hosting under a project subpath.
There are no made-up third-party addon links: add other addons only after their
exact project/download URLs are supplied and checked.

The Quebec Gold companion link is labelled for Quebec Gold members only. The
guild-address form makes a same-browser link and strips unrelated URL parameters;
it never requests or forwards pairing codes. Each other guild hosts its own bot.

Screenshots and provenance: `docs/images/owner-setup/README.md`. Screenshots of
vendor tutorial examples are labelled as such and must not be presented as a
completed real-account install test.
