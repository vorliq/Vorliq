import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { setNotificationCenterHandler } from "../notifications";

const NotificationContext = createContext(null);

export function NotificationProvider({ children }) {
  const [notifications, setNotifications] = useState([]);

  const addNotification = ({ title, body }) => {
    setNotifications((currentNotifications) => [
      {
        id: Date.now(),
        title,
        body,
        timestamp: Date.now(),
        read: false,
      },
      ...currentNotifications,
    ]);
  };

  useEffect(() => {
    setNotificationCenterHandler(addNotification);
    return () => setNotificationCenterHandler(null);
  }, []);

  const markAsRead = (id) => {
    setNotifications((currentNotifications) =>
      currentNotifications.map((notification) =>
        notification.id === id ? { ...notification, read: true } : notification
      )
    );
  };

  const clearAll = () => {
    setNotifications([]);
  };

  const unreadCount = notifications.filter((notification) => !notification.read).length;
  const value = useMemo(
    () => ({
      notifications,
      addNotification,
      markAsRead,
      clearAll,
      unreadCount,
    }),
    [notifications, unreadCount]
  );

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications() {
  const context = useContext(NotificationContext);

  if (!context) {
    throw new Error("useNotifications must be used inside NotificationProvider.");
  }

  return context;
}
