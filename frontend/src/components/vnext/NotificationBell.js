import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Bell } from "lucide-react";

import { useNotifications } from "../../context/NotificationContext";

function timeAgo(timestamp) {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// The notification bell in the authenticated shell header: a count badge that
// reflects unread notifications, and a dropdown of the last ten with a
// description, timestamp, and a link to the relevant page.
export default function NotificationBell() {
  const { notifications, unreadCount, markAsRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onDocClick(event) {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const recent = notifications.slice(0, 10);

  return (
    <div className="vn-bell" ref={ref}>
      <button
        type="button"
        className="vn-bell__btn"
        aria-label={`Notifications${unreadCount ? ` (${unreadCount} unread)` : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Bell size={20} aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="vn-bell__badge" data-testid="bell-badge">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="vn-bell__dropdown" role="menu" aria-label="Notifications">
          <div className="vn-bell__head">Notifications</div>
          {recent.length === 0 ? (
            <div className="vn-bell__empty">No notifications yet.</div>
          ) : (
            <ul className="vn-bell__list">
              {recent.map((notification) => (
                <li key={notification.id}>
                  <Link
                    to={notification.link || "/dashboard"}
                    className={`vn-bell__item ${notification.read ? "" : "is-unread"}`}
                    role="menuitem"
                    onClick={() => {
                      markAsRead(notification.id);
                      setOpen(false);
                    }}
                  >
                    <span className="vn-bell__item-title">{notification.title}</span>
                    <span className="vn-bell__item-msg">{notification.message}</span>
                    <span className="vn-bell__item-time">{timeAgo(notification.timestamp)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
