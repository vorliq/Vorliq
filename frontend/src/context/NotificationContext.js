import { createContext, useCallback, useContext, useMemo, useState } from "react";

const NotificationContext = createContext(null);
const STORAGE_KEY = "vorliq_notifications";

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

export function NotificationProvider({ children }) {
  const [notifications, setNotifications] = useState(loadNotifications);

  const updateNotifications = useCallback((updater) => {
    setNotifications((current) => {
      const next = updater(current);
      saveNotifications(next);
      return next;
    });
  }, []);

  const addNotification = useCallback((type, title, message) => {
    const notification = {
      id: Date.now(),
      type,
      title,
      message,
      timestamp: Date.now(),
      read: false,
    };

    updateNotifications((current) => [notification, ...current]);
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
    }),
    [addNotification, clearAll, markAsRead, notifications, unreadCount]
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
