import { useEffect, useRef } from "react";

import { useNotifications } from "../context/NotificationContext";

function timeAgo(timestamp) {
  const seconds = Math.max(Math.floor((Date.now() - timestamp) / 1000), 0);
  if (seconds < 60) {
    return `${seconds} seconds ago`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  }

  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

function NotificationIcon({ type }) {
  if (type === "success") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    );
  }

  if (type === "warning") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3 2 21h20L12 3Z" />
        <path d="M12 9v5" />
        <path d="M12 17h.01" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 10v7" />
      <path d="M12 7h.01" />
    </svg>
  );
}

function NotificationPanel({ open, onClose }) {
  const panelRef = useRef(null);
  const { clearAll, markAsRead, notifications } = useNotifications();

  useEffect(() => {
    function handlePointerDown(event) {
      if (!open) {
        return;
      }

      if (event.target.closest(".notification-bell")) {
        return;
      }

      if (panelRef.current && !panelRef.current.contains(event.target)) {
        onClose();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [onClose, open]);

  return (
    <aside ref={panelRef} className={`notification-panel ${open ? "open" : ""}`}>
      <div className="notification-header">
        <div>
          <span className="eyebrow">Updates</span>
          <h2>Notifications</h2>
        </div>
        <button className="button secondary small-button" type="button" onClick={clearAll}>
          Clear All
        </button>
      </div>

      <div className="notification-list">
        {notifications.length === 0 ? (
          <div className="empty-state">No notifications yet.</div>
        ) : (
          notifications
            .slice()
            .sort((a, b) => b.timestamp - a.timestamp)
            .map((notification) => (
              <button
                className={`notification-item ${notification.read ? "" : "unread"}`}
                key={notification.id}
                type="button"
                onClick={() => markAsRead(notification.id)}
              >
                <span className={`notification-type ${notification.type}`}>
                  <NotificationIcon type={notification.type} />
                </span>
                <span>
                  <strong>{notification.title}</strong>
                  <span>{notification.message}</span>
                  <small>{timeAgo(notification.timestamp)}</small>
                </span>
              </button>
            ))
        )}
      </div>
    </aside>
  );
}

export default NotificationPanel;
