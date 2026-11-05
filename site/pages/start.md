<section class="community-hero start-hero" aria-labelledby="start-title">
<p class="eyebrow">START HERE</p>
<h1 id="start-title">New to Guilded? <em>Start here.</em></h1>
<p>Pick who you are. You will only see your own steps.</p>
<nav class="start-picker" aria-label="Who are you?">
<a class="button" href="#player">I’m a player<small>Install, sign in, play</small></a>
<a class="button secondary" href="#officer">I’m an officer<small>Run the guild</small></a>
<a class="button secondary" href="#owner">I run the Discord server<small>Add the bot</small></a>
</nav>
</section>
<div class="start-paths">
<section id="player" class="start-path" aria-labelledby="player-title">
<h2 id="player-title">Players: three steps</h2>
<p>Free. The addon works on its own in game; the Windows companion is what links your characters to Discord.</p>
<ol class="start-list">
<li class="start-step"><div class="start-head"><span class="start-num" aria-hidden="true">1</span><h3>Install the addon</h3><span class="start-tag required">Required</span></div><p>Pick the WoW version you play. The button opens that version’s download and shows where the files go.</p>{{START_EDITIONS}}</li>
<li class="start-step"><div class="start-head"><span class="start-num" aria-hidden="true">2</span><h3>Get the companion</h3><span class="start-tag required">Recommended</span></div><p>It links all your characters to your Discord account and sends your saved game data to Discord and the website. Windows only. No Windows PC? Type <code>/character pair</code> in Discord for a one-line way instead.</p><p><a class="button start-big" href="https://apps.microsoft.com/detail/9N680XX3QFL9">Get it from Microsoft Store <span aria-hidden="true">↗</span></a></p><p class="small">The Store gives you the latest published companion and updates it by itself. <a href="https://github.com/kevincaron28/Guilded/releases/latest">Store not an option? Direct download from GitHub</a> (unsigned: Windows may warn you).</p></li>
<li class="start-step"><div class="start-head"><span class="start-num" aria-hidden="true">3</span><h3>Sign in with Discord in the companion</h3><span class="start-tag">One click</span></div><p>Open the companion, press <strong>Sign in with Discord</strong>, then <strong>Connect</strong> in your browser. It finds your WoW folder by itself. Then type <code>/reload</code> once in game: a green ✓ in the companion means you are done, and every character on that PC is linked.</p><p><a class="button secondary" href="/me/">Website only: sign in on My Guilded <span aria-hidden="true">→</span></a></p></li>
</ol>
<h3>What do I need?</h3>
<div class="table-wrap"><table><thead><tr><th scope="col">Piece</th><th scope="col">Do I need it?</th><th scope="col">What it is for</th></tr></thead><tbody><tr><th scope="row">Addon</th><td><strong>Required</strong></td><td>Everything in game: EP/GP, loot, dungeons, crafters.</td></tr><tr><th scope="row">Companion</th><td><strong>Optional</strong></td><td>Sends game data to Discord and the website. Windows only.</td></tr><tr><th scope="row">Discord bot</th><td><strong>Only for server owners</strong></td><td>Signups, standings and polls in your Discord. Members never install it.</td></tr></tbody></table></div>
<h3>It did not work?</h3>
<div class="start-help"><details><summary>The addon is not in game</summary><p>Close WoW completely, then copy the <code>Guilded</code> folder into <code>Interface/AddOns</code> of the game version you launch. Inside it you must see <code>Guilded.toc</code> (not a second <code>Guilded</code> folder). Start WoW and tick <strong>Load out of date AddOns</strong> if asked.</p></details><details><summary>The website or Discord shows nothing</summary><p>WoW only saves your data when you type <code>/reload</code> or log out. Do that, then let the companion sync. Still no character? In Discord type <code>/character claim</code> and pick yours.</p></details><details><summary>Wrong version or folder</summary><p>Each WoW version has its own file and its own game folder. Check the version in Battle.net, then use <em>Show in Explorer</em> to find that folder.</p></details></div>
<p><strong>Still stuck?</strong> <a href="/docs/MEMBER_INSTALL.html">Full install guide</a> · <a href="/docs/AI_SETUP_HELP.html">Setup help</a> · <a href="https://discord.gg/YjzFwtP64V">Ask on Discord ↗</a></p>
</section>
<section id="officer" class="start-path" aria-labelledby="officer-title">
<h2 id="officer-title">Officers: the shortest path</h2>
<p>You can run everything in game with the addon alone. Discord is optional.</p>
<ol class="start-list"><li class="start-step"><div class="start-head"><span class="start-num" aria-hidden="true">1</span><p><strong>Install the addon</strong> and ask your members to do the same. Share this page: <a href="/start/">guilded.kcaron.top/start</a>.</p></div></li><li class="start-step"><div class="start-head"><span class="start-num" aria-hidden="true">2</span><p><strong>Set the rules in game.</strong> EP/GP, loot and raid cores: <a href="/docs/EPGP_GUIDE.html">EP/GP guide</a>.</p></div></li><li class="start-step"><div class="start-head"><span class="start-num" aria-hidden="true">3</span><p><strong>Want Discord?</strong> Ask the server owner to add the bot (the server tab shows how). Then run the <a href="/companion/">companion</a> and sign in with Discord, so your guild’s data reaches Discord. At least one officer should run it.</p></div></li><li class="start-step"><div class="start-head"><span class="start-num" aria-hidden="true">4</span><p><strong>Go public when ready:</strong> <code>/guildpage create</code>, then <code>/guildpage publish</code>.</p></div></li></ol>
<p class="actions"><a class="button start-big" href="/officers/">Officer guide <span aria-hidden="true">→</span></a></p>
</section>
<section id="owner" class="start-path" aria-labelledby="owner-title">
<h2 id="owner-title">Server owners: add the bot</h2>
<p>Free hosted bot. You need permission to manage the server.</p>
<ol class="start-list"><li class="start-step"><div class="start-head"><span class="start-num" aria-hidden="true">1</span><p><strong>Add the bot</strong> with the button below.</p></div></li><li class="start-step"><div class="start-head"><span class="start-num" aria-hidden="true">2</span><p><strong>Run <code>/setup start</code></strong> in Discord. Pick your language and channels. <code>/setup start status:true</code> shows what is missing.</p></div></li><li class="start-step"><div class="start-head"><span class="start-num" aria-hidden="true">3</span><p><strong>You are on Guilded Lite right away.</strong> Addon sync, EP/GP and seasons unlock once your server is approved: <a href="/docs/HOSTED_PILOT.html">hosted bot guide</a>.</p></div></li><li class="start-step"><div class="start-head"><span class="start-num" aria-hidden="true">4</span><p><strong>Tell your members</strong> to open <a href="/start/">this page</a>. Officers then run the companion.</p></div></li></ol>
<p class="actions"><a class="button start-big" href="https://discord.com/oauth2/authorize?client_id=1552633893587394590&amp;scope=bot+applications.commands&amp;integration_type=0&amp;permissions=2269718703631440">Add Guilded to your Discord ↗</a><a class="button secondary" href="/docs/HOSTED_PILOT.html">Hosted bot guide</a></p>
</section>
</div>
