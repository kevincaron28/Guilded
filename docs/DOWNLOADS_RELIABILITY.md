# Download reliability (8 November 2026)

Owner ask: "find a better solution for downloads so they always work and free."

## What exists today

| File | Served from | Fails when |
|---|---|---|
| Addon zips (`/downloads/Guilded-vX-forever.zip`, `GuildedDungeons-…`) | Workers **static assets** (copied from `site/downloads/` by `scripts/build-site.mjs`). `/downloads/*` is not in `run_worker_first`, so the Worker never runs. | Essentially only a Cloudflare outage. Cloudflare says static asset requests are "free and unlimited" ([billing and limitations](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)). |
| `releases.json` (auto-update feed) | Same static assets. | Same. |
| Companion installer (123 MB) | Too big for static assets, so the Worker (`hostedDownload`) streams it from the Oracle server (Caddy `file_server`, `/var/lib/guilded/downloads/`), 302 to GitHub otherwise. | The Oracle VM is down, restarting or mid-deploy; or a stream is cut mid-way. |

So the addon zips and the feed are already on the most reliable free path. Only the installer has one weak link: the single Oracle VM.

## Does the current fallback work? (checked in code and tests)

`worker/index.mjs` `hostedDownload`, for each bot origin (the configured hostname, then DuckDNS): fetch with an abort if no response header arrives in time; any status other than 200/206/304/416, or a thrown error, moves on to the next origin; when all fail the Worker answers `302` to GitHub. Verified by `tests/worker-hosted-download.test.mjs` ("tries the next address, then falls back to the GitHub release", both for a 404 and for an unreachable server). Nothing is buffered: the upstream `Response.body` is handed to the visitor, and a 302 carries no body. Worker CPU stays tiny because waiting on the network does not count toward the 10 ms free-plan CPU limit ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)).

Gaps found:

1. **Versioned names fell back to `latest`.** `Guilded.Companion.Setup.9.0.6.exe` redirected to `releases/latest/download/Guilded.Companion.Setup.exe`, which may be a different version once a newer release exists. The updater's SHA check would reject it, then retry GitHub's own asset, so it was safe but wasteful. **Fixed in this PR:** a versioned name now redirects to `releases/download/vX.Y.Z/<same name>`.
2. **Slow failure.** Two origins at 15 s each meant up to 30 s of nothing before the GitHub redirect. A file server answers headers in well under a second, so the wait is now 8 s per origin (body streaming is not affected: the timer is cleared once headers arrive).
3. **A stream cut mid-download is not failed over** (headers were already sent). The browser or companion resumes with a `Range` request, which goes through the same order, so it lands on the server again or on GitHub (GitHub supports ranges). Nothing to change.
4. **GitHub is not independent of GitHub's own incidents** (8 Nov: hours of 504 on release downloads). It stays last on purpose.

## Second source: Cloudflare R2

