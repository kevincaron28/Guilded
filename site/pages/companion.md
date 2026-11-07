<section class="community-hero" aria-labelledby="companion-title">
<p class="eyebrow">COMPANION · WINDOWS</p>
<h1 id="companion-title">Get the Guilded <em>companion.</em></h1>
<p>A small free Windows app that sends your addon's saved data to Discord and the website, and brings standings back to the game.</p>
<div class="actions"><a class="button" href="{{COMPANION_DIRECT_URL}}">Download for Windows <span aria-hidden="true">↓</span></a><a class="button secondary" href="https://apps.microsoft.com/detail/9N680XX3QFL9">Microsoft Store <span aria-hidden="true">↗</span></a></div>
<p class="micro">Free · Windows 10 and 11 · about 120 MB · updates itself</p>
</section>

## Android app (preview)

<div class="actions"><a class="button" href="{{ANDROID_APK_URL}}">Download the Android app (APK) <span aria-hidden="true">↓</span></a><a class="button secondary" href="{{ANDROID_RELEASE_URL}}">Release notes <span aria-hidden="true">↗</span></a></div>

A free **preview** of the Guilded phone app for Android: check your guild's raid roster, reserves, loot wishlist and standings, and get raid reminders. It is a sideloaded preview, version {{ANDROID_VERSION}}, not on Google Play yet. After you open the file, Android asks you to allow installing from your browser: allow it once, then install. The app tells you when a newer version is ready and updates its content by itself.

SHA-256 of the file: `{{ANDROID_SHA256}}`. You can compare it with the checksum shown by a file-hash tool before installing.

## Do I need the Windows companion?

- **Addon only:** no. The addon works in game on its own, and your guild shares EP/GP, loot and standings in game without the companion.
- **Discord and website features:** yes. Achievements, leaderboards, your player page and standings synced with your guild's Discord need the companion to send your saved data.

The companion works on **Windows only**. There is no Mac or Linux version and no browser version.

## Install in three steps

1. **Download.** [Download for Windows]({{COMPANION_DIRECT_URL}}). The link always gives the newest version.
2. **Run it.** Open the file you downloaded. Windows may say it "protected your PC": choose **More info → Run anyway** (the installer is free and not code-signed). There is nothing to choose: it installs and opens the companion by itself.
3. **Let the setup do the rest.** The companion finds World of Warcraft on any drive, installs or updates the Guilded addon, and opens Discord in your browser: pick your guild's server and press **Connect**. After your next `/reload` in WoW (or when you log out) it syncs by itself, and keeps syncing from the tray.

That's all. The companion **updates itself**: new versions download in the background and install when you quit or restart it, or at once with **Update now** on its Home page.

**Already have Guilded Companion from the Microsoft Store?** This installer replaces it and keeps your settings and Discord link, so you only have one. Prefer the Store? [Get it from Microsoft Store](https://apps.microsoft.com/detail/9N680XX3QFL9) instead: it is Store-signed and the Store updates it (to update right away, choose **Open Microsoft Store** on the companion's Home).

**Something not working?** Open the companion and press **Repair**: it checks the WoW folder, the addon, your sign-in and the sync, fixes what it can, and says plainly what is left. See the [member installation guide](../docs/MEMBER_INSTALL.html) for every step with pictures.

**Checking the file yourself.** The SHA-256 of the installer (version {{COMPANION_DIRECT_VERSION}}) is `{{COMPANION_DIRECT_SHA256}}`, and every release lists its checksums in `SHA256SUMS` on the [release page](https://github.com/kevincaron28/Guilded/releases/latest).
