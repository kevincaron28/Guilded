# Guilded Android release preparation

Working draft for `top.kcaron.guilded`. Review the signed build and deployment evidence before submitting these claims. The mobile version is independent of the bot/addon/desktop version.

## Play listing draft

**Name** · Guilded

**Short description** · Check raid rosters, loot wishlists and guild standings for World of Warcraft.

**Full description**

See who is signed up for your next raid, check the latest reserve list and update your character's loot wishlist from your phone. Guilded connects members of World of Warcraft guilds that use the Guilded Discord bot, addon and companion.

Browse public dungeon and guild rankings without signing in. Connect a participating guild through Discord to see your linked characters, guild rank, raid roster and EP/GP standings. Reserves reflect the latest officer upload. Use the linked signup destination to respond to a raid.

Choose whether to receive raid alerts. You can explore the screens with a sample guild before connecting your own. Guilded is an independent community tool.

**Screenshot order** · Capture the actual preview build, using the sample guild or an authorized test guild with fictional names. Match screenshot language to the listing. Remove codes, device identifiers, real member names and private notifications.

1. Home showing the weekly summary and a public rankings destination.
2. Characters with a sample main, guild rank and role.
3. Next raid and roster with the signup handoff visible.
4. Wishlist after adding a fictional item at a selected priority.
5. Reserves and standings with enough rows to demonstrate navigation.
6. Alerts preference and its permission state. Describe remote delivery only after a verified push.

## Play Data safety worksheet

Use the final signed release build, SDK configuration, production server behavior and actual provider agreements to complete the Play form. These are proposed answers, with the remaining checks called out.

| Play question or category | Proposed answer | What to verify before submission |
|---|---|---|
| Does the app collect user data? | Yes. The signed-in features associate requests with a Guilded member or account. Public browsing and sample data are available without connecting a guild. | Account IDs and authentication requests transmitted to the selected Guilded service |
| Personal info → User IDs | Collected for account management and app functionality when connecting a guild | Discord/account IDs and any user-linked names actually transmitted by the app. Character names received only for display should be distinguished from submitted content |
| App activity → Other user-generated content | Collected for app functionality when a member edits a wishlist | Character selection, submitted or removed item and priority. Verify the exact payload and retention |
| Device or other IDs | Collected for opted-in push delivery. Review required installation identifiers from Expo Updates separately | Expo push token, FCM and update SDK behavior, deletion on logout/revoke, production provider retention |
| App activity, app information and performance | Review network/server diagnostic records. Declare retained app interactions, diagnostics or crash data if collected | Identify retained event fields, purposes and whether they identify users. A local render fallback alone does not send crash telemetry |
| Data shared | Determine per category and recipient | Classify Expo, FCM, hosting and self-hosted guild servers under the actual terms. Assess member-initiated browser/Discord handoffs. Apply a service-provider exemption only where the agreement and use qualify |
| Data encrypted in transit | Answer Yes only after release verification | HTTPS for hosted and remote custom servers, push and updates endpoints, release network policy and behavior of the development loopback exception |
| Can users request deletion? | Existing policy offers a verified access/deletion request to Guilded support | Test a discoverable in-app path and a public out-of-app URL. Verify deletion of credentials, device registrations and related data, plus disclosed retention exceptions |
| Account creation | Verify whether the browser approval/sign-in creates a Guilded account for new users | If it does, complete the Play account-deletion questions and exercise both paths end to end |
| Other categories | No mobile feature identified that needs advertising IDs, contacts, location, microphone, photos, payments or health data | Verify merged manifest, final bundled SDKs, permissions and actual network behavior |

**Privacy policy checklist.** Verify the policy URL is public, accessible without sign-in and linked in the app. Name the Android app and publisher, data categories, purposes, selected guild operator and service providers. Explain local credentials, notification preferences and device registration, update requests, retention, withdrawal, deletion and a monitored contact. Test opt-out, sign-out and revocation against the production-equivalent service. Reconcile the bilingual notice and Console answers with the same build.

References: [Guilded privacy policy](https://guilded.kcaron.top/docs/PRIVACY.html), [Google Play Data safety instructions](https://support.google.com/googleplay/android-developer/answer/10787469), [Google Play account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111).

## Candidate release notes

Check your guild's linked characters, raid roster, reserves, wishlist and standings on Android. Browse public rankings or explore a sample guild before signing in. Choose your raid reminder settings in Alerts.

## Android acceptance sheet

Record the APK build ID and SHA-256, app version/code, device and OS, test account scope, network mode and actual result. Mark each case passed, failed or blocked. Keep codes, grants, Expo tokens and private guild screenshots out of the repository.

| Screen or flow | Actions | Acceptance |
|---|---|---|
| Install / Home | Fresh install, cold start, resume, refresh; test empty, offline and malformed responses | App starts, reports data freshness, explains failures and recovers |
| Ranks | Select an edition, open dungeon and guild rankings, return with Android Back | Correct edition and destination, useful error if browser is unavailable |
| Profile | Open public directory, account, linking and privacy controls | Browser handoff is clear, no grant in URL, browser Back returns to app |
| Guild login | Sample, valid and expired pairing, browser approval with app backgrounded, interrupted network, personal grant, sign-out and restart | Correct guild/account and visible recovery; no previous member data or notifications after logout |
| Characters | Linked and empty guild, long names, large font, French | Ranks and roles stay readable; screen is accessible via TalkBack |
| Reserves | Empty, locked and long imported list including an item beyond row 40 | Status, ownership and all entries are reachable |
| Wishlist | Add, change priority, remove, double-tap, fail then reconnect | Correct character and persisted result, clear failure/outcome, no duplicate or lost change |
| Raids | No next raid, populated roster, long standings and core boards, signup with/without Discord event URL | All rows reachable and member can find the correct signup instructions |
| Alerts | Deny and grant permission; enable, disable, revoke; simulate a failed refresh, raid reschedule/cancel and different account | Delivery only when authorized, no duplicate, preservation on transient error, tap opens the correct guild context |
| Links | Open allowlisted link on cold and warm app, unrelated host, auth browser callback and missing app | Intended screen; unrelated URLs and approval remain usable in browser |
| Updates | Compatible test update, already-current, airplane mode and native runtime mismatch | Release check succeeds or app opens bundled/cached content; incompatible update does not load |
| Accessibility / recovery | Screen reader, 200% font, display cutout, Android Back, a controlled render error, then retry | Announced labels/states, recoverable fallback, controls remain reachable |

## Build and maintenance

From `mobile/`, after selecting the correct Expo project and checking credentials:

```sh
eas build -p android --profile preview
eas build -p android --profile production
```

Use the preview APK for installation. Save the production AAB for Play. Check the binary's merged permissions, signing fingerprint and actual versionCode before submission. Keep deployment, store submission and update publication separate from building.

For a future approved JS-only fix, use the same project, channel and compatible runtime as the installed build:

```sh
eas update --platform android --channel preview --message "Describe the tested fix"
eas update --platform android --channel production --message "Describe the tested fix"
```

Test preview first. Native or dependency changes require a new build. With appVersion runtime policy, bump the mobile app version for native runtime changes so incompatible updates cannot reach older binaries.
