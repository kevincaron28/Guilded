# Cloudflare branch preview repair — 15 October 2026

The failed Workers build for candidate commit `13f4527` is
`de96b9d1-5862-4cfe-8a8c-0dcdfb1db0a5`. Its dashboard log confirms that
`npm run site:build` passed, then `npx wrangler preview` failed because
`wrangler.jsonc` did not contain a `previews` block. This was a configuration
failure, not a failed website compilation or a cloudflared tunnel failure.

Add `"previews": {}`. Assets remain at the top level, as required by the
[Cloudflare preview configuration documentation](https://developers.cloudflare.com/workers/previews/configuration/).
Keep production routes unchanged. Push to the candidate branch to exercise the
actual hosted build; a local `wrangler deploy --dry-run` does not run the failing
preview command and alone cannot prove repair.

The Worker has no database binding. Its existing fixed-origin companion/API proxy
still points at the live bot and requires its normal authentication. A branch
preview is not an isolated test database: verify public pages and read-only
health only, without test writes to the production guild.

The local Wrangler OAuth credential cannot read Builds logs (403); the existing
signed-in Cloudflare dashboard provided the actual log. No new credential or
permission expansion is needed for the repository configuration fix.

Final hosted build evidence is recorded in the release follow-up handoff.
