# Optional Battle.net connection

This feature is source work for the coordinated next release, not a change to
published 8.0.2. Keep Discord as the Guilded sign-in and guild-access authority.
Battle.net adds a private, verified character selection to that same account.
It does not read addon ledgers, grant Discord roles, replace companion uploads,
or change guild character ownership or mains.

## Register the application

1. Sign in to the [Battle.net developer portal](https://develop.battle.net/access/clients).
   It may redirect to Blizzard's developer community login. Open API Access /
   Create Client and create an application named **Guilded**.
2. Register this exact redirect URI:
   `https://guilded.kcaron.top/me/battlenet/callback`
3. If asked for the website, use `https://guilded.kcaron.top`. Use the actual
   operator contact and the project's published privacy notice. Do not use the
   companion's custom protocol as this callback: authorization completes on the server.
4. Keep the generated client ID and secret in the backend's protected environment
   configuration. Do not paste the secret into chat, a PR, the desktop application,
   browser assets or a committed file.

These registration steps follow [Blizzard's OAuth sample instructions](https://github.com/Blizzard/oauth-client-sample#creating-an-oauth-client).
The exact portal labels may change. No application was registered during implementation.

## Backend configuration

Set `BATTLENET_CLIENT_ID` and `BATTLENET_CLIENT_SECRET` in the bot service's
protected environment, alongside the existing Discord web authentication settings.
`PUBLIC_SITE_URL` must remain `https://guilded.kcaron.top`; the callback derives
from that origin. A separately hosted instance registers its own origin and callback.
Do not put these credentials in Cloudflare's static site or the Windows package.

The server requests `openid wow.profile`. The secret is used only to exchange
the authorization code. Access tokens are used for discovery and discarded;
refresh tokens are not retained. Missing either credential disables Battle.net
linking while Discord and addon sync continue to work.

Apply the additive `20261127000000_companion_devices_battlenet` migration during
the coordinated backend deployment. Deploy backend routes and migration before
shipping the updated companion. Deploy the matching Worker change before enabling
Battle.net: it permits the start route's redirect to Blizzard. Use the existing backup/deployment runbook;
configuration alone does not deploy this branch. Keep published release bytes intact.

## Verify after the coordinated deployment

1. Sign into Guilded with Discord; open **Accounts and devices → Connect Battle.net**.
2. Choose a region and edition, authorize on Blizzard, and inspect the preview.
   Confirm only the characters you want retained and optionally choose an account main.
3. Check that unselected alts are absent from the saved selection and that connecting
   does not publish them or alter guild roles, points, existing ownership or guild mains.
4. Cancel an authorization and try an expired/reused callback. Existing connections
   should remain intact. Disconnect removes the private selection and invalidates
   pending discovery; it does not delete guild records.
5. Connect two companion devices and verify both still sync. Revoke one under
   `/me/connections`; confirm the other continues and the revoked one is rejected.
6. Test each desired region/edition with a real Blizzard account. The implementation
   uses profile, profile-classic1x, profile-classicann and profile-classic namespaces
   for Retail, Era, TBC Anniversary and Mists respectively. Provider availability
   can differ. Errors leave existing selections unchanged. Forever discovery stays
   disabled until its API is verified; addon pairing remains available.

Live OAuth, per-edition availability and real-game acceptance remain unperformed
until a developer application and suitable accounts are available. Discovery
refresh requires reconnecting; background companion uploads do not require it.

## Retention and recovery

Only provider account ID/BattleTag and explicitly confirmed character identifiers,
names, realm, region, edition, main choice and verification time are persisted.
An unconfirmed preview is held in memory for at most ten minutes. Restarting the
server cancels pending flows; start again. Existing server backups include the
new models and follow normal backup retention after unlinking.

To disable new Battle.net authorization, remove the two environment settings and
restart the deployed service. Existing private selections can still be viewed
and disconnected. Do not roll back by dropping tables containing user choices.
