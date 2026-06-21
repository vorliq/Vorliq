import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

const NotificationContext = createContext(null);
const STORAGE_KEY = "vorliq_notifications";
const PREF_KEY = "vorliq_notifications_enabled";

function loadNotifications() {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch (error) {
    return [];
  }
}

function saveNotifications(notifications) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications));
}

function loadEnabled() {
  try {
    return window.localStorage.getItem(PREF_KEY) !== "false";
  } catch (error) {
    return true;
  }
}

export function NotificationProvider({ children }) {
  const [notifications, setNotifications] = useState(loadNotifications);
  const [notificationsEnabled, setEnabledState] = useState(loadEnabled);
  // A ref keeps addNotification stable while still respecting the live preference.
  const enabledRef = useRef(notificationsEnabled);
  useEffect(() => {
    enabledRef.current = notificationsEnabled;
  }, [notificationsEnabled]);

  const setNotificationsEnabled = useCallback((next) => {
    try {
      window.localStorage.setItem(PREF_KEY, next ? "true" : "false");
    } catch (error) {
      // ignore storage errors; the in-memory state still applies
    }
    setEnabledState(Boolean(next));
  }, []);

  const updateNotifications = useCallback((updater) => {
    setNotifications((current) => {
      const next = updater(current);
      saveNotifications(next);
      return next;
    });
  }, []);

  const addNotification = useCallback((type, title, message, link = null) => {
    // In-app notices are generated locally from public chain activity. When the
    // user turns them off, none are created.
    if (!enabledRef.current) return;
    const notification = {
      // Date.now() alone can collide for events in the same millisecond (e.g.
      // several credits in one block), so add a short random suffix.
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      title,
      message,
      link,
      timestamp: Date.now(),
      read: false,
    };

    // Keep the persisted history bounded.
    updateNotifications((current) => [notification, ...current].slice(0, 50));
  }, [updateNotifications]);

  const markAsRead = useCallback((id) => {
    updateNotifications((current) =>
      current.map((notification) =>
        notification.id === id ? { ...notification, read: true } : notification
      )
    );
  }, [updateNotifications]);

  const clearAll = useCallback(() => {
    updateNotifications(() => []);
  }, [updateNotifications]);

  const unreadCount = notifications.filter((notification) => !notification.read).length;

  const value = useMemo(
    () => ({
      notifications,
      addNotification,
      markAsRead,
      clearAll,
      unreadCount,
      notificationsEnabled,
      setNotificationsEnabled,
    }),
    [addNotification, clearAll, markAsRead, notifications, unreadCount, notificationsEnabled, setNotificationsEnabled]
  );

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error("useNotifications must be used inside NotificationProvider");
  }
  return context;
}
