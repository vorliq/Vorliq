import { useNotifications } from "../context/NotificationContext";

function timeAgo(timestamp) {
  const seconds = Math.max(Math.floor((Date.now() - timestamp) / 1000), 0);
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

function Notifications() {
  const { clearAll, markAsRead, notifications } = useNotifications();

  return (
    <div className="app-page notifications-page">
      <section className="page-hero">
        <span className="page-eyebrow">Updates</span>
        <h1 className="page-title">Notifications</h1>
        <p className="page-subtitle">
          Review local Vorliq app notices, wallet reminders, and status messages in one readable page.
        </p>
      </section>

      <section className="glass-section card-pad">
        <div className="section-title">
          <div>
            <span className="section-eyebrow">Inbox</span>
            <h2>Recent Notifications</h2>
          </div>
          <button className="button secondary brand-button-secondary" type="button" onClick={clearAll}>
            Clear All
          </button>
        </div>

        <div className="notification-page-list">
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
                  <span className={`notification-type ${notification.type}`}>{notification.type}</span>
                  <span>
                    <strong>{notification.title}</strong>
                    <span>{notification.message}</span>
                    <small>{timeAgo(notification.timestamp)}</small>
                  </span>
                </button>
              ))
          )}
        </div>
      </section>
    </div>
  );
}

export default Notifications;
