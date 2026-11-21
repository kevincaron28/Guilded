// The consent banner, served by the Worker as /consent.js on the pages that may carry ads (worker/ads.mjs).
// Nothing from Google loads before a choice. Accept loads AdSense; Decline loads it in non-personalised mode
// (owner decision, 12 November 2026). To load nothing after Decline instead, change LOAD_AFTER_DECLINE to false.
export const CONSENT_SCRIPT = String.raw`(function () {
  "use strict";
  var KEY = "guilded_ad_consent";
  var CLIENT = "ca-pub-6948243189424271";
  var LOAD_AFTER_DECLINE = true;
  var TEXTS = { fr: {
    text: "Guilded affiche de la publicité Google pour couvrir l'hébergement. Acceptez-vous les témoins publicitaires personnalisés de Google? Refuser affiche des publicités non personnalisées; Google peut tout de même utiliser des témoins pour la mesure et la prévention de la fraude.",
    accept: "Accepter", decline: "Refuser", change: "Choix de témoins", more: "En savoir plus", label: "Publicité et témoins"
  }, en: {
    text: "Guilded shows Google ads to help pay for hosting. Do you accept Google's personalised advertising cookies? Declining still shows ads, but not personalised ones; Google may still set cookies for measurement and fraud prevention.",
    accept: "Accept", decline: "Decline", change: "Cookie choices", more: "Learn more", label: "Advertising and cookies"
  } };
  // The site's language: <html lang> (the Worker renders /fr/ and ?lang=fr pages in French, and site/language.js
  // sets it from ?lang or the remembered kc.language choice); the switch then sends a kc-language event.
  var fr = /^fr/i.test(document.documentElement.lang || "");
  var T = fr ? TEXTS.fr : TEXTS.en;
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
  // Guilded's design tokens (site/design-tokens.css); the fallbacks are the same values, for bot-rendered pages.
  css.textContent = ".gc-banner{position:fixed;left:0;right:0;bottom:0;z-index:2147483000;display:flex;flex-wrap:wrap;align-items:center;gap:8px 20px;padding:10px 20px;border:0;border-top:1px solid var(--kc-accent,#d9b66f);background:var(--kc-surface,#1a2023);color:var(--kc-text,#f3f0e8);font:14px/1.45 var(--kc-font,system-ui,sans-serif);box-shadow:0 -6px 24px rgba(0,0,0,.45)}.gc-banner p{margin:0;flex:1 1 360px}.gc-banner a{color:var(--kc-accent-hover,#e6c98e)}.gc-row{display:flex;gap:10px;flex:0 0 auto}.gc-btn{flex:0 0 auto;min-height:44px;padding:6px 22px;border:2px solid var(--kc-accent,#d9b66f);border-radius:var(--kc-radius-sm,6px);background:var(--kc-accent,#d9b66f);color:var(--kc-on-accent,#111416);font:inherit;font-weight:700;cursor:pointer}.gc-btn:hover{background:var(--kc-accent-hover,#e6c98e);border-color:var(--kc-accent-hover,#e6c98e)}.gc-btn:focus-visible,.gc-link:focus-visible{outline:3px solid var(--kc-focus,#9dc7f0);outline-offset:2px}.gc-link{min-height:44px;background:none;border:0;padding:4px 0;color:var(--kc-muted,#aab5ba);font:inherit;text-decoration:underline;cursor:pointer}";
  document.head.appendChild(css);
  var banner = null;
  function close() { if (banner && banner.parentNode) banner.parentNode.removeChild(banner); banner = null; if (document.body && document.body.style) document.body.style.paddingBottom = ""; }
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
    // The bar is fixed: keep the page bottom reachable while it is shown (also after a resize, when the text wraps).
    function room() { if (banner && document.body.style) document.body.style.paddingBottom = (banner.offsetHeight || 0) + "px"; }
    room(); if (window.addEventListener) window.addEventListener("resize", room);
  }
  var footerButton = null;
  function footerLink() {
    var b = document.createElement("button"); b.type = "button"; b.className = "gc-link"; b.textContent = T.change;
    b.addEventListener("click", show);
    var host = document.querySelector("footer") || document.body;
    var wrap = document.createElement("p"); wrap.appendChild(b); host.appendChild(wrap);
    footerButton = b;
  }
  // The page's EN/FR switch (site/language.js) changes the language without a reload: follow it.
  function relabel(language) {
    fr = language === "fr"; T = fr ? TEXTS.fr : TEXTS.en;
    if (footerButton) footerButton.textContent = T.change;
    if (banner) { close(); show(); }
  }
  function start() {
    footerLink();
    if (document.addEventListener) document.addEventListener("kc-language", function (event) { relabel(event && event.detail); });
    var saved = read();
    if (saved === "accept" || saved === "decline") apply(saved); else show();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
`;
