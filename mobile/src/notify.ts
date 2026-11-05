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
      if (Platform.OS === "android") await Notifications.setNotificationChannelAsync("raids", { name: "Raid reminders", importance: Notifications.AndroidImportance.DEFAULT });
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
          identifier: notificationId(reminder.id),
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

export async function pushToken(): Promise<string> {
  if (Platform.OS === "web") throw new Error("Push alerts need an installed iPhone or Android app.");
  const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
  if (typeof projectId !== "string" || !projectId) throw new Error("Push alerts will be available when this app is linked to its Expo project. Device reminders work now.");
  const Notifications = await import("expo-notifications");
  if (Platform.OS === "android") await Notifications.setNotificationChannelAsync("raids", { name: "Raid alerts", importance: Notifications.AndroidImportance.DEFAULT });
  let granted = (await Notifications.getPermissionsAsync()).granted;
  if (!granted) granted = (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) throw new Error("Notifications are off for Guilded in phone settings.");
  try { return (await Notifications.getExpoPushTokenAsync({ projectId })).data; }
  catch { throw new Error("Push alerts are not set up in this build. Device reminders still work."); }
}
