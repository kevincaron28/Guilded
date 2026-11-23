# Deploying a build made in CI (no npm ci on the 1 GB server)

`deploy/update.sh` used to install dependencies, generate the Prisma client and build the companion bundle on the
1 GB bot server, which froze it during deploys (limitations audit G1). Now GitHub Actions builds all of that for every
commit on `main`, and the server only **downloads, verifies, unpacks and restarts**.

## What changed

| Piece | Role |
|---|---|
| `.github/workflows/bot-build.yml` | On every push to `main`: `npm ci`, `prisma generate`, `companion:build`, package, smoke-test the unpack path, publish. Pull requests that touch `deploy/**` run the same build and smoke test but publish nothing. |
| `deploy/package-release.sh` | Builds `guilded-bot-<commit>.tar.gz` and its `.sha256`: source, the full `node_modules` of `npm ci`, the generated Prisma client, the companion bundle and the stamps the start step uses. Never packages `.git`, `.env*`, `backups`, `dist` or `mobile`. |
| GitHub pre-release `bot-build-<commit>` | Holds the two files. Marked pre-release and **not latest**, so it never replaces the product release (the downloads page and the website keep pointing at the real latest release). The newest 6 are kept. |
| `deploy/update.sh` | Fetches `main` as before, then downloads that commit's build, checks the checksum and that the package is the build of that commit, unpacks it as the staging directory and carries over `.env.local`. From there it is the existing path: disk check, stop, swap directories, migrations at start, restart, health check. |
| `deploy/application-update.sh` | `prepare_prebuilt_application` (the download, check and unpack) and `wait_for_prebuilt`. |

Why the full `node_modules` and not a pruned one: the bot runs through `tsx` and the start step runs `prisma migrate deploy`,
both devDependencies, and a full tree keeps the server's own build-on-server fallback and its dependency checks exactly
as they were. The download is a few hundred MB; the server's disk check already requires 3 GB free.

Everything the old path did still happens in the same order: the checkout fast-forward, the disk check, stopping the
bot only after the new application is ready, saving the previous application for recovery, applying migrations at
start (`npm run db:start`, unchanged), restarting and checking `/health`. Take the database backup before a deploy
exactly as `docs/V5_0_RELEASE_HANDOFF.md` says; this change does not touch that. Never start a second bot.

## Using it

```bash
cd ~/guilded && sudo bash deploy/update.sh                    # default: prebuilt when available
sudo bash deploy/update.sh --prebuilt                         # prebuilt only; stop (nothing touched) if it cannot be used
sudo bash deploy/update.sh --build-on-server                  # the old path, building here (same as GUILDED_BUILD_ON_SERVER=1)
sudo PREBUILT_WAIT_SECONDS=0 bash deploy/update.sh            # do not wait for a build that is still running
```

In the default mode, if the build of the commit being deployed is not published yet (you deployed seconds after the merge) the
script waits up to 10 minutes for it (`PREBUILT_WAIT_SECONDS`, default 600), because the CI build takes about 5 minutes.
If it never appears, or the download or checksum fails, it says so and **falls back to building on the server**, exactly as before.
A failed prebuilt attempt never stops the bot: the staging directory is removed and the running application is untouched.

## How to switch on

Nothing to configure. After this is merged:

1. The workflow runs on the merge commit; check Actions → "Bot release build" is green and Releases shows a `bot-build-<commit>` pre-release.
2. On the server, update the source checkout the usual way (the first deploy of this change still runs the *old* `update.sh`
   that is already on the server's checkout, which builds on the server; the new script takes over from the next deploy):
   `cd ~/guilded && sudo bash deploy/update.sh`.
3. From then on the same command downloads the build. The output shows `Fetching the prebuilt bot from GitHub` and `[prepare] prebuilt <commit> unpacked in Ns`.
4. If anything looks wrong: `sudo bash deploy/update.sh --build-on-server`.

The repository is public, so the server downloads without a token. If the repository ever becomes private, set
`PREBUILT_BASE` and add a token to the download (`deploy/application-update.sh`), or keep using `--build-on-server`.

## Rolling back

Unchanged: the previous application is saved as `/opt/guilded.previous.<id>`; see `deploy/recover-application.sh` and
`docs/V5_0_RELEASE_HANDOFF.md`. To deploy an older commit, revert on `main` (the script requires `main`), let CI build
the revert, and deploy that.

## Checks that cover it

`tests/deploy-prebuilt.test.ts` (static order and flags, and on Linux a real unpack with a good, a tampered and a missing
build) and the workflow's own smoke test, which unpacks the freshly built package through the same function and loads the
generated Prisma client before anything is published.
