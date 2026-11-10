<section class="community-hero" aria-labelledby="companion-title">
<p class="eyebrow">COMPANION · WINDOWS</p>
<h1 id="companion-title">Get the Guilded <em>companion.</em></h1>
<p>A small free Windows app that sends your addon's saved data to Discord and the website, and brings standings back to the game.</p>
<div class="actions"><a class="button" href="{{COMPANION_DIRECT_URL}}">Download for Windows <span aria-hidden="true">↓</span></a><a class="button secondary" href="https://apps.microsoft.com/detail/9N680XX3QFL9">Microsoft Store <span aria-hidden="true">↗</span></a></div>
<p class="micro">Free · Windows 10 and 11 · about 120 MB · updates itself</p>
</section>

<h2 id="android">Android app (preview)</h2>

<div class="actions"><a class="button" href="{{ANDROID_APK_URL}}">Download for Android <span aria-hidden="true">↓</span></a><a class="button secondary" href="{{ANDROID_RELEASE_URL}}">GitHub <span aria-hidden="true">↗</span></a></div>

A free **preview** of the Guilded phone app for Android: check your guild's raid roster, reserves, loot wishlist and standings, and get raid reminders. It is a sideloaded preview, version {{ANDROID_VERSION}}, not on Google Play yet. After you open the file, Android asks you to allow installing from your browser: allow it once, then install. The app tells you when a newer version is ready and updates its content by itself.

**Install it on your phone in three taps:**

1. Tap **Download for Android** (about 74 MB). If your browser asks, keep the file.
2. Open the downloaded file. Android asks once to **allow installs from your browser**: allow it, then tap **Install**.
3. Open **Guilded** and sign in with Discord.

If Android says the app can't be installed because it conflicts with an older Guilded, **uninstall the old Guilded app first**, then install again. Version {{ANDROID_VERSION}} (preview). The GitHub copy of an older build is still on the [release page]({{ANDROID_RELEASE_URL}}).

SHA-256 of the file: `{{ANDROID_SHA256}}`. You can compare it with the checksum shown by a file-hash tool before installing.

## Do I need the Windows companion?

- **Addon only:** no. The addon works in game on its own, and your guild shares EP/GP, loot and standings in game without the companion.
- **Discord and website features:** yes. Achievements, leaderboards, your player page and standings synced with your guild's Discord need the companion to send your saved data.

The companion works on **Windows only**. There is no Mac or Linux version and no browser version.

## Sync with Discord in 3 steps

1. **Download.** [Download for Windows]({{COMPANION_DIRECT_URL}}), or search **Guilded Companion** in the Microsoft Store. The link always gives the newest version.
2. **Run it.** Open the file you downloaded. Windows may say it "protected your PC": choose **More info → Run anyway** (the installer is free and not code-signed). There is nothing to choose: it installs and opens the companion by itself.
3. **Keep it open.** It starts with Windows and lives in the tray. The companion finds World of Warcraft on any drive, installs or updates the Guilded addon, and picks your guild's Discord server from your in-game guild. After your next `/reload` in WoW (or when you log out) it syncs by itself.

**Signing in with Discord is optional.** Until you sign in, your characters are shown as reported by your PC; press **Sign in with Discord** in the companion to confirm them and unlock your personal page and Discord messages.

That's all. The companion **updates itself**: new versions download in the background and install when you quit or restart it, or at once with **Update now** on its Home page.

**Several WoW accounts on this PC?** Each one syncs by itself. When the companion finds Guilded's data on another account (WoW1, WoW2…), it asks once on the Sync page whether that account is yours too: **Yes, sync it too** adds it, **No, not mine** leaves it alone for good (for a partner who plays on the same PC with their own Discord). Every account then gets its own line on the Sync page, and **Settings → Your WoW folder** has a switch beside each extra account. Log in once on a new account and type `/reload` so WoW saves its data.

**Already have Guilded Companion from the Microsoft Store?** This installer replaces it and keeps your settings and Discord link, so you only have one. Prefer the Store? [Get it from Microsoft Store](https://apps.microsoft.com/detail/9N680XX3QFL9) instead: it is Store-signed and the Store updates it (to update right away, choose **Open Microsoft Store** on the companion's Home).

**Something not working?** Open the companion and press **Repair**: it checks the WoW folder, the addon, your sign-in and the sync, fixes what it can, and says plainly what is left. See the [member installation guide](../docs/MEMBER_INSTALL.html) for every step with pictures.

**Checking the file yourself.** The SHA-256 of the installer (version {{COMPANION_DIRECT_VERSION}}) is `{{COMPANION_DIRECT_SHA256}}`, and every release lists its checksums in `SHA256SUMS` on the [release page](https://github.com/kevincaron28/Guilded/releases/latest).
