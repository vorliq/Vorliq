import { fireEvent, render, screen } from "@testing-library/react";

import PrivacyControls from "./PrivacyControls";
import { ANALYTICS_ENABLED_KEY, ANALYTICS_SESSION_KEY } from "../helpers/analytics";

beforeEach(() => {
  window.localStorage.clear();
});

test("privacy controls render and allow analytics opt-out", () => {
  window.localStorage.setItem(ANALYTICS_SESSION_KEY, "anon_existing123456");

  render(<PrivacyControls />);

  expect(screen.getByRole("heading", { name: /product analytics/i })).toBeInTheDocument();
  const toggle = screen.getByRole("checkbox", { name: /enabled/i });
  expect(toggle).toBeChecked();

  fireEvent.click(toggle);

  expect(window.localStorage.getItem(ANALYTICS_ENABLED_KEY)).toBe("false");
  expect(window.localStorage.getItem(ANALYTICS_SESSION_KEY)).toBeNull();
  expect(screen.getByText(/disabled/i)).toBeInTheDocument();
});
