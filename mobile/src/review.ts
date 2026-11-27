import AsyncStorage from "@react-native-async-storage/async-storage";
import { Linking, Platform, Share } from "react-native";
import { PLAY_MARKET_URL, PLAY_URL } from "./links";

// Rate and share (phone app 0.7.0, Testers Community feedback).
// - "Rate this app" in Settings opens the Play listing: Google asks apps not to start the in-app review sheet from a button.
// - The in-app review sheet (expo-store-review: Google Play In-App Review API) is asked for once, ever, after a good moment
//   (a raid sign-up saved, or the guild refreshed) on the third session or later, and never in the first minute after launch.
//   Google decides whether the sheet actually shows; nothing happens when it does not.

const SESSIONS = "guilded.mobile.sessions.v1";
const ASKED = "guilded.mobile.review-asked.v1";
export const REVIEW_MIN_SESSIONS = 3;
export const REVIEW_MIN_AFTER_LAUNCH_MS = 60_000;

let launchedAt = 0;
let sessions = 0;

/** Counts this launch (once per app start). */
export async function countSession(now = Date.now()): Promise<number> {
  if (launchedAt) return sessions;
  launchedAt = now;
  try {
    sessions = (Number(await AsyncStorage.getItem(SESSIONS)) || 0) + 1;
    await AsyncStorage.setItem(SESSIONS, String(sessions));
  } catch { sessions = 0; }
  return sessions;
}

/** The rule, kept pure for tests: once, from the third session, never in the first minute of a launch. */
export function shouldAskReview(state: { asked: boolean; sessions: number; sinceLaunchMs: number }): boolean {
  return !state.asked && state.sessions >= REVIEW_MIN_SESSIONS && state.sinceLaunchMs >= REVIEW_MIN_AFTER_LAUNCH_MS;
}

/** A good moment happened: ask for a review if the rule allows it. Never throws. */
export async function reviewMoment(now = Date.now()): Promise<boolean> {
  if (Platform.OS === "web" || !launchedAt) return false;
  try {
    const asked = (await AsyncStorage.getItem(ASKED)) === "1";
    if (!shouldAskReview({ asked, sessions, sinceLaunchMs: now - launchedAt })) return false;
    const StoreReview = await import("expo-store-review");
    if (!await StoreReview.isAvailableAsync()) return false;
    await AsyncStorage.setItem(ASKED, "1");
    await StoreReview.requestReview();
    return true;
  } catch { return false; }
}

/** Settings > Rate this app: the Play listing (the Play Store app when installed, else the web page). */
export async function openRating(): Promise<void> {
  try { await Linking.openURL(PLAY_MARKET_URL); }
  catch { await Linking.openURL(PLAY_URL).catch(() => {}); }
}

/** Settings > Share this app: the system share sheet with the Play link. */
export async function shareApp(lang: "en" | "fr"): Promise<void> {
  const message = lang === "fr"
    ? `Guilded : les raids, classements et rappels de ta guilde WoW Forever sur ton téléphone. ${PLAY_URL}`
    : `Guilded: your WoW Forever guild's raids, leaderboards and reminders on your phone. ${PLAY_URL}`;
  await Share.share({ message, url: PLAY_URL, title: "Guilded" }).catch(() => {});
}
