import { Platform } from "react-native";
import { notificationId, type PlannedReminder } from "./reminders";

export interface ReminderSync {
  supported: boolean;
  granted: boolean;
  scheduled: number;
}

// Local notifications only. There is no push token and no server fan-out:
// the phone schedules the raids it already downloaded.
export async function syncRaidReminders(enabled: boolean, reminders: PlannedReminder[]): Promise<ReminderSync> {
  if (Platform.OS === "web") return { supported: false, granted: false, scheduled: 0 };
  try {
    const Notifications = await import("expo-notifications");
    Notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false })
    });
    const existing = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(existing
      .filter((item) => item.identifier.startsWith("guilded-raid-"))
      .map((item) => Notifications.cancelScheduledNotificationAsync(item.identifier)));
    if (!enabled || reminders.length === 0) return { supported: true, granted: true, scheduled: 0 };
    let granted = (await Notifications.getPermissionsAsync()).granted;
    if (!granted) granted = (await Notifications.requestPermissionsAsync()).granted;
    if (!granted) return { supported: true, granted: false, scheduled: 0 };
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("raids", {
        name: "Raid reminders",
        importance: Notifications.AndroidImportance.DEFAULT
      });
    }
    for (const reminder of reminders) {
      await Notifications.scheduleNotificationAsync({
        identifier: notificationId(reminder.id),
        content: { title: reminder.title, body: reminder.body },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(reminder.fireAt), channelId: "raids" }
      });
    }
    return { supported: true, granted: true, scheduled: reminders.length };
  } catch {
    return { supported: false, granted: false, scheduled: 0 };
  }
}
