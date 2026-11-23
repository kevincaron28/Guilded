# Off-tenancy database backups (Cloudflare R2)

The database lives on the "Guilded-DB" Oracle VM and its nightly dumps sit on the bot server, in the same Oracle
tenancy. A suspended tenancy or a reclaimed VM would take both. This adds an **encrypted copy of a nightly dump in a
private Cloudflare R2 bucket**, kept for 14 daily and 6 monthly dumps, and a **monthly automated restore test**.

Nothing here touches the running bot: it is a separate timer-driven script (`scripts/offsite-backup.mjs`) that reads
the database with `pg_dump` and writes to the bucket. It never starts a second bot.

## How it works

| Piece | What it does |
|---|---|
| `scripts/offsite-backup.mjs backup` | `pg_dump` (custom format), counts rows in 9 key tables before and after, encrypts, uploads `daily/guilded-YYYY-MM-DD.dump.enc` plus a `.manifest.json` (checksum, counts, key ids), copies the first dump of a month to `monthly/`, deletes beyond 14 dailies and 6 monthlies. A failure posts one line to the error-log channel. |
| `scripts/offsite-backup.mjs restore-test` | Downloads the newest daily dump, checks its checksum, decrypts, restores into the scratch database `guilded_restore_test`, compares row counts with the manifest (1 % or 5 rows of drift allowed, the live database moves while a dump runs), drops the scratch database, reports 🟢 or 🔴 in the error-log channel. |
| `deploy/offsite-backup/*.timer` | Nightly 03:40 (server time) backup, restore test on the 2nd of each month. |
| `scripts/offsite-backup-lib.mjs` | Encryption, a small S3 client for R2 (no new dependency) and the retention rule. Tested in `tests/offsite-backup.test.ts`. |

### Encryption and keys

Each dump gets its own random AES-256-GCM key, wrapped (RSA-OAEP, 4096-bit) for each recipient **public** key. The server
holds public keys only, so a stolen server or a leaked R2 token cannot read a dump.

- **Recovery key pair**: the private half lives with the owner (offline: a password manager entry or a USB stick),
  never on the server, never in git, never in the bucket. This is the key you use after a disaster.
- **Restore-test key pair** (optional): the private half sits on the server so the monthly test can decrypt on its own.
  Trade-off: anyone with root on the server could then read the dumps. They already can read the live database, so the
  exposure is small, but you can skip this key: without it the monthly test still downloads the newest dump and
  checks its checksum, then reports 🟡 "not restored". Then restore by hand every few months (below).
- Losing the recovery private key *and* the server means the dumps cannot be read. Keep two copies of it.

The decryption keys are never next to the dumps: the dumps are in R2, the recovery key is on the owner's side, the
optional test key is on the server.

## How to switch it on (about 20 minutes, once)

### 1. Cloudflare (owner, dashboard)

1. R2 → **Create bucket** → name `guilded-backups`, keep it **private** (no public access, no custom domain).
2. R2 → **Manage R2 API Tokens** → create a token with **Object Read & Write**, limited to that one bucket. Copy the
   Access Key ID, the Secret Access Key and the account endpoint (`https://<account id>.r2.cloudflarestorage.com`).
   Put them only in the server file in step 3; never paste them in chat or git.
3. Optional safety net: a bucket lock or lifecycle rule is not needed (the script prunes), but you can add a rule that
   expires objects older than 400 days.

### 2. Make the key pairs (owner, on your PC, not on the server)

```powershell
node scripts/offsite-backup.mjs keygen "$env:USERPROFILE\Documents\guilded-backup-keys"
```

It writes `recovery.public.pem`, `recovery.private.pem`, `restore-test.public.pem` and `restore-test.private.pem`.
Store `recovery.private.pem` offline in two places. Do not put it in the repository or on the server.

### 3. The server (run on the bot server over SSH)

```bash
# the PostgreSQL client tools must match the server's major version (18)
pg_dump --version && psql --version   # if missing: sudo apt-get install -y postgresql-client-18

sudo install -d -m 750 -o root -g guilded /etc/guilded-backup
# copy the two *.public.pem files and (optional) restore-test.private.pem to /etc/guilded-backup/, then:
sudo chown root:guilded /etc/guilded-backup/*.pem && sudo chmod 640 /etc/guilded-backup/*.pem

cd ~/guilded   # the source checkout used for deploys
sudo install -m 640 -o root -g guilded deploy/offsite-backup/guilded-backup.env.example /etc/guilded-backup.env
sudo nano /etc/guilded-backup.env      # fill in the endpoint, bucket and the two R2 credentials
sudo install -m 644 deploy/offsite-backup/guilded-offsite-*.service deploy/offsite-backup/guilded-offsite-*.timer /etc/systemd/system/
sudo systemctl daemon-reload
```

The scripts run from `/opt/guilded` (they arrive with the next deploy of this change).

The restore test creates and drops the database `guilded_restore_test`. Its role needs `CREATEDB`
(`ALTER ROLE <bot role> CREATEDB;` on the database VM), or set `RESTORE_TEST_ADMIN_URL` in `/etc/guilded-backup.env`
to a URL that may create databases. The test never touches the live database's data.

### 4. First run and checks

```bash
sudo systemctl start guilded-offsite-backup.service        # first backup now
sudo journalctl -u guilded-offsite-backup.service -n 20 --no-pager   # expect {"stored":"daily/...","recipients":2,...}
sudo systemd-run --wait --pipe -p User=guilded -p WorkingDirectory=/opt/guilded -p EnvironmentFile=/opt/guilded/.env.local -p EnvironmentFile=/etc/guilded-backup.env node scripts/offsite-backup.mjs list   # lists what is in R2
sudo systemctl start guilded-offsite-restore-test.service  # first restore test now; expect a 🟢 line in the error-log channel
sudo systemctl enable --now guilded-offsite-backup.timer guilded-offsite-restore-test.timer
systemctl list-timers 'guilded-offsite-*'
```

A failed nightly backup or restore test posts a 🔴 line in the error-log channel; a passing test posts 🟢 once a month.

## Restoring after a disaster (new database VM or tenancy)

1. On your PC, download the newest object from the R2 dashboard (`daily/guilded-YYYY-MM-DD.dump.enc`).
2. Decrypt with the recovery key:

   ```powershell
   node scripts/offsite-backup.mjs decrypt guilded-2026-11-23.dump.enc guilded.dump "$env:USERPROFILE\Documents\guilded-backup-keys\recovery.private.pem"
   ```

   It prints "Decrypted and authenticated" only if the file is intact.
3. Create an empty database on the new PostgreSQL 18 server and restore:
   `pg_restore --no-owner --no-privileges --dbname <new database url> guilded.dump`
4. Point `DATABASE_URL` in `/opt/guilded/.env.local` at it. Follow `docs/V5_0_RELEASE_HANDOFF.md` before starting the
   bot, and never run two bots on one token. The bot applies any newer migrations at start.

## Day-to-day

- **Rotate R2 credentials:** create a new token, edit `/etc/guilded-backup.env`, run the backup service once, delete the old token.
- **Rotate keys:** run `keygen` again, install the new public keys; new dumps use them, older dumps still need the old
  recovery private key until they age out (6 months).
- **Size:** the free R2 tier is 10 GB. A bucket of 14 + 6 dumps is about 20 times one encrypted dump; watch the size in
  the first month. If the dump grows past about 400 MB, lower the dailies in `retentionDeletes` or pay R2's few cents per GB.
- **Stop it:** `sudo systemctl disable --now guilded-offsite-backup.timer guilded-offsite-restore-test.timer`.
- The nightly dump that stays on the bot server is unchanged by this.
