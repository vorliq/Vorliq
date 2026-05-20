import { useState } from "react";

import { isAnalyticsEnabled, setAnalyticsEnabled } from "../helpers/analytics";

function PrivacyControls() {
  const [analyticsEnabled, setAnalyticsEnabledState] = useState(() => isAnalyticsEnabled());

  function updateAnalyticsPreference(event) {
    const enabled = event.target.checked;
    setAnalyticsEnabled(enabled);
    setAnalyticsEnabledState(enabled);
  }

  return (
    <section className="card card-pad account-section privacy-controls">
      <div className="section-title">
        <div>
          <span className="eyebrow">Privacy Controls</span>
          <h2>Product Analytics</h2>
        </div>
        <label className="toggle-row" htmlFor="account-analytics-toggle">
          <input
            id="account-analytics-toggle"
            type="checkbox"
            checked={analyticsEnabled}
            onChange={updateAnalyticsPreference}
          />
          <span>{analyticsEnabled ? "Enabled" : "Disabled"}</span>
        </label>
      </div>
      <p className="help-text">
        Vorliq uses first-party aggregate analytics to understand which public pages and features are useful.
        It does not send private keys, wallet passwords, admin tokens, message bodies, forum post bodies, raw IP
        addresses, or raw user agents. Turning this off removes the anonymous browser session ID from this device.
      </p>
    </section>
  );
}

export default PrivacyControls;
