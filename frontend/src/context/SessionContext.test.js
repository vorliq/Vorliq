import { act, render, renderHook } from "@testing-library/react";

import { SessionProvider, useSession } from "./SessionContext";
import { useAuth } from "./AuthContext";

const mockNavigate = jest.fn();
jest.mock("react-router-dom", () => ({
  ...jest.requireActual("react-router-dom"),
  useNavigate: () => mockNavigate,
}));
jest.mock("./AuthContext", () => ({ useAuth: jest.fn() }));

const logout = jest.fn();

function wrapper({ children }) {
  return <SessionProvider>{children}</SessionProvider>;
}

beforeEach(() => {
  jest.clearAllMocks();
  window.sessionStorage.clear();
  useAuth.mockReturnValue({ isLoggedIn: true, logout });
});

test("useSession throws outside a provider", () => {
  const spy = jest.spyOn(console, "error").mockImplementation(() => {});
  expect(() => renderHook(() => useSession())).toThrow(/useSession must be used inside SessionProvider/i);
  spy.mockRestore();
});

test("a signed-in session records a start time and last-activity", () => {
  const { result } = renderHook(() => useSession(), { wrapper });
  expect(typeof result.current.sessionStartedAt).toBe("number");
  expect(typeof result.current.getLastActivity()).toBe("number");
  expect(result.current.warningActive).toBe(false);
  // The start time is persisted so a reload keeps the same session clock.
  expect(window.sessionStorage.getItem("vorliq_session_started_at")).toBe(String(result.current.sessionStartedAt));
});

test("endSession logs out and returns to the landing page", () => {
  const { result } = renderHook(() => useSession(), { wrapper });
  act(() => result.current.endSession(true));
  expect(logout).toHaveBeenCalled();
  expect(mockNavigate).toHaveBeenCalledWith("/");
});

test("after long inactivity it shows the countdown warning, then signs out", () => {
  jest.useFakeTimers();
  try {
    const { getByRole, queryByRole } = render(
      <SessionProvider>
        <div>app</div>
      </SessionProvider>
    );
    expect(queryByRole("alertdialog")).toBeNull();

    // 30 minutes idle -> the warning appears.
    act(() => jest.advanceTimersByTime(30 * 60 * 1000 + 1000));
    expect(getByRole("alertdialog")).toBeInTheDocument();

    // The one-minute countdown elapses -> auto sign-out.
    act(() => jest.advanceTimersByTime(60 * 1000 + 1000));
    expect(logout).toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

test("a signed-out session has no start time and no warning", () => {
  useAuth.mockReturnValue({ isLoggedIn: false, logout });
  const { result } = renderHook(() => useSession(), { wrapper });
  expect(result.current.sessionStartedAt).toBeNull();
  expect(result.current.warningActive).toBe(false);
});
