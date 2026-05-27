import { useCallback, useEffect, useMemo, useState } from "react";

import api from "../helpers/api";

const ADMIN_TOKEN_KEY = "vorliq_admin_token";
const tabs = ["Overview", "Readiness", "Network Monitor", "Analytics", "Storage", "Indexes", "Migration", "Security", "Backups", "Incidents", "Reports", "Forum Moderation", "Chat Moderation", "Profiles"];

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

function Admin() {
  const [tokenInput, setTokenInput] = useState("");
  const [adminToken, setAdminToken] = useState(() => window.sessionStorage.getItem(ADMIN_TOKEN_KEY) || "");
  const [activeTab, setActiveTab] = useState("Overview");
  const [overview, setOverview] = useState(null);
  const [readiness, setReadiness] = useState(null);
  const [nodeMonitor, setNodeMonitor] = useState(null);
  const [security, setSecurity] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [storage, setStorage] = useState(null);
  const [indexes, setIndexes] = useState(null);
  const [migration, setMigration] = useState(null);
  const [backups, setBackups] = useState(null);
  const [incidents, setIncidents] = useState({ active: [], recent: [] });
  const [reports, setReports] = useState([]);
  const [forumPosts, setForumPosts] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [profileSearch, setProfileSearch] = useState("");
  const [profileResults, setProfileResults] = useState([]);
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

  const loadReadiness = useCallback(async () => {
    const response = await api.get("/admin/readiness", { headers });
    setReadiness(response.data);
  }, [headers]);

  const loadNodeMonitor = useCallback(async () => {
    const response = await api.get("/admin/nodes/monitor", { headers });
    setNodeMonitor(response.data);
  }, [headers]);

  const loadAnalytics = useCallback(async () => {
    const response = await api.get("/admin/analytics", { headers });
    setAnalytics(response.data);
  }, [headers]);

  const loadBackups = useCallback(async () => {
    const response = await api.get("/admin/backups", { headers });
    setBackups(response.data);
  }, [headers]);

  const loadStorage = useCallback(async () => {
    const response = await api.get("/admin/storage", { headers });
    setStorage(response.data);
  }, [headers]);

  const loadIndexes = useCallback(async () => {
    const response = await api.get("/admin/indexes", { headers });
    setIndexes(response.data);
  }, [headers]);

  const loadMigration = useCallback(async () => {
    const response = await api.get("/admin/migration/readiness", { headers });
    setMigration(response.data);
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

  const loadReports = useCallback(async () => {
    const response = await api.get("/admin/reports", { headers });
    setReports(response.data.reports || []);
  }, [headers]);

  const loadChatModeration = useCallback(async () => {
    const response = await api.get("/admin/moderation/chat", { headers });
    setChatMessages(response.data.messages || []);
  }, [headers]);

  const refreshCurrentTab = useCallback(async (tab = activeTab) => {
    if (!headers) return;
    setError("");
    try {
      if (tab === "Overview") await loadOverview();
      if (tab === "Readiness") await loadReadiness();
      if (tab === "Network Monitor") await loadNodeMonitor();
      if (tab === "Analytics") await loadAnalytics();
      if (tab === "Storage") await loadStorage();
      if (tab === "Indexes") await loadIndexes();
      if (tab === "Migration") await loadMigration();
      if (tab === "Security") await loadSecurity();
      if (tab === "Backups") await loadBackups();
      if (tab === "Incidents") await loadIncidents();
      if (tab === "Reports") await loadReports();
      if (tab === "Forum Moderation") await loadForumModeration();
      if (tab === "Chat Moderation") await loadChatModeration();
    } catch (requestError) {
      setError(requestError.response?.status === 401 ? "Unauthorized" : "Unable to load admin data.");
    }
  }, [activeTab, headers, loadAnalytics, loadBackups, loadChatModeration, loadForumModeration, loadIncidents, loadIndexes, loadMigration, loadNodeMonitor, loadOverview, loadReadiness, loadReports, loadSecurity, loadStorage]);

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
    setReadiness(null);
    setNodeMonitor(null);
    setSecurity(null);
    setAnalytics(null);
    setStorage(null);
    setIndexes(null);
    setMigration(null);
    setBackups(null);
    setReports([]);
    setForumPosts([]);
    setChatMessages([]);
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

  async function rebuildIndexes() {
    setStatus("Rebuilding derived indexes...");
    try {
      const response = await api.post("/admin/indexes/rebuild", {}, { headers });
      setStatus(response.data.success ? "Index rebuild completed." : "Index rebuild reported a warning.");
      await loadIndexes();
    } catch (requestError) {
      setStatus(requestError.response?.data?.message || "Index rebuild failed.");
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

  async function moderateForumItem(payload) {
    await api.post("/admin/moderation/forum/moderate", payload, { headers });
    setStatus("Forum moderation status updated.");
    await loadForumModeration();
  }

  async function updateReport(report, action) {
    await api.post(`/admin/reports/${action}`, { report_id: report.report_id, moderator_note: "Reviewed from admin dashboard." }, { headers });
    setStatus("Report status updated.");
    await loadReports();
  }

  async function hideChatMessage(message) {
    await api.post("/admin/moderation/chat/hide", { message_id: message.message_id }, { headers });
    setStatus("Chat message hidden from future history.");
    await loadChatModeration();
  }

  async function searchProfiles(event) {
    event.preventDefault();
    const query = profileSearch.trim();
    if (!query) return;
    const response = await api.get("/profiles/search", { params: { q: query, limit: 20 } });
    setProfileResults(response.data.profiles || []);
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
      {activeTab === "Readiness" && <ReadinessTab readiness={readiness} onLoad={loadReadiness} />}
      {activeTab === "Network Monitor" && <NetworkMonitorTab monitor={nodeMonitor} onLoad={loadNodeMonitor} />}
      {activeTab === "Analytics" && <AnalyticsTab analytics={analytics} onLoad={loadAnalytics} />}
      {activeTab === "Storage" && <StorageTab storage={storage} onLoad={loadStorage} />}
      {activeTab === "Indexes" && <IndexesTab indexes={indexes} onLoad={loadIndexes} onRebuild={rebuildIndexes} />}
      {activeTab === "Migration" && <MigrationTab migration={migration} onLoad={loadMigration} />}
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
      {activeTab === "Reports" && (
        <ReportsTab reports={reports} onLoad={loadReports} onUpdate={updateReport} />
      )}
      {activeTab === "Forum Moderation" && (
        <ForumModerationTab posts={forumPosts} onLoad={loadForumModeration} onUpdate={updateForumPost} onModerate={moderateForumItem} />
      )}
      {activeTab === "Chat Moderation" && (
        <ChatModerationTab messages={chatMessages} onLoad={loadChatModeration} onHide={hideChatMessage} />
      )}
      {activeTab === "Profiles" && (
        <ProfilesModerationTab search={profileSearch} setSearch={setProfileSearch} profiles={profileResults} onSearch={searchProfiles} />
      )}
    </div>
  );
}

function StorageTab({ storage, onLoad }) {
  useEffect(() => { if (!storage) onLoad(); }, [onLoad, storage]);
  if (!storage) return <div className="empty-state">Loading storage health...</div>;

  const rows = storage.files || [];
  return (
    <section className="glass-section card-pad">
      <div className="admin-card-grid">
        {[
          ["Overall status", storage.overall_status],
          ["Critical files ok", storage.critical_files_ok],
          ["Warnings", storage.warnings_count],
          ["Errors", storage.errors_count],
          ["Backup available", storage.backup_available ? "Yes" : "No"],
        ].map(([label, value]) => (
          <div className="stat-card" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className="table-wrap">
        <table className="stats-table">
          <thead><tr><th>File</th><th>Status</th><th>Valid JSON</th><th>Backup</th><th>Size</th><th>Modified</th></tr></thead>
          <tbody>
            {rows.map((file) => (
              <tr key={file.file_name}>
                <td>{file.file_name}</td>
                <td>{file.status}</td>
                <td>{file.valid_json ? "Yes" : "No"}</td>
                <td>{file.has_backup ? "Yes" : "No"}</td>
                <td>{file.size_bytes}</td>
                <td>{file.last_modified || "Not created"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function IndexesTab({ indexes, onLoad, onRebuild }) {
  useEffect(() => { if (!indexes) onLoad(); }, [indexes, onLoad]);
  const health = indexes?.index_health || indexes || {};

  return (
    <section className="glass-section card-pad">
      <p className="risk-box">
        Indexes are derived from chain.json. Rebuilding them is non-destructive and does not rewrite historical blocks.
      </p>
      {!indexes ? (
        <div className="empty-state">Loading index health...</div>
      ) : (
        <>
          <div className="admin-card-grid">
            {[
              ["Status", health.status || "unknown"],
              ["Valid", health.valid ? "Yes" : "No"],
              ["Rebuild needed", health.rebuild_needed ? "Yes" : "No"],
              ["Chain match", health.index_chain_match ? "Yes" : "No"],
              ["Chain height", health.chain_height],
              ["Built at", health.built_at || "Unavailable"],
            ].map(([label, value]) => (
              <div className="stat-card" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <div className="table-wrap">
            <table className="stats-table">
              <tbody>
                <tr><th>Schema version</th><td>{health.schema_version || "Unavailable"}</td></tr>
                <tr><th>Latest hash</th><td>{health.latest_block_hash || "Unavailable"}</td></tr>
                <tr><th>Message</th><td>{health.message || indexes.note || "Indexes are available."}</td></tr>
              </tbody>
            </table>
          </div>
          <button className="button brand-button" type="button" onClick={onRebuild}>
            Rebuild Indexes
          </button>
        </>
      )}
    </section>
  );
}

function MigrationTab({ migration, onLoad }) {
  useEffect(() => { if (!migration) onLoad(); }, [migration, onLoad]);

  return (
    <section className="glass-section card-pad">
      <p className="risk-box">
        Migration readiness is shadow rehearsal preparation only. Production remains on hardened JSON storage and no database adapter is active.
      </p>
      {!migration ? (
        <div className="empty-state">Loading migration readiness...</div>
      ) : (
        <>
          <div className="admin-card-grid">
            {[
              ["Future target", migration.future_database_target || "unknown"],
              ["Storage backend", migration.storage_backend],
              ["Database enabled", migration.database_enabled ? "Yes" : "No"],
              ["PostgreSQL active", migration.postgres_active ? "Yes" : "No"],
              ["Shadow rehearsal", migration.postgres_shadow_rehearsal_available ? "Available" : "Unavailable"],
              ["Shadow CI", migration.postgres_shadow_ci_enabled ? "Enabled" : "Disabled"],
              ["Schema files", migration.postgres_schema_present ? "Present" : "Missing"],
              ["Migration phase", migration.migration_phase || "unknown"],
              ["Migration support", String(migration.migration_supported || "unknown").replaceAll("_", " ")],
              ["Chain source", migration.chain_source_of_truth],
              ["Indexes derived", migration.indexes_derived ? "Yes" : "No"],
              ["Migration tools", migration.migration_tools_available ? "Available" : "Unavailable"],
              ["Chain height", migration.latest_chain_height],
            ].map(([label, value]) => (
              <div className="stat-card" key={label}>
                <span>{label}</span>
                <strong>{value ?? "Unavailable"}</strong>
              </div>
            ))}
          </div>
          <div className="table-wrap">
            <table className="stats-table">
              <tbody>
                <tr><th>Latest hash</th><td>{migration.latest_block_hash || "Unavailable"}</td></tr>
                <tr><th>Storage health</th><td>{migration.last_storage_health?.overall_status || "unknown"}</td></tr>
                <tr><th>Index health</th><td>{migration.last_index_health?.status || "unknown"}</td></tr>
                <tr><th>Dry-run tool</th><td>{migration.operator_metadata?.dry_run_tool || "tools/migration_dry_run.py"}</td></tr>
                <tr><th>Schema check tool</th><td>{migration.operator_metadata?.postgres_schema_check_tool || "tools/postgres_schema_check.py"}</td></tr>
                <tr><th>Import simulation tool</th><td>{migration.operator_metadata?.import_simulation_tool || "tools/simulate_postgres_import.py"}</td></tr>
                <tr><th>Shadow rehearsal tool</th><td>{migration.operator_metadata?.shadow_rehearsal_tool || "tools/run_shadow_migration_rehearsal.py"}</td></tr>
                <tr><th>Rollback required</th><td>{migration.operator_metadata?.rollback_required ? "Yes" : "No"}</td></tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
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

function ReadinessTab({ readiness, onLoad }) {
  useEffect(() => { if (!readiness) onLoad().catch(() => {}); }, [onLoad, readiness]);
  if (!readiness) return <div className="empty-state">Loading production readiness...</div>;

  const failed = (readiness.checks || []).filter((check) => check.status === "fail");
  const warnings = (readiness.checks || []).filter((check) => check.status === "warning");
  const metadata = readiness.operational_metadata || {};

  return (
    <section className="glass-section card-pad">
      <p className="risk-box">
        Admin readiness includes deeper operational metadata, but never exposes tokens, private keys, raw logs, IP addresses, raw user agents, or full server paths.
      </p>
      <div className="admin-card-grid">
        {[
          ["Overall status", readiness.overall_status],
          ["Score", `${readiness.score}/100`],
          ["Failed checks", failed.length],
          ["Warnings", warnings.length],
          ["Latest backup", metadata.latest_backup?.file_name || "None visible"],
          ["Disk free", metadata.disk ? `${metadata.disk.free_percent}%` : "Unavailable"],
        ].map(([label, value]) => (
          <div className="stat-card" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>

      <h2>Readiness Checks</h2>
      <div className="table-wrap">
        <table className="stats-table">
          <thead><tr><th>Check</th><th>Status</th><th>Severity</th><th>Message</th></tr></thead>
          <tbody>
            {(readiness.checks || []).map((check) => (
              <tr key={check.id}>
                <td>{check.name}</td>
                <td>{check.status}</td>
                <td>{check.severity}</td>
                <td>{check.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Operational Metadata</h2>
      <div className="admin-list">
        <div className="admin-row"><strong>Storage warnings</strong><span>{metadata.storage?.warnings_count ?? "Unavailable"}</span></div>
        <div className="admin-row"><strong>Storage errors</strong><span>{metadata.storage?.errors_count ?? "Unavailable"}</span></div>
        <div className="admin-row"><strong>Active incidents</strong><span>{metadata.incidents?.total ?? "Unavailable"}</span></div>
        <div className="admin-row"><strong>Registry active nodes</strong><span>{metadata.registry?.active_node_count ?? "Unavailable"}</span></div>
        <div className="admin-row"><strong>Deployment commit</strong><span>{metadata.deployment?.commit?.slice(0, 12) || "Unavailable"}</span></div>
        <div className="admin-row"><strong>Services</strong><span>{(metadata.services || []).join(", ")}</span></div>
      </div>
    </section>
  );
}

function NetworkMonitorTab({ monitor, onLoad }) {
  useEffect(() => { if (!monitor) onLoad().catch(() => {}); }, [monitor, onLoad]);
  if (!monitor) return <div className="empty-state">Loading network monitor...</div>;

  return (
    <section className="glass-section card-pad">
      <p className="risk-box">
        Network monitor alerts are safe operational signals. Ahead nodes are not automatically trusted, and stale community nodes do not create public incidents by default.
      </p>
      <div className="admin-card-grid">
        {[
          ["Overall status", monitor.overall_status || "unknown"],
          ["Trusted public node", monitor.trusted_public_node_status || "unknown"],
          ["Active nodes", monitor.active_node_count ?? 0],
          ["Synced", monitor.synced_count ?? 0],
          ["Behind", monitor.behind_count ?? 0],
          ["Ahead", monitor.ahead_count ?? 0],
          ["Forked", monitor.forked_count ?? 0],
          ["Stale", monitor.stale_count ?? 0],
          ["Unreachable", monitor.unreachable_count ?? 0],
          ["Warnings", monitor.warning_count ?? 0],
          ["Critical", monitor.critical_count ?? 0],
        ].map(([label, value]) => (
          <div className="stat-card" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <h2>Alerts</h2>
      <div className="admin-list">
        {(monitor.alerts || []).map((item) => (
          <div className="admin-row" key={`${item.code}-${item.node_url || "network"}`}>
            <strong>{item.title}</strong>
            <span>{item.severity} - {item.operator_action}</span>
          </div>
        ))}
        {!(monitor.alerts || []).length && <div className="empty-state">No network monitor alerts.</div>}
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

function ReportsTab({ reports, onLoad, onUpdate }) {
  useEffect(() => { onLoad(); }, [onLoad]);
  return (
    <section className="glass-section card-pad">
      <h2>Reports</h2>
      <p className="risk-box">Reports create a review queue only. Moderator actions are non-destructive and do not erase blockchain history.</p>
      <div className="admin-list">
        {reports.map((report) => (
          <article className="admin-moderation-card" key={report.report_id}>
            <h3>{report.reason} - {report.target_type}</h3>
            <p>{report.description || "No description provided."}</p>
            <span>{report.target_id} - {report.status} - reported by {report.reported_by || "anonymous"}</span>
            <div className="button-row">
              <button className="button secondary brand-button-secondary" type="button" onClick={() => onUpdate(report, "review")}>Mark Reviewed</button>
              <button className="button secondary brand-button-secondary" type="button" onClick={() => onUpdate(report, "dismiss")}>Dismiss</button>
              <button className="button secondary brand-button-secondary" type="button" onClick={() => onUpdate(report, "action")}>Action Taken</button>
            </div>
          </article>
        ))}
        {!reports.length && <div className="empty-state">No reports are in the queue.</div>}
      </div>
    </section>
  );
}

function ForumModerationTab({ posts, onLoad, onUpdate, onModerate }) {
  useEffect(() => { onLoad(); }, [onLoad]);
  return (
    <section className="glass-section card-pad">
      <h2>Forum Moderation</h2>
      <div className="admin-list">
        {posts.map((post) => (
          <article className="admin-moderation-card" key={post.post_id}>
            <h3>{post.title}</h3>
            <p>{post.body_preview}</p>
            <span>By {post.profile_display_name || post.author_address} - {post.moderation_status} - reports {post.report_count || 0}</span>
            <div className="button-row">
              <button className="button secondary brand-button-secondary" type="button" onClick={() => onUpdate(post, "pinned")}>
                {post.pinned ? "Unpin" : "Pin"}
              </button>
              <button className="button secondary brand-button-secondary" type="button" onClick={() => onUpdate(post, "featured")}>
                {post.featured ? "Unfeature" : "Feature"}
              </button>
              <button className="button secondary brand-button-secondary" type="button" onClick={() => onModerate({ target_type: "post", post_id: post.post_id, status: post.hidden ? "visible" : "hidden", reason: "Moderator review" })}>
                {post.hidden ? "Unhide" : "Hide"}
              </button>
              <button className="button secondary brand-button-secondary" type="button" onClick={() => onModerate({ target_type: "post", post_id: post.post_id, status: post.locked ? "visible" : "locked", reason: "Moderator review" })}>
                {post.locked ? "Unlock" : "Lock"}
              </button>
            </div>
            {(post.replies || []).length > 0 && (
              <div className="admin-list compact">
                {post.replies.map((reply) => (
                  <div className="admin-row" key={reply.reply_id}>
                    <strong>{reply.body_preview || "Reply"}</strong>
                    <span>{reply.moderation_status} - reports {reply.report_count || 0}</span>
                    <button className="button secondary small-button" type="button" onClick={() => onModerate({ target_type: "reply", post_id: post.post_id, reply_id: reply.reply_id, status: reply.moderation_status === "hidden" ? "visible" : "hidden", reason: "Moderator review" })}>
                      {reply.moderation_status === "hidden" ? "Unhide Reply" : "Hide Reply"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function ChatModerationTab({ messages, onLoad, onHide }) {
  useEffect(() => { onLoad(); }, [onLoad]);
  return (
    <section className="glass-section card-pad">
      <h2>Chat Moderation</h2>
      <p className="risk-box">Chat is public community chat. This view lists recent in-memory messages only and does not expose IP addresses or raw user agents.</p>
      <div className="admin-list">
        {messages.map((message) => (
          <div className="admin-row" key={message.message_id || message.timestamp}>
            <strong>{message.sender_address || "Unknown"}</strong>
            <span>{message.text}</span>
            {message.message_id && (
              <button className="button secondary small-button" type="button" onClick={() => onHide(message)}>Hide</button>
            )}
          </div>
        ))}
        {!messages.length && <div className="empty-state">No recent chat messages are stored in memory.</div>}
      </div>
    </section>
  );
}

function ProfilesModerationTab({ search, setSearch, profiles, onSearch }) {
  return (
    <section className="glass-section card-pad">
      <h2>Profiles</h2>
      <p className="risk-box">Admins can review public profile status and report context, but cannot fake wallet verification.</p>
      <form className="admin-form-grid" onSubmit={onSearch}>
        <input placeholder="Wallet address or display name" value={search} onChange={(event) => setSearch(event.target.value)} />
        <button className="button brand-button" type="submit">Search Profiles</button>
      </form>
      <div className="admin-list">
        {profiles.map((profile) => (
          <div className="admin-row" key={profile.wallet_address}>
            <strong>{profile.display_name || profile.wallet_address}</strong>
            <span>{profile.verified_wallet ? "Wallet Verified" : "Unverified Wallet"} - reputation {profile.reputation_score || 0}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export default Admin;
