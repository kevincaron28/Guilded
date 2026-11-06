<section class="community-hero" aria-labelledby="companion-title">
<p class="eyebrow">COMPANION · WINDOWS</p>
<h1 id="companion-title">Get the Guilded <em>companion.</em></h1>
<p>A small free Windows app that sends your addon's saved data to Discord and the website, and brings standings back to the game.</p>
<div class="actions"><a class="button" href="https://apps.microsoft.com/detail/9N680XX3QFL9">Microsoft Store (recommended, signed) <span aria-hidden="true">↗</span></a><a class="button secondary" href="{{COMPANION_DIRECT_URL}}">Direct download (auto-updating) <span aria-hidden="true">↓</span></a></div>
</section>

## Android app (preview)

<div class="actions"><a class="button" href="{{ANDROID_APK_URL}}">Download the Android app (APK) <span aria-hidden="true">↓</span></a><a class="button secondary" href="{{ANDROID_RELEASE_URL}}">Release notes <span aria-hidden="true">↗</span></a></div>

A free **preview** of the Guilded phone app for Android: check your guild's raid roster, reserves, loot wishlist and standings, and get raid reminders. It is a sideloaded preview, version {{ANDROID_VERSION}}, not on Google Play yet. After you open the file, Android asks you to allow installing from your browser: allow it once, then install. The app tells you when a newer version is ready and updates its content by itself.

SHA-256 of the file: `{{ANDROID_SHA256}}`. You can compare it with the checksum shown by a file-hash tool before installing.

## Do I need the Windows companion?

- **Addon only:** no. The addon works in game on its own, and your guild shares EP/GP, loot and standings in game without the companion.
- **Discord and website features:** yes. Achievements, leaderboards, your player page and standings synced with your guild's Discord need the companion to send your saved data.

The companion works on **Windows only**. There is no Mac or Linux version and no browser version.

## Install

1. **Microsoft Store (recommended, signed).** Open the [Guilded Companion listing](https://apps.microsoft.com/detail/9N680XX3QFL9). It is Store-signed and the Store updates it by itself.
2. **Direct download (auto-updating).** For people who would rather not use the Store: [download the installer]({{COMPANION_DIRECT_URL}}). This link always gives the newest version. Install it once and forget it: the companion checks for new releases every few hours, verifies each download against its published checksum and installs it quietly when you close it or start it next. You can turn this off or check by hand in the companion's settings.

**About the Windows warning.** The direct installer is not code-signed, so Windows SmartScreen may say it "protected your PC". Choose **More info → Run anyway**. To check the file yourself, its SHA-256 (version {{COMPANION_DIRECT_VERSION}}) is `{{COMPANION_DIRECT_SHA256}}`, and every release lists its checksums in `SHA256SUMS` on the [release page](https://github.com/kevincaron28/Guilded/releases/latest). The Store version never updates itself this way, because the Store does it.

Then open the companion, choose **Sign in with Discord**, pick your server (or public leaderboards only) and choose your saved data. After playing, `/reload` in WoW and the companion syncs. See the [member installation guide](../docs/MEMBER_INSTALL.html) for every step.

Moved here from the old online companion? Your Discord link lives in the Windows app: sign in once and you are set.
