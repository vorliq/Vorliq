import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useNotifications } from "../context/NotificationContext";
import theme from "../theme";
import sharedStyles from "./sharedStyles";

function timeAgo(timestamp) {
  const seconds = Math.max(1, Math.floor((Date.now() - timestamp) / 1000));

  if (seconds < 60) return `${seconds} seconds ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minutes ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hours ago`;

  const days = Math.floor(hours / 24);
  return `${days} days ago`;
}

export default function NotificationsScreen() {
  const { notifications, markAsRead, clearAll } = useNotifications();

  return (
    <ScrollView style={sharedStyles.screen} contentContainerStyle={sharedStyles.content}>
      <View style={sharedStyles.headerRow}>
        <View>
          <Text style={sharedStyles.title}>Notifications</Text>
          <Text style={sharedStyles.subtitle}>Recent Vorliq activity from this phone.</Text>
        </View>
      </View>

      <Pressable style={[sharedStyles.button, notifications.length === 0 && styles.disabledButton]} onPress={clearAll} disabled={notifications.length === 0}>
        <Text style={sharedStyles.buttonText}>Clear All</Text>
      </Pressable>

      <View style={styles.list}>
        {notifications.length === 0 ? (
          <View style={sharedStyles.card}>
            <Text style={sharedStyles.mutedText}>No notifications yet.</Text>
          </View>
        ) : (
          notifications.map((notification) => (
            <Pressable
              key={notification.id}
              style={[sharedStyles.card, !notification.read && styles.unreadCard]}
              onPress={() => markAsRead(notification.id)}
            >
              <Text style={styles.notificationTitle}>{notification.title}</Text>
              <Text style={styles.notificationBody} selectable>{notification.body}</Text>
              <Text style={[sharedStyles.mutedText, styles.timestamp]}>{timeAgo(notification.timestamp)}</Text>
            </Pressable>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  list: {
    marginTop: theme.spacing.md,
  },
  unreadCard: {
    backgroundColor: "#242442",
  },
  notificationTitle: {
    color: theme.text,
    fontSize: theme.fonts.heading,
    fontWeight: "800",
    marginBottom: theme.spacing.xs,
  },
  notificationBody: {
    color: theme.text,
    flexShrink: 1,
    fontSize: theme.fonts.body,
    lineHeight: 24,
  },
  timestamp: {
    marginTop: theme.spacing.sm,
  },
  disabledButton: {
    opacity: 0.45,
  },
});
