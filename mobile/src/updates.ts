import { Platform } from "react-native";
import * as Updates from "expo-updates";

type LaunchUpdate = "disabled" | "current" | "downloaded" | "unavailable";
let launchUpdate: Promise<LaunchUpdate> | undefined;

/** Run once before showing interactive screens; reload only a newly fetched update. */
export function prepareLaunchUpdate(): Promise<LaunchUpdate> {
  return launchUpdate ??= boundedLaunchUpdate();
}

async function boundedLaunchUpdate(): Promise<LaunchUpdate> {
  if (__DEV__ || Platform.OS === "web" || !Updates.isEnabled) return "disabled";
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<LaunchUpdate>((resolve) => {
    timer = setTimeout(() => { expired = true; resolve("unavailable"); }, 8_000);
  });
  try {
    return await Promise.race([checkLaunchUpdate(() => expired), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function checkLaunchUpdate(expired: () => boolean): Promise<LaunchUpdate> {
  try {
    const update = await Updates.checkForUpdateAsync();
    if (expired()) return "unavailable";
    if (!update.isAvailable) return "current";
    const fetched = await Updates.fetchUpdateAsync();
    if (expired()) return "unavailable";
    if (!fetched.isNew) return "current";
    await Updates.reloadAsync();
    return "downloaded";
  } catch {
    // Offline launch keeps the embedded or most recent successful update.
    return "unavailable";
  }
}
