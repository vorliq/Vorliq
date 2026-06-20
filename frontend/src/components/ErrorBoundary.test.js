import { render, screen } from "@testing-library/react";

import ErrorBoundary from "./ErrorBoundary";

jest.mock("../helpers/analytics", () => ({
  sendAnalyticsEvent: jest.fn(),
}));

const { sendAnalyticsEvent } = require("../helpers/analytics");

function Boom() {
  throw new Error("render exploded");
}

describe("ErrorBoundary", () => {
  let consoleError;

  beforeEach(() => {
    jest.clearAllMocks();
    // React logs the caught error to console.error; silence it for clean output.
    consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  test("renders children when there is no error", () => {
    render(
      <ErrorBoundary>
        <p>healthy child</p>
      </ErrorBoundary>
    );
    expect(screen.getByText("healthy child")).toBeInTheDocument();
  });

  test("shows the recovery screen and logs when a child throws", () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reload this page/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /back to dashboard/i })).toBeInTheDocument();
    expect(sendAnalyticsEvent).toHaveBeenCalledWith(
      "error_boundary_seen",
      expect.objectContaining({ metadata: expect.any(Object) })
    );
  });
});
