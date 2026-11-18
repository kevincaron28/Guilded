import AsyncStorage from "@react-native-async-storage/async-storage";

// The first-launch intro (0.4.0) is shown once. Nothing sensitive: a single flag, kept with the other app caches.
const KEY = "guilded.mobile.intro.v1";

export async function readIntroSeen(): Promise<boolean> {
  try { return (await AsyncStorage.getItem(KEY)) === "1"; } catch { return true; } // a broken store must never trap someone on the intro
}

export async function markIntroSeen(): Promise<void> {
  try { await AsyncStorage.setItem(KEY, "1"); } catch { /* it shows once more next launch */ }
}
