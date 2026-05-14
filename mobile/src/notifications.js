import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";

export const PUSH_TOKEN_KEY = "vorliq_push_token";
export const NOTIFICATIONS_ENABLED_KEY = "vorliq_notifications_enabled";

let notificationCenterHandler = null;

export function setNotificationCenterHandler(handler) {
  notificationCenterHandler = handler;
}

export function setNotificationHandler() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}

export async function registerForPushNotifications() {
  try {
    if (!Device.isDevice) {
      console.warn("Vorliq push notifications require a physical device.");
      return null;
    }

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Vorliq",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#6c63ff",
      });
    }

    const currentPermissions = await Notifications.getPermissionsAsync();
    let finalStatus = currentPermissions.status;

    if (finalStatus !== "granted") {
      const requestedPermissions = await Notifications.requestPermissionsAsync();
      finalStatus = requestedPermissions.status;
    }

    if (finalStatus !== "granted") {
      console.warn("Vorliq push notification permission was denied.");
      return null;
    }

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ||
      Constants.easConfig?.projectId ||
      Constants.manifest2?.extra?.eas?.projectId;
    const tokenResponse = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );

    return tokenResponse.data;
  } catch (error) {
    console.warn("Vorliq could not register for push notifications:", error.message);
    return null;
  }
}

export async function saveNotificationToken(token) {
  if (!token) {
    return;
  }

  await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
}

export async function loadNotificationToken() {
  return AsyncStorage.getItem(PUSH_TOKEN_KEY);
}

export async function saveNotificationsEnabled(enabled) {
  await AsyncStorage.setItem(NOTIFICATIONS_ENABLED_KEY, enabled ? "true" : "false");
}

export async function loadNotificationsEnabled() {
  const storedValue = await AsyncStorage.getItem(NOTIFICATIONS_ENABLED_KEY);
  return storedValue === null ? true : storedValue === "true";
}

export async function scheduleLocalNotification(title, body, delay = 0) {
  try {
    const notificationsEnabled = await loadNotificationsEnabled();

    if (!notificationsEnabled) {
      return null;
    }

    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: true,
      },
      trigger: delay > 0 ? { seconds: delay } : null,
    });

    if (notificationCenterHandler) {
      notificationCenterHandler({ title, body });
    }

    return notificationId;
  } catch (error) {
    console.warn("Vorliq could not schedule a local notification:", error.message);
    return null;
  }
}

export function addNotificationResponseListener(callback) {
  return Notifications.addNotificationResponseReceivedListener(callback);
}
