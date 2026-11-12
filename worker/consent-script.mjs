// The consent banner, served by the Worker as /consent.js on the pages that may carry ads (worker/ads.mjs).
// Nothing from Google loads before a choice. Accept loads AdSense; Decline loads nothing (Quebec Law 25: the
// safe default). To show non-personalised ads after Decline instead, change LOAD_AFTER_DECLINE to true.
export const CONSENT_SCRIPT = String.raw`(function () {
  "use strict";
  var KEY = "guilded_ad_consent";
  var CLIENT = "ca-pub-6948243189424271";
  var LOAD_AFTER_DECLINE = false;
  var fr = /^fr/i.test(document.documentElement.lang || "");
  var T = fr ? {
    text: "Guilded affiche de la publicité Google pour couvrir l'hébergement. Acceptez-vous les témoins publicitaires de Google? Refuser ne charge rien de Google.",
    accept: "Accepter", decline: "Refuser", change: "Choix de témoins", more: "En savoir plus", label: "Publicité et témoins"
  } : {
    text: "Guilded shows Google ads to help pay for hosting. Do you accept Google's advertising cookies? Declining loads nothing from Google.",
    accept: "Accept", decline: "Decline", change: "Cookie choices", more: "Learn more", label: "Advertising and cookies"
  };
  var memory = null;
  function read() { try { return window.localStorage.getItem(KEY); } catch (e) { return memory; } }
  function write(value) { memory = value; try { window.localStorage.setItem(KEY, value); } catch (e) { /* kept for this page only */ } }
  function loadAds(personalised) {
    if (document.getElementById("guilded-adsense")) return;
    window.adsbygoogle = window.adsbygoogle || [];
    if (!personalised) window.adsbygoogle.requestNonPersonalizedAds = 1;
    var s = document.createElement("script");
    s.id = "guilded-adsense"; s.async = true; s.crossOrigin = "anonymous";
    s.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + CLIENT;
    document.head.appendChild(s);
  }
  function apply(choice) {
    if (choice === "accept") loadAds(true);
    else if (choice === "decline" && LOAD_AFTER_DECLINE) loadAds(false);
  }
  var css = document.createElement("style");
  css.textContent = ".gc-banner{position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483000;max-width:640px;margin:0 auto;padding:16px;border:1px solid #d4af37;border-radius:10px;background:#15171a;color:#f2efe6;font:15px/1.45 system-ui,sans-serif;box-shadow:0 6px 28px rgba(0,0,0,.5)}.gc-banner p{margin:0 0 12px}.gc-banner a{color:#e8c766}.gc-row{display:flex;gap:10px;flex-wrap:wrap}.gc-btn{flex:1 1 140px;min-height:44px;padding:10px 16px;border:2px solid #d4af37;border-radius:8px;background:#d4af37;color:#15171a;font:inherit;font-weight:700;cursor:pointer}.gc-btn:focus-visible{outline:3px solid #fff;outline-offset:2px}.gc-link{background:none;border:0;padding:4px 0;color:inherit;font:inherit;text-decoration:underline;cursor:pointer}";
  document.head.appendChild(css);
  var banner = null;
  function close() { if (banner && banner.parentNode) banner.parentNode.removeChild(banner); banner = null; }
  function choose(choice) {
    var before = read();
    write(choice);
    close();
    if (before === "accept" && choice !== "accept") { window.location.reload(); return; }
    apply(choice);
  }
  function show() {
    if (banner) return;
    banner = document.createElement("div");
    banner.className = "gc-banner"; banner.setAttribute("role", "dialog"); banner.setAttribute("aria-label", T.label);
    var p = document.createElement("p"); p.textContent = T.text + " ";
    var a = document.createElement("a"); a.href = fr ? "/docs/PRIVACY?lang=fr#publicit%C3%A9-et-t%C3%A9moins" : "/docs/PRIVACY#advertising-and-cookies"; a.textContent = T.more; p.appendChild(a);
    var row = document.createElement("div"); row.className = "gc-row";
    [["accept", T.accept], ["decline", T.decline]].forEach(function (pair) {
      var b = document.createElement("button"); b.type = "button"; b.className = "gc-btn"; b.textContent = pair[1];
      b.addEventListener("click", function () { choose(pair[0]); });
      row.appendChild(b);
    });
    banner.appendChild(p); banner.appendChild(row);
    document.body.appendChild(banner);
  }
  function footerLink() {
    var b = document.createElement("button"); b.type = "button"; b.className = "gc-link"; b.textContent = T.change;
    b.addEventListener("click", show);
    var host = document.querySelector("footer") || document.body;
    var wrap = document.createElement("p"); wrap.appendChild(b); host.appendChild(wrap);
  }
  function start() {
    footerLink();
    var saved = read();
    if (saved === "accept" || saved === "decline") apply(saved); else show();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
`;
