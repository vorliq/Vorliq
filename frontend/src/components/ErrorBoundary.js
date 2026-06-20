import { Component } from "react";

import { sendAnalyticsEvent } from "../helpers/analytics";

// Top-level error boundary. Catches any uncaught render error from the router
// tree and shows a clean recovery screen instead of a blank white page. Styling
// is intentionally inline so the recovery screen renders even if the stylesheet
// or theme tokens are the thing that failed to load.
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
    this.handleReload = this.handleReload.bind(this);
    this.handleHome = this.handleHome.bind(this);
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // Log without exposing internals to the user. sendAnalyticsEvent is
    // fire-and-forget and never throws.
    sendAnalyticsEvent("error_boundary_seen", {
      metadata: { reason: (error && error.name) || "render_error" },
    });
    if (typeof console !== "undefined" && console.error) {
      console.error("Uncaught render error:", error, info?.componentStack);
    }
  }

  handleReload() {
    if (typeof window !== "undefined") window.location.reload();
  }

  handleHome() {
    // Hard navigation home clears the broken render tree entirely.
    if (typeof window !== "undefined") window.location.assign("/");
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        role="alert"
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1.25rem",
          padding: "2rem",
          textAlign: "center",
          background: "#06101c",
          color: "#e6f0ff",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        }}
      >
        <h1 style={{ fontSize: "1.6rem", fontWeight: 800, margin: 0 }}>Something went wrong</h1>
        <p style={{ maxWidth: "30rem", margin: 0, lineHeight: 1.5, color: "#a9bdd6" }}>
          The app hit an unexpected error and stopped this screen from loading. Your wallet and
          data are safe. You can reload to try again, or head back to the dashboard.
        </p>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", justifyContent: "center" }}>
          <button
            type="button"
            onClick={this.handleReload}
            style={{
              cursor: "pointer",
              borderRadius: "0.75rem",
              border: "none",
              padding: "0.75rem 1.5rem",
              fontWeight: 800,
              background: "#3ddc97",
              color: "#06101c",
            }}
          >
            Reload this page
          </button>
          <button
            type="button"
            onClick={this.handleHome}
            style={{
              cursor: "pointer",
              borderRadius: "0.75rem",
              border: "1px solid #2a3b52",
              padding: "0.75rem 1.5rem",
              fontWeight: 800,
              background: "transparent",
              color: "#e6f0ff",
            }}
          >
            Back to dashboard
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
