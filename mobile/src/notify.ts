import { Platform } from "react-native";
import Constants from "expo-constants";
import { notificationId, type PlannedReminder } from "./reminders";

export interface ReminderSync {
  supported: boolean;
  granted: boolean;
  scheduled: number;
  error?: string;
}

let revision = 0;
let queue: Promise<unknown> = Promise.resolve();

// Serialize OS mutations; a superseded enable must never run after disable/logout.
export function syncRaidReminders(enabled: boolean, reminders: PlannedReminder[], guildDiscordId = ""): Promise<ReminderSync> {
  const request = ++revision;
  const work = async (): Promise<ReminderSync> => {
    if (Platform.OS === "web") return { supported: false, granted: false, scheduled: 0 };
    try {
      const Notifications = await import("expo-notifications");
      Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }) });
      if (request !== revision) return { supported: true, granted: false, scheduled: 0 };
      if (Platform.OS === "android") await Notifications.setNotificationChannelAsync("raids", { name: "Raids", importance: Notifications.AndroidImportance.DEFAULT });
      // Keep the previous calendar if permission lookup fails. Cancellation happens only once
      // the replacement is valid, or when the owner explicitly disables reminders.
      let granted = !enabled;
      if (enabled) {
        granted = (await Notifications.getPermissionsAsync()).granted;
        if (!granted) granted = (await Notifications.requestPermissionsAsync()).granted;
      }
      if (request !== revision) return { supported: true, granted, scheduled: 0 };
      const existing = await Notifications.getAllScheduledNotificationsAsync();
      for (const item of existing.filter((item) => item.identifier.startsWith("guilded-raid-"))) await Notifications.cancelScheduledNotificationAsync(item.identifier);
      if (!enabled || !granted) return { supported: true, granted, scheduled: 0 };
      let scheduled = 0;
      for (const reminder of reminders) {
        if (request !== revision) break;
        if (Date.parse(reminder.fireAt) <= Date.now()) continue;
        await Notifications.scheduleNotificationAsync({
          identifier: notificationId(reminder.id, reminder.leadMs),
          content: { title: reminder.title, body: reminder.body, data: { type: "raid", raidId: reminder.id, guildDiscordId } },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(reminder.fireAt), channelId: "raids" }
        });
        scheduled++;
      }
      return { supported: true, granted, scheduled };
    } catch {
      return { supported: true, granted: false, scheduled: 0, error: "Notifications could not be updated. Retry or check phone settings." };
    }
  };
  const result = queue.then(work, work);
  queue = result;
  return result;
}

/** Why push could not be set up. `needsSettings` means Android will not ask again: the member must allow notifications in phone settings. */
export class PushSetupError extends Error {
  constructor(message: string, readonly needsSettings = false) { super(message); this.name = "PushSetupError"; }
}

/**
 * The Expo push token for this phone, asking for notification permission first (Android 13+ shows the POST_NOTIFICATIONS
 * prompt once the "raids" channel exists, so the channel is created before asking). Throws PushSetupError with a sentence
 * the Alerts tab shows as it is.
 */
export async function pushToken(): Promise<string> {
  if (Platform.OS === "web") throw new PushSetupError("Push alerts need an installed iPhone or Android app.");
  const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
  if (typeof projectId !== "string" || !projectId) throw new PushSetupError("Push alerts will be available when this app is linked to its Expo project. Device reminders work now.");
  const Notifications = await import("expo-notifications");
  if (Platform.OS === "android") await Notifications.setNotificationChannelAsync("raids", { name: "Raids", importance: Notifications.AndroidImportance.DEFAULT });
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.canAskAgain !== false) permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) throw new PushSetupError("Notifications are off for Guilded in phone settings. Open settings and allow them, then switch alerts on again.", permission.canAskAgain === false);
  try { return (await Notifications.getExpoPushTokenAsync({ projectId })).data; }
  catch { throw new PushSetupError("Push alerts are not set up in this build. Device reminders still work."); }
}
