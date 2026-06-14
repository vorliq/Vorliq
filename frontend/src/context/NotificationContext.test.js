import { act, renderHook } from "@testing-library/react";

import { NotificationProvider, useNotifications } from "./NotificationContext";

function wrapper({ children }) {
  return <NotificationProvider>{children}</NotificationProvider>;
}

beforeEach(() => {
  window.localStorage.clear();
});

test("in-app notices are on by default and addNotification stores a notice", () => {
  const { result } = renderHook(() => useNotifications(), { wrapper });

  expect(result.current.notificationsEnabled).toBe(true);
  act(() => result.current.addNotification("info", "Received VLQ", "You received 5 VLQ."));
  expect(result.current.notifications).toHaveLength(1);
});

test("disabling in-app notices suppresses new notices and persists the choice", () => {
  const { result } = renderHook(() => useNotifications(), { wrapper });

  act(() => result.current.setNotificationsEnabled(false));
  expect(window.localStorage.getItem("vorliq_notifications_enabled")).toBe("false");

  act(() => result.current.addNotification("info", "Received VLQ", "You received 5 VLQ."));
  expect(result.current.notifications).toHaveLength(0);

  act(() => result.current.setNotificationsEnabled(true));
  act(() => result.current.addNotification("info", "Received VLQ", "You received 5 VLQ."));
  expect(result.current.notifications).toHaveLength(1);
});