Free tier, Standard storage, monthly ([R2 pricing](https://developers.cloudflare.com/r2/pricing/)): **10 GB-month storage, 1 million Class A (writes/lists), 10 million Class B (reads/HEAD), egress free** (also through r2.dev, the Workers API and the S3 API). The installer is 123 MB; keeping the last three versions is ~0.4 GB. Each download is one Class B read (plus one probe HEAD from the Worker), so even 100,000 downloads a month is about 1% of the read allowance. Realistic cost: 0.

Public access ([public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/)): the `r2.dev` address is rate-limited and "development purposes" only, so do **not** use it. A **custom domain** on a zone in the same Cloudflare account (kcaron.top already is, the Worker runs on it) gets Cloudflare Cache and no such limit.

Caveat to confirm in the dashboard: the pricing page does not say whether a payment method is needed. Third-party setup guides say Cloudflare asks for a card (or PayPal) before the first bucket, as verification; usage inside the free allowance is not charged. If the owner does not want to add a card, skip R2: the rest of this plan (server, then GitHub) still stands.

### What the owner clicks (needs the dashboard sign-in)

1. dash.cloudflare.com → **Storage & databases → R2 object storage → Overview** → subscribe/enable R2 (add a payment method if asked; stay on the free allowance).
2. **Create bucket** → name `guilded-downloads`, location automatic, Standard storage.
3. Bucket → **Settings → Custom Domains → Add** → `dl.kcaron.top` → **Connect Domain** (status goes Initializing → Active in minutes). Leave "Public Development URL" (r2.dev) disabled.
4. Worker `guilded-wow` → **Settings → Variables** → add `GUILDED_DOWNLOAD_MIRROR_URL` = `https://dl.kcaron.top` (a plain variable, not a secret; `keep_vars` is true so deploys keep it).
5. Optional: an API token with R2 edit rights so the release recipe can upload by script (see below); otherwise upload by hand in the dashboard (a 123 MB file is fine through the browser).

Nothing in `wrangler.jsonc` changes: the Worker only needs the public URL, not an R2 binding, so deploys cannot fail on a missing bucket.

### What the release recipe changes

One extra step in `docs/COMPANION_AUTO_UPDATE.md` "What each release must do", beside the `scp` to the server: upload `Guilded.Companion.Setup.exe` and `Guilded.Companion.Setup.X.Y.Z.exe` to the bucket root (same two names, same bytes). By hand in the dashboard, or with `npx wrangler r2 object put guilded-downloads/Guilded.Companion.Setup.X.Y.Z.exe --file <path> --remote` (wrangler's `r2 object put` accepts an object path and a file; check `--remote` against the installed wrangler version before relying on it). Delete versions older than the last three. Never overwrite a published object's bytes; the unversioned name is the only one that moves, as on the server.

## Recommended order

**R2 mirror (302) → Oracle server (streamed) → GitHub (302)**, for the installer, implemented in this PR behind the optional variable (no variable, no change in behaviour).

Why this order: R2 sits on Cloudflare's own edge, so it survives the Oracle VM being down or redeploying, and it costs the Worker nothing (the visitor is redirected, so no bytes pass through it). The server stays second as the copy that already works today, and GitHub last because it is independent of both but has just shown multi-hour outages and rate limits.

How the Worker fails over without buffering: it sends a 4 s `HEAD` to `${mirror}/<name>`; a `200` becomes `302 Location: <mirror url>` (no body, nothing buffered, range resumes go straight to R2); any other result or timeout falls to the existing server stream; then the existing GitHub 302. Order of attempts is cheap-to-expensive and every step ends in a header-only redirect or a native body passthrough, never JavaScript copying chunks (that was the KV failure). KV pieces are never used again.

If the owner prefers the server first, the same code works with the two blocks swapped; R2 first is recommended because it removes the single point of failure.

## Addon zips and the auto-update feed

- **Addon zips:** already on static assets (free, unlimited, edge-cached), with GitHub as the companion's second source. No change recommended. Limit to remember: individual static asset files are capped (check [Workers limits, static assets](https://developers.cloudflare.com/workers/platform/limits/#static-assets) before ever adding a zip above a few MB; ours are 0.2 and 0.8 MB).
- **`releases.json`:** static asset, same reliability. The companion already reads the GitHub API when the website fails (10 s timeout).
- **Companion updater:** website `/downloads/Guilded.Companion.Setup.X.Y.Z.exe` first (now R2 → server → same-version GitHub through the Worker), then GitHub's asset directly, both verified against the one SHA-256 from `releases.json`. With the versioned-fallback fix the website leg no longer returns the wrong version when the server is down. No companion code change needed, so no Store resubmission for this.
- **CurseForge and the Microsoft Store** are independent channels and stay as they are.

## Owner actions

**Done 9 November 2026:** R2 enabled, bucket `guilded-downloads`, custom domain `dl.kcaron.top`, `GUILDED_DOWNLOAD_MIRROR_URL` set (and kept in `wrangler.jsonc`), 9.0.8 installer uploaded under both names. Verified: the website answers 302 to `dl.kcaron.top` and the SHA-256 matches `site/releases.json`. Wrangler on the owner PC is logged in with R2 access for future uploads.

1. Decide whether to enable R2 (needs the Cloudflare dashboard sign-in and possibly a card on file; steps above). Until then the PR changes nothing visible except the versioned-name fallback and the shorter timeout.
2. After the coordinator deploys the Worker: set `GUILDED_DOWNLOAD_MIRROR_URL`, upload the current installer under both names, then check `https://guilded.kcaron.top/downloads/Guilded.Companion.Setup.exe` redirects to `dl.kcaron.top` and that the size and SHA-256 match `site/releases.json`.
3. Add the R2 upload to each release (recipe above).
