import { render, screen } from "@testing-library/react";

import Notifications from "./Notifications";
import { NotificationProvider } from "../context/NotificationContext";

beforeEach(() => {
  window.localStorage.clear();
});

test("renders the notifications inbox with an empty state", () => {
  render(
    <NotificationProvider>
      <Notifications />
    </NotificationProvider>
  );
  expect(screen.getByRole("heading", { name: /^notifications$/i })).toBeInTheDocument();
  expect(screen.getByText(/no notifications yet/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /clear all/i })).toBeInTheDocument();
});
