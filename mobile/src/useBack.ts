import { useEffect, useRef } from "react";
import { BackHandler } from "react-native";

/**
 * Android Back for a screen that sits on top of another (a guild page over the boards, the sign-in code over the
 * sign-in form, the second intro screen). While `active`, Back runs `onBack` instead of leaving. The layer that became
 * active last answers first; a layer that is not active does nothing and Back falls through to the one below.
 *
 * 0.7.0: when no layer is active (the home tab, nothing open), Back goes to the fallback the app sets, which asks for a
 * second press before leaving (Testers Community report: one Back closed the app).
 */
type Layer = { run: () => void };
const layers: Layer[] = [];
let fallback: (() => boolean) | null = null;
let listening = false;

/** What Back does when no layer is open. Return true to stay in the app, false to let Android close it. */
export function setBackFallback(handler: (() => boolean) | null): void {
  fallback = handler;
  listen();
}

/** The Back press, as the app handles it (exported for tests). */
export function handleBack(): boolean {
  const top = layers[layers.length - 1];
  if (top) { top.run(); return true; }
  return fallback ? fallback() : false;
}

function listen() {
  if (listening) return;
  listening = true;
  BackHandler.addEventListener("hardwareBackPress", handleBack);
}

export function useBack(active: boolean, onBack: () => void): void {
  const latest = useRef(onBack);
  latest.current = onBack;
  useEffect(() => {
    if (!active) return;
    listen();
    const layer: Layer = { run: () => latest.current() };
    layers.push(layer);
    return () => { const at = layers.indexOf(layer); if (at >= 0) layers.splice(at, 1); };
  }, [active]);
}

/**
 * "Press Back again to exit": the first press shows `notice` and keeps the app open; a second press within `windowMs`
 * leaves. Pure timing, so it can be tested; App.tsx shows the notice as an Android toast.
 */
export function doubleBackToExit(notice: () => void, windowMs = 2000, now: () => number = Date.now): () => boolean {
  let last: number | null = null;
  return () => {
    const at = now();
    if (last !== null && at - last <= windowMs) { last = null; return false; }
    last = at;
    notice();
    return true;
  };
}
