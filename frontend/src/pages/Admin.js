import { useCallback, useEffect, useMemo, useState } from "react";

import api from "../helpers/api";

const ADMIN_TOKEN_KEY = "vorliq_admin_token";
const tabs = ["Overview", "Analytics", "Security", "Backups", "Incidents", "Forum Moderation"];

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

function Admin() {
  const [tokenInput, setTokenInput] = useState("");
  const [adminToken, setAdminToken] = useState(() => window.sessionStorage.getItem(ADMIN_TOKEN_KEY) || "");
  const [activeTab, setActiveTab] = useState("Overview");
  const [overview, setOverview] = useState(null);
  const [security, setSecurity] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [backups, setBackups] = useState(null);
  const [incidents, setIncidents] = useState({ active: [], recent: [] });
  const [forumPosts, setForumPosts] = useState([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [incidentForm, setIncidentForm] = useState({
    title: "",
    message: "",
    severity: "minor",
    affected_services: "",
  });

  const headers = useMemo(() => (adminToken ? authHeader(adminToken) : null), [adminToken]);

  const loadOverview = useCallback(async (token = adminToken) => {
    const response = await api.get("/admin/overview", { headers: authHeader(token) });
    setOverview(response.data);
    return response.data;
  }, [adminToken]);

  const loadSecurity = useCallback(async () => {
    const response = await api.get("/admin/security", { headers });
    setSecurity(response.data);
  }, [headers]);

  const loadAnalytics = useCallback(async () => {
    const response = await api.get("/admin/analytics", { headers });
    setAnalytics(response.data);
  }, [headers]);

  const loadBackups = useCallback(async () => {
    const response = await api.get("/admin/backups", { headers });
    setBackups(response.data);
  }, [headers]);

  const loadIncidents = useCallback(async () => {
    const [active, recent] = await Promise.all([api.get("/incidents/active"), api.get("/incidents")]);
    setIncidents({
      active: active.data.incidents || [],
      recent: recent.data.incidents || [],
    });
  }, []);

  const loadForumModeration = useCallback(async () => {
    const response = await api.get("/admin/moderation/forum", { headers });
    setForumPosts(response.data.posts || []);
  }, [headers]);

  const refreshCurrentTab = useCallback(async (tab = activeTab) => {
    if (!headers) return;
    setError("");
    try {
      if (tab === "Overview") await loadOverview();
      if (tab === "Analytics") await loadAnalytics();
      if (tab === "Security") await loadSecurity();
      if (tab === "Backups") await loadBackups();
      if (tab === "Incidents") await loadIncidents();
      if (tab === "Forum Moderation") await loadForumModeration();
    } catch (requestError) {
      setError(requestError.response?.status === 401 ? "Unauthorized" : "Unable to load admin data.");
    }
  }, [activeTab, headers, loadAnalytics, loadBackups, loadForumModeration, loadIncidents, loadOverview, loadSecurity]);

  useEffect(() => {
    if (adminToken) {
      loadOverview(adminToken).catch((requestError) => {
        setError(requestError.response?.status === 401 ? "Unauthorized" : "Unable to load admin overview.");
      });
    }
  }, [adminToken, loadOverview]);

  async function submitToken(event) {
    event.preventDefault();
    setError("");
    setStatus("");
    try {
      await loadOverview(tokenInput);
      window.sessionStorage.setItem(ADMIN_TOKEN_KEY, tokenInput);
      setAdminToken(tokenInput);
      setTokenInput("");
    } catch (requestError) {
      setError(requestError.response?.status === 401 ? "Unauthorized" : "Unable to verify admin access.");
    }
  }

  function logout() {
    window.sessionStorage.removeItem(ADMIN_TOKEN_KEY);
    setAdminToken("");
    setOverview(null);
    setSecurity(null);
    setAnalytics(null);
    setBackups(null);
    setForumPosts([]);
  }

  async function runBackup() {
    setStatus("Running backup...");
    try {
      const response = await api.post("/admin/backups/run", {}, { headers });
      setStatus(response.data.success ? "Backup completed." : "Backup did not complete.");
      await loadBackups();
    } catch (requestError) {
      setStatus(requestError.response?.data?.message || "Backup failed.");
    }
  }

  async function verifyBackup() {
    setStatus("Verifying latest backup...");
    try {
      const response = await api.post("/admin/backups/verify", {}, { headers });
      setStatus(response.data.verification_passed ? "Latest backup verification passed." : "Backup verification failed.");
      await loadBackups();
    } catch (requestError) {
      setStatus(requestError.response?.data?.message || "Backup verification failed.");
    }
  }

  async function createIncident(event) {
    event.preventDefault();
    try {
      const affected = incidentForm.affected_services
        .split(",")
        .map((service) => service.trim())
        .filter(Boolean);
      await api.post(
        "/admin/incidents/create",
        { ...incidentForm, affected_services: affected },
        { headers }
      );
      setStatus("Incident created.");
      setIncidentForm({ title: "", message: "", severity: "minor", affected_services: "" });
      await loadIncidents();
    } catch (requestError) {
      setStatus(requestError.response?.data?.message || "Unable to create incident.");
    }
  }

  async function resolveIncident(id) {
    await api.post("/admin/incidents/resolve", { id }, { headers });
    setStatus("Incident resolved.");
    await loadIncidents();
  }

  async function updateForumPost(post, field) {
    const endpoint = field === "pinned" ? "/admin/moderation/forum/pin" : "/admin/moderation/forum/feature";
    const payload = { post_id: post.post_id, [field]: !post[field] };
    await api.post(endpoint, payload, { headers });
    setStatus(`${field === "pinned" ? "Pin" : "Feature"} status updated.`);
    await loadForumModeration();
  }

  if (!adminToken || !overview) {
    return (
      <div className="app-page admin-page">
        <section className="page-hero">
          <span className="page-eyebrow">Operator</span>
          <h1 className="page-title">Admin Access</h1>
          <p className="page-subtitle">
            Enter the server-side operator token to access protected production tools. The token is kept only in this browser session.
          </p>
        </section>
        <form className="form-card card-pad admin-access-form" onSubmit={submitToken}>
          <label htmlFor="admin-token">Admin token</label>
          <input
            id="admin-token"
            type="password"
            value={tokenInput}
            onChange={(event) => setTokenInput(event.target.value)}
            autoComplete="current-password"
            required
          />
          <button className="button brand-button" type="submit">Open Operator Dashboard</button>
          {error && <div className="risk-box">{error}</div>}
        </form>
      </div>
    );
  }

  return (
    <div className="app-page admin-page">
      <section className="page-hero">
        <span className="page-eyebrow">Operator</span>
        <h1 className="page-title">Vorliq Operator Dashboard</h1>
        <p className="page-subtitle">
          Protected production tools for monitoring, incidents, backups, security, and non-destructive forum moderation.
        </p>
        <button className="button secondary brand-button-secondary" type="button" onClick={logout}>Clear Session Token</button>
      </section>

      <div className="tabs admin-tabs">
        {tabs.map((tab) => (
          <button
            className={`tab-button ${activeTab === tab ? "active" : ""}`}
            type="button"
            key={tab}
            onClick={() => {
              setActiveTab(tab);
              refreshCurrentTab(tab);
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {error && <div className="risk-box">{error}</div>}
      {status && <div className="empty-state">{status}</div>}

      {activeTab === "Overview" && <OverviewTab overview={overview} />}
      {activeTab === "Analytics" && <AnalyticsTab analytics={analytics} onLoad={loadAnalytics} />}
      {activeTab === "Security" && <SecurityTab security={security} onLoad={loadSecurity} />}
      {activeTab === "Backups" && <BackupsTab backups={backups} onLoad={loadBackups} onRun={runBackup} onVerify={verifyBackup} />}
      {activeTab === "Incidents" && (
        <IncidentsTab
          incidents={incidents}
          form={incidentForm}
          setForm={setIncidentForm}
          onLoad={loadIncidents}
          onCreate={createIncident}
          onResolve={resolveIncident}
        />
      )}
      {activeTab === "Forum Moderation" && (
        <ForumModerationTab posts={forumPosts} onLoad={loadForumModeration} onUpdate={updateForumPost} />
      )}
    </div>
  );
}

function AnalyticsTab({ analytics, onLoad }) {
  useEffect(() => { if (!analytics) onLoad(); }, [analytics, onLoad]);
  if (!analytics) return <div className="empty-state">Loading analytics aggregates...</div>;

  const cards = [
    ["Onboarding completions", analytics.onboarding_completion_count],
    ["Error events", analytics.error_events],
    ["Opt-out count", analytics.analytics_opt_out_count],
    ["Retention", `${analytics.retention_days} days`],
  ];

  return (
    <section className="glass-section card-pad">
      <p className="risk-box">{analytics.note}</p>
      <div className="admin-card-grid">
        {cards.map(([label, value]) => (
          <div className="stat-card" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <h2>Top Routes</h2>
      <div className="admin-list">
        {(analytics.top_routes || []).map((row) => (
          <div className="admin-row" key={row.name}><strong>{row.name}</strong><span>{row.count}</span></div>
        ))}
      </div>
      <h2>Feature Usage</h2>
      <div className="admin-list">
        {(analytics.feature_usage || []).map((row) => (
          <div className="admin-row" key={row.name}><strong>{row.name}</strong><span>{row.count}</span></div>
        ))}
      </div>
      <h2>Last 30 Days</h2>
      <div className="table-wrap">
        <table className="stats-table">
          <thead><tr><th>Date</th><th>Events</th><th>Page views</th><th>Anonymous sessions</th></tr></thead>
          <tbody>
            {(analytics.daily_counts || []).map((row) => (
              <tr key={row.date}><td>{row.date}</td><td>{row.events}</td><td>{row.page_views}</td><td>{row.unique_anonymous_sessions}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function OverviewTab({ overview }) {
  const cards = [
    ["Block height", overview.blockchain?.height],
    ["Chain valid", overview.blockchain?.chain_valid ? "Valid" : "Check"],
    ["Pending tx", overview.blockchain?.pending_transaction_count],
    ["Mining reward", `${overview.blockchain?.current_mining_reward || 0} VLQ`],
    ["Difficulty", overview.blockchain?.current_difficulty],
    ["Treasury", `${overview.treasury?.balance || 0} VLQ`],
    ["Active incidents", overview.incidents?.active_count],
    ["Latest backup", overview.backups?.latest_backup?.file_name || "None"],
    ["Server uptime", `${overview.server_uptime_seconds || 0}s`],
    ["Commit", overview.deployment?.commit_hash?.slice(0, 12) || "Unknown"],
  ];
  return (
    <section className="glass-section card-pad">
      <div className="admin-card-grid">
        {cards.map(([label, value]) => (
          <div className="stat-card" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <h2>Service Status</h2>
      <div className="admin-list">
        {Object.entries(overview.services || {}).map(([service, state]) => (
          <div className="admin-row" key={service}><strong>{service}</strong><span>{state}</span></div>
        ))}
      </div>
    </section>
  );
}

function SecurityTab({ security, onLoad }) {
  useEffect(() => { if (!security) onLoad(); }, [onLoad, security]);
  if (!security) return <div className="empty-state">Loading security status...</div>;
  return (
    <section className="glass-section card-pad">
      <p className="risk-box">{security.note}</p>
      <div className="admin-list">
        {[
          ["Rate limiting", security.rate_limiting_enabled],
          ["CORS mode", security.cors_mode],
          ["Helmet", security.helmet_enabled],
          ["CSP", security.csp_enabled],
          ["System address protection", security.public_write_routes_protected_from_system_addresses],
          ["Incident writes protected", security.incident_write_routes_protected],
          ["Admin routes protected", security.admin_routes_protected],
        ].map(([label, value]) => (
          <div className="admin-row" key={label}><strong>{label}</strong><span>{String(value)}</span></div>
        ))}
      </div>
    </section>
  );
}

function BackupsTab({ backups, onLoad, onRun, onVerify }) {
  useEffect(() => { if (!backups) onLoad(); }, [backups, onLoad]);
  return (
    <section className="glass-section card-pad">
      <div className="button-row">
        <button className="button brand-button" type="button" onClick={onRun}>Run Backup Now</button>
        <button className="button secondary brand-button-secondary" type="button" onClick={onVerify}>Verify Latest Backup</button>
      </div>
      <div className="table-wrap">
        <table className="stats-table">
          <thead><tr><th>Archive</th><th>Size</th><th>Created</th></tr></thead>
          <tbody>
            {(backups?.backups || []).map((backup) => (
              <tr key={backup.file_name}><td>{backup.file_name}</td><td>{backup.size_mb} MB</td><td>{backup.created_time}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function IncidentsTab({ incidents, form, setForm, onLoad, onCreate, onResolve }) {
  useEffect(() => { onLoad(); }, [onLoad]);
  return (
    <section className="glass-section card-pad">
      <form className="admin-form-grid" onSubmit={onCreate}>
        <input placeholder="Incident title" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required />
        <select value={form.severity} onChange={(event) => setForm({ ...form, severity: event.target.value })}>
          <option value="minor">Minor</option>
          <option value="major">Major</option>
          <option value="critical">Critical</option>
        </select>
        <input placeholder="Affected services, comma separated" value={form.affected_services} onChange={(event) => setForm({ ...form, affected_services: event.target.value })} />
        <textarea placeholder="Message" value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} required />
        <button className="button brand-button" type="submit">Create Incident</button>
      </form>
      <h2>Active Incidents</h2>
      <div className="admin-list">
        {incidents.active.map((incident) => (
          <div className="admin-row" key={incident.id}>
            <strong>{incident.title}</strong>
            <span>{incident.severity}</span>
            <button className="button secondary small-button" type="button" onClick={() => onResolve(incident.id)}>Resolve</button>
          </div>
        ))}
      </div>
    </section>
  );
}

function ForumModerationTab({ posts, onLoad, onUpdate }) {
  useEffect(() => { onLoad(); }, [onLoad]);
  return (
    <section className="glass-section card-pad">
      <div className="admin-list">
        {posts.map((post) => (
          <article className="admin-moderation-card" key={post.post_id}>
            <h3>{post.title}</h3>
            <p>{post.body_preview}</p>
            <span>By {post.profile_display_name || post.author_address}</span>
            <div className="button-row">
              <button className="button secondary brand-button-secondary" type="button" onClick={() => onUpdate(post, "pinned")}>
                {post.pinned ? "Unpin" : "Pin"}
              </button>
              <button className="button secondary brand-button-secondary" type="button" onClick={() => onUpdate(post, "featured")}>
                {post.featured ? "Unfeature" : "Feature"}
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export default Admin;
