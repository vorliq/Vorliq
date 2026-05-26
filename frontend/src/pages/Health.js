import { useEffect, useMemo, useState } from "react";

import ErrorMessage from "../components/ErrorMessage";
import Spinner from "../components/Spinner";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";

function getPublicNodeDisplayUrl(nodeUrl) {
  if (
    typeof window !== "undefined" &&
    window.location.hostname !== "localhost" &&
    /\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(nodeUrl)
  ) {
    return window.location.origin;
  }

  return nodeUrl;
}

function Health() {
  const [diagnostics, setDiagnostics] = useState(null);
  const [deployment, setDeployment] = useState(null);
  const [versionMetadata, setVersionMetadata] = useState(null);
  const [readiness, setReadiness] = useState(null);
  const [securityStatus, setSecurityStatus] = useState(null);
  const [backupStatus, setBackupStatus] = useState(null);
  const [storageHealth, setStorageHealth] = useState(null);
  const [indexHealth, setIndexHealth] = useState(null);
  const [snapshotVerification, setSnapshotVerification] = useState(null);
  const [bootstrapStatus, setBootstrapStatus] = useState(null);
  const [migrationReadiness, setMigrationReadiness] = useState(null);
  const [activeIncidents, setActiveIncidents] = useState([]);
  const [weeklyReport, setWeeklyReport] = useState(null);
  const [nodeComparison, setNodeComparison] = useState(null);
  const [registryNodes, setRegistryNodes] = useState([]);
  const [registrySummary, setRegistrySummary] = useState(null);
  const [networkHealth, setNetworkHealth] = useState([]);
  const [miningStatus, setMiningStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadHealth() {
      setLoading(true);
      setErrorMessage("");

      try {
        const diagnosticsStart = performance.now();
        const diagnosticsRequest = api.get("/diagnostics");
        const registryRequest = api.get("/registry/nodes");
        const registrySummaryRequest = api.get("/registry/summary");
        const deploymentRequest = api.get("/deployment");
        const versionRequest = api.get("/version/metadata");
        const readinessRequest = api.get("/readiness").catch(() => ({ data: null }));
        const securityRequest = api.get("/security/status");
        const backupRequest = api.get("/backup/status");
        const storageRequest = api.get("/storage/health");
        const indexRequest = api.get("/indexes/health");
        const snapshotRequest = api.get("/snapshot/verify").catch(() => ({ data: null }));
        const bootstrapRequest = api.get("/bootstrap/status").catch(() => ({ data: null }));
        const migrationRequest = api.get("/migration/readiness");
        const incidentsRequest = api.get("/incidents/active");
        const weeklyReportRequest = api.get("/reports/weekly");
        const nodeComparisonRequest = api.get("/nodes/compare").catch(() => ({ data: null }));
        const miningRequest = api.get("/mining/status");
        const [
          diagnosticsResponse,
          registryResponse,
          registrySummaryResponse,
          deploymentResponse,
          versionResponse,
          readinessResponse,
          securityResponse,
          backupResponse,
          storageResponse,
          indexResponse,
          snapshotResponse,
          bootstrapResponse,
          migrationResponse,
          incidentsResponse,
          weeklyReportResponse,
          nodeComparisonResponse,
          miningResponse,
        ] = await Promise.all([
          diagnosticsRequest,
          registryRequest,
          registrySummaryRequest,
          deploymentRequest,
          versionRequest,
          readinessRequest,
          securityRequest,
          backupRequest,
          storageRequest,
          indexRequest,
          snapshotRequest,
          bootstrapRequest,
          migrationRequest,
          incidentsRequest,
          weeklyReportRequest,
          nodeComparisonRequest,
          miningRequest,
        ]);
        const diagnosticsResponseTime = Math.round(performance.now() - diagnosticsStart);
        const registeredNodes = registryResponse.data.nodes || [];
        const fallbackNodes = diagnosticsResponse.data?.node_url
          ? [
              {
                display_name: "Vorliq Public Node",
                node_url: diagnosticsResponse.data.node_url,
              },
            ]
          : [];
        const nodes = registeredNodes.length > 0 ? registeredNodes : fallbackNodes;
        const backendNodeIsOnline = Boolean(diagnosticsResponse.data?.success);
        const nodeChecks = nodes.map((node) => {
          const displayUrl = getPublicNodeDisplayUrl(node.node_url);

          return {
            ...node,
            node_url: displayUrl,
            online: backendNodeIsOnline,
            responseTime: backendNodeIsOnline ? diagnosticsResponseTime : null,
          };
        });

        if (mounted) {
          setDiagnostics(diagnosticsResponse.data);
          setDeployment(deploymentResponse.data);
          setVersionMetadata(versionResponse.data);
          setReadiness(readinessResponse.data);
          setSecurityStatus(securityResponse.data);
          setBackupStatus(backupResponse.data);
          setStorageHealth(storageResponse.data);
          setIndexHealth(indexResponse.data);
          setSnapshotVerification(snapshotResponse.data);
          setBootstrapStatus(bootstrapResponse.data);
          setMigrationReadiness(migrationResponse.data);
          setActiveIncidents(incidentsResponse.data.incidents || []);
          setWeeklyReport(weeklyReportResponse.data);
          setNodeComparison(nodeComparisonResponse.data);
          setRegistryNodes(nodes);
          setRegistrySummary(registrySummaryResponse.data.summary || null);
          setNetworkHealth(nodeChecks);
          setMiningStatus(miningResponse.data.status || null);
        }
      } catch (error) {
        if (mounted) {
          setErrorMessage(
            apiErrorMessage(
              error,
              "Some Vorliq services could not be reached. Check that start.bat is running."
            )
          );
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadHealth();

    return () => {
      mounted = false;
    };
  }, []);

  const diagnosticRows = useMemo(() => {
    if (!diagnostics) {
      return [];
    }

    return [
      ["Node URL", diagnostics.node_url],
      ["Current Block Height", diagnostics.block_height],
      ["Chain Valid", diagnostics.chain_valid ? "Valid" : "Invalid"],
      ["Pending Transactions", diagnostics.pending_transactions],
      ["Known Peers", diagnostics.known_peers],
      ["Active Registry Nodes", diagnostics.active_registry_nodes],
      ["Uptime", `${diagnostics.uptime_seconds} seconds`],
      ["Total VLQ in Circulation", `${diagnostics.total_vlq_in_circulation} VLQ`],
      ["Current Mining Reward", `${diagnostics.current_mining_reward} VLQ`],
      ["Last Block Hash", diagnostics.last_block_hash],
      [
        "Last Block Timestamp",
        diagnostics.last_block_timestamp
          ? new Date(diagnostics.last_block_timestamp * 1000).toLocaleString()
          : "Unavailable",
      ],
    ];
  }, [diagnostics]);

  const readinessChecks = Array.isArray(readiness?.checks) ? readiness.checks : [];

  return (
    <div className="page">
      <section className="hero">
        <span className="eyebrow">Node Operations</span>
        <h1>Health</h1>
        <p className="subtitle">
          Monitor local node diagnostics, public registry nodes, and live network response times.
        </p>
      </section>

      <ErrorMessage message={errorMessage} />

      <section className="card card-pad health-section">
        <div className="section-title">
          <h2>Node Doctor</h2>
          <span className="eyebrow">Read-only CLI</span>
        </div>
        <p className="help-text">
          Run <code>node tools/node_doctor.js --base-url http://127.0.0.1:5000 --trusted-node https://vorliq.org</code> after install or update.
        </p>
      </section>

      <section className="card card-pad health-section">
        <div className="section-title">
          <h2>Bootstrap Status</h2>
          <span className={`status-badge ${bootstrapStatus?.chain_valid ? "pass" : "warning"}`}>
            {bootstrapStatus?.success ? "available" : "unknown"}
          </span>
        </div>
        {loading ? (
          <Spinner label="Loading bootstrap status..." />
        ) : bootstrapStatus?.success ? (
          <div className="stats-grid compact-stats">
            <div className="stat-card">
              <span>Package</span>
              <strong>{bootstrapStatus.bootstrap_package_available ? "Available" : "Review"}</strong>
            </div>
            <div className="stat-card">
              <span>Snapshot verify</span>
              <strong>{bootstrapStatus.snapshot_verify_available ? "Available" : "Review"}</strong>
            </div>
            <div className="stat-card">
              <span>Audit export</span>
              <strong>{bootstrapStatus.audit_export_available ? "Available" : "Review"}</strong>
            </div>
            <div className="stat-card">
              <span>Bootstrap marker</span>
              <strong>{bootstrapStatus.last_bootstrap_marker?.has_run ? "Recorded" : "Not recorded"}</strong>
            </div>
          </div>
        ) : (
          <div className="empty-state">Bootstrap status is unavailable right now.</div>
        )}
      </section>

      <section className="card card-pad health-section">
        <h2>Local Node Diagnostics</h2>
        {loading ? (
          <Spinner label="Loading node diagnostics..." />
        ) : diagnostics ? (
          <div className="table-wrap">
            <table className="stats-table">
              <tbody>
                {diagnosticRows.map(([label, value]) => (
                  <tr key={label}>
                    <th>{label}</th>
                    <td className={label === "Chain Valid" && value === "Valid" ? "green" : ""}>
                      {value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">Diagnostics are unavailable right now.</div>
        )}
      </section>

      <section className="card card-pad health-section">
        <div className="section-title">
          <h2>Production Readiness</h2>
          <span className={`status-badge ${readiness?.overall_status || "warning"}`}>
            {readiness?.overall_status || "unknown"}
          </span>
        </div>
        {loading ? (
          <Spinner label="Loading readiness summary..." />
        ) : readiness?.success ? (
          <div className="stats-grid compact-stats">
            <div className="stat-card">
              <span>Score</span>
              <strong>{readiness.score}/100</strong>
            </div>
            <div className="stat-card">
              <span>Failed checks</span>
              <strong>{readinessChecks.filter((check) => check.status === "fail").length}</strong>
            </div>
            <div className="stat-card">
              <span>Warnings</span>
              <strong>{readinessChecks.filter((check) => check.status === "warning").length}</strong>
            </div>
            <div className="stat-card">
              <span>Checked</span>
              <strong>{readiness.checked_at ? new Date(readiness.checked_at).toLocaleTimeString() : "Unknown"}</strong>
            </div>
          </div>
        ) : (
          <div className="empty-state">Production readiness is unavailable right now.</div>
        )}
        <p className="help-text">
          <a href="/readiness">Open full readiness report</a>
        </p>
      </section>

      <section className="card card-pad health-section">
        <div className="section-title">
          <h2>Snapshot Verification</h2>
          <span className={`status-badge ${snapshotVerification?.verified ? "pass" : "warning"}`}>
            {snapshotVerification?.verified ? "verified" : "review"}
          </span>
        </div>
        {loading ? (
          <Spinner label="Loading snapshot verification..." />
        ) : snapshotVerification?.success ? (
          <div className="stats-grid compact-stats">
            <div className="stat-card">
              <span>Chain height</span>
              <strong>{snapshotVerification.snapshot?.chain_height ?? "Unknown"}</strong>
            </div>
            <div className="stat-card">
              <span>Latest block</span>
              <strong className="mono-wrap compact-stat">{snapshotVerification.snapshot?.latest_block_hash || "Unavailable"}</strong>
            </div>
            <div className="stat-card">
              <span>Checks passed</span>
              <strong>{(snapshotVerification.checks || []).filter((check) => check.passed).length}</strong>
            </div>
            <div className="stat-card">
              <span>Warnings</span>
              <strong>{snapshotVerification.warnings?.length || 0}</strong>
            </div>
            <div className="stat-card">
              <span>Snapshot archive</span>
              <strong>{readiness?.snapshot_archive_available ? "Available" : "Empty"}</strong>
            </div>
            <div className="stat-card">
              <span>Archive signature</span>
              <strong>{readiness?.snapshot_archive_signature_valid ? "Valid" : "Review"}</strong>
            </div>
            <div className="stat-card">
              <span>Bootstrap package</span>
              <strong>{readiness?.bootstrap_package_available ? "Available" : "Review"}</strong>
            </div>
          </div>
        ) : (
          <div className="empty-state">Snapshot verification is unavailable right now.</div>
        )}
        <p className="help-text">
          <a href="/snapshot">Open snapshot verification</a>
          {" · "}
          <a href="/snapshot-archive">Open snapshot archive</a>
        </p>
      </section>

      <section className="card card-pad health-section">
        <div className="section-title">
          <h2>Mining Operations</h2>
          <span className="eyebrow">Block production status</span>
        </div>
        {loading ? (
          <Spinner label="Loading mining operations..." />
        ) : miningStatus ? (
          <div className="stats-grid compact-stats">
            <div className="stat-card">
              <span>Current height</span>
              <strong>{miningStatus.current_block_height}</strong>
            </div>
            <div className="stat-card">
              <span>Can mine now</span>
              <strong>{miningStatus.can_mine_now ? "Yes" : "No"}</strong>
            </div>
            <div className="stat-card">
              <span>Next block in</span>
              <strong>{miningStatus.seconds_until_next_allowed_block}s</strong>
            </div>
            <div className="stat-card">
              <span>Difficulty</span>
              <strong>{miningStatus.current_difficulty}</strong>
            </div>
            <div className="stat-card">
              <span>Miner reward</span>
              <strong>{miningStatus.miner_reward_after_treasury} VLQ</strong>
            </div>
            <div className="stat-card">
              <span>Treasury reward</span>
              <strong>{miningStatus.treasury_reward_per_block} VLQ</strong>
            </div>
          </div>
        ) : (
          <div className="empty-state">Mining operations status is unavailable right now.</div>
        )}
      </section>

      <section className="card card-pad health-section">
        <div className="section-title">
          <h2>Network Registry Health</h2>
          <span className="eyebrow">Public node trust signals</span>
        </div>
        {loading ? (
          <Spinner label="Loading registry summary..." />
        ) : registrySummary ? (
          <div className="stats-grid compact-stats">
            <div className="stat-card">
              <span>Active nodes</span>
              <strong>{registrySummary.active_node_count}</strong>
            </div>
            <div className="stat-card">
              <span>Synced nodes</span>
              <strong>{registrySummary.synced_node_count}</strong>
            </div>
            <div className="stat-card">
              <span>Behind nodes</span>
              <strong>{registrySummary.behind_node_count}</strong>
            </div>
            <div className="stat-card">
              <span>Invalid nodes</span>
              <strong>{registrySummary.invalid_node_count}</strong>
            </div>
            <div className="stat-card">
              <span>Average reliability</span>
              <strong>{registrySummary.average_reliability_score}%</strong>
            </div>
            <div className="stat-card">
              <span>Highest chain height</span>
              <strong>{registrySummary.highest_chain_height}</strong>
            </div>
          </div>
        ) : (
          <div className="empty-state">Registry summary is unavailable right now.</div>
        )}
      </section>

      <section className="card card-pad health-section">
        <div className="section-title">
          <h2>Node Sync</h2>
          <a className="button secondary small-button" href="/nodes/compare">
            Open Node Sync
          </a>
        </div>
        {loading ? (
          <Spinner label="Loading node sync..." />
        ) : nodeComparison?.success ? (
          <div className="stats-grid compact-stats">
            <div className="stat-card">
              <span>Trusted height</span>
              <strong>{nodeComparison.trusted_chain_height ?? "unknown"}</strong>
            </div>
            <div className="stat-card">
              <span>Active nodes</span>
              <strong>{nodeComparison.active_node_count ?? 0}</strong>
            </div>
            <div className="stat-card">
              <span>Forked</span>
              <strong>{nodeComparison.summary?.forked_count ?? 0}</strong>
            </div>
            <div className="stat-card">
              <span>Ahead</span>
              <strong>{nodeComparison.summary?.ahead_count ?? 0}</strong>
            </div>
          </div>
        ) : (
          <div className="empty-state">Node sync comparison is unavailable right now.</div>
        )}
      </section>

      <section className="card card-pad health-section">
        <div className="section-title">
          <h2>Network Node Health</h2>
          <span className="eyebrow">{registryNodes.length} registered</span>
        </div>
        {loading && <Spinner label="Checking registry nodes..." />}
        {!loading && networkHealth.length === 0 && (
          <div className="empty-state">No active registry nodes are available right now.</div>
        )}
        <div className="health-list">
          {networkHealth.map((node) => (
            <div className="health-row" key={node.node_url}>
              <span className={`health-icon ${node.online ? "online" : "offline"}`}>
                {node.online ? "\u2713" : "\u00d7"}
              </span>
              <div>
                <strong>{node.display_name}</strong>
                <span>{node.node_url}</span>
              </div>
              <span>{node.online ? `${node.responseTime} ms` : "offline"}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="card card-pad health-section">
        <h2>Deployment Information</h2>
        {loading ? (
          <Spinner label="Loading deployment information..." />
        ) : deployment?.success ? (
          <div className="table-wrap">
            <table className="stats-table">
              <tbody>
                <tr>
                  <th>Current Commit</th>
                  <td>{deployment.commit_hash}</td>
                </tr>
                <tr>
                  <th>Commit Timestamp</th>
                  <td>
                    {deployment.commit_timestamp
                      ? new Date(deployment.commit_timestamp).toLocaleString()
                      : "Unavailable"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">Deployment information is unavailable right now.</div>
        )}
      </section>

      <section className="card card-pad health-section">
        <h2>Version Metadata</h2>
        {loading ? (
          <Spinner label="Loading version metadata..." />
        ) : versionMetadata?.success ? (
          <div className="table-wrap">
            <table className="stats-table">
              <tbody>
                <tr>
                  <th>Current Version</th>
                  <td>{versionMetadata.current_version}</td>
                </tr>
                <tr>
                  <th>Release Channel</th>
                  <td>{versionMetadata.release_channel}</td>
                </tr>
                <tr>
                  <th>API Version</th>
                  <td>v{versionMetadata.api_version}</td>
                </tr>
                <tr>
                  <th>Deployment Commit</th>
                  <td>{versionMetadata.deployment_commit || "Unavailable"}</td>
                </tr>
                <tr>
                  <th>Recommended Node Version</th>
                  <td>{versionMetadata.recommended_node_version}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">Version metadata is unavailable right now.</div>
        )}
      </section>

      <section className="card card-pad health-section">
        <div className="section-title">
          <h2>Storage Health</h2>
          <span className={`status-badge ${storageHealth?.overall_status || "warning"}`}>
            {storageHealth?.overall_status || "unknown"}
          </span>
        </div>
        {loading ? (
          <Spinner label="Loading storage health..." />
        ) : storageHealth?.success ? (
          <div className="stats-grid compact-stats">
            <div className="stat-card">
              <span>Critical files ok</span>
              <strong>{storageHealth.critical_files_ok}</strong>
            </div>
            <div className="stat-card">
              <span>Warnings</span>
              <strong>{storageHealth.warnings_count}</strong>
            </div>
            <div className="stat-card">
              <span>Errors</span>
              <strong>{storageHealth.errors_count}</strong>
            </div>
            <div className="stat-card">
              <span>Backup available</span>
              <strong>{storageHealth.backup_available ? "Yes" : "No"}</strong>
            </div>
            <div className="stat-card">
              <span>Latest backup</span>
              <strong>{backupStatus?.latest_backup?.file_name || "None visible"}</strong>
            </div>
          </div>
        ) : (
          <div className="empty-state">Storage health is unavailable right now.</div>
        )}
      </section>

      <section className="card card-pad health-section">
        <div className="section-title">
          <h2>Index Health</h2>
          <span className={`status-badge ${indexHealth?.status || "warning"}`}>
            {indexHealth?.status || "unknown"}
          </span>
        </div>
        {loading ? (
          <Spinner label="Loading index health..." />
        ) : indexHealth?.success ? (
          <div className="stats-grid compact-stats">
            <div className="stat-card">
              <span>Exists</span>
              <strong>{indexHealth.exists ? "Yes" : "No"}</strong>
            </div>
            <div className="stat-card">
              <span>Valid</span>
              <strong>{indexHealth.valid ? "Yes" : "No"}</strong>
            </div>
            <div className="stat-card">
              <span>Chain match</span>
              <strong>{indexHealth.index_chain_match ? "Yes" : "No"}</strong>
            </div>
            <div className="stat-card">
              <span>Rebuild needed</span>
              <strong>{indexHealth.rebuild_needed ? "Yes" : "No"}</strong>
            </div>
            <div className="stat-card">
              <span>Chain height</span>
              <strong>{indexHealth.chain_height}</strong>
            </div>
            <div className="stat-card">
              <span>Built</span>
              <strong>{indexHealth.built_at || "Unavailable"}</strong>
            </div>
          </div>
        ) : (
          <div className="empty-state">Index health is unavailable right now.</div>
        )}
      </section>

      <section className="card card-pad health-section">
        <div className="section-title">
          <h2>Migration Readiness</h2>
          <span className="status-badge pass">
            {migrationReadiness?.migration_supported?.replaceAll("_", " ") || "unknown"}
          </span>
        </div>
        {loading ? (
          <Spinner label="Loading migration readiness..." />
        ) : migrationReadiness?.success ? (
          <div className="stats-grid compact-stats">
            <div className="stat-card">
              <span>Future target</span>
              <strong>{migrationReadiness.future_database_target || "unknown"}</strong>
            </div>
            <div className="stat-card">
              <span>Storage backend</span>
              <strong>{migrationReadiness.storage_backend}</strong>
            </div>
            <div className="stat-card">
              <span>Database enabled</span>
              <strong>{migrationReadiness.database_enabled ? "Yes" : "No"}</strong>
            </div>
            <div className="stat-card">
              <span>PostgreSQL active</span>
              <strong>{migrationReadiness.postgres_active ? "Yes" : "No"}</strong>
            </div>
            <div className="stat-card">
              <span>Schema files</span>
              <strong>{migrationReadiness.postgres_schema_present ? "Present" : "Missing"}</strong>
            </div>
            <div className="stat-card">
              <span>Migration phase</span>
              <strong>{migrationReadiness.migration_phase || "unknown"}</strong>
            </div>
            <div className="stat-card">
              <span>Chain source</span>
              <strong>{migrationReadiness.chain_source_of_truth}</strong>
            </div>
            <div className="stat-card">
              <span>Indexes derived</span>
              <strong>{migrationReadiness.indexes_derived ? "Yes" : "No"}</strong>
            </div>
            <div className="stat-card">
              <span>Rollback required</span>
              <strong>{migrationReadiness.rollback_plan_required ? "Yes" : "No"}</strong>
            </div>
          </div>
        ) : (
          <div className="empty-state">Migration readiness is unavailable right now.</div>
        )}
        <p className="help-text">
          <a href="/migration-readiness">Open migration readiness</a>
        </p>
      </section>

      <section className="card card-pad health-section">
        <h2>Abuse Protection</h2>
        {loading ? (
          <Spinner label="Loading security status..." />
        ) : securityStatus?.success ? (
          <div className="table-wrap">
            <table className="stats-table">
              <tbody>
                <tr>
                  <th>Rate Limiting</th>
                  <td className={securityStatus.rate_limiting_enabled ? "green" : "warning"}>
                    {securityStatus.rate_limiting_enabled ? "Enabled" : "Disabled"}
                  </td>
                </tr>
                <tr>
                  <th>Security Headers</th>
                  <td className={securityStatus.security_headers_enabled ? "green" : "warning"}>
                    {securityStatus.security_headers_enabled ? "Enabled" : "Disabled"}
                  </td>
                </tr>
                <tr>
                  <th>Production Mode</th>
                  <td className={securityStatus.production_mode ? "green" : "warning"}>
                    {securityStatus.production_mode ? "Enabled" : "Development"}
                  </td>
                </tr>
                <tr>
                  <th>CORS</th>
                  <td>{securityStatus.cors_restricted ? "Restricted to approved origins" : "Open"}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">Security status is unavailable right now.</div>
        )}
      </section>

      <section className="card card-pad health-section">
        <h2>Incident Status</h2>
        {loading ? (
          <Spinner label="Loading incident status..." />
        ) : activeIncidents.length > 0 ? (
          <div className="incident-status-list">
            {activeIncidents.map((incident) => (
              <article className={`incident-status-card ${incident.severity}`} key={incident.id}>
                <div className="section-title">
                  <h3>{incident.title}</h3>
                  <span className={`status-badge ${incident.severity}`}>{incident.severity}</span>
                </div>
                <p>{incident.description}</p>
                <div className="incident-meta-row">
                  <span>Status: {incident.status}</span>
                  <span>
                    Updated:{" "}
                    {incident.updated_at ? new Date(incident.updated_at).toLocaleString() : "Unavailable"}
                  </span>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">All clear.</div>
        )}
        <p className="help-text incident-admin-hint">
          Incident creation and updates are available through the protected API using ADMIN_TOKEN.
        </p>
      </section>

      <section className="card card-pad health-section">
        <h2>Backup Status</h2>
        {loading ? (
          <Spinner label="Loading backup status..." />
        ) : backupStatus?.success ? (
          backupStatus.backup_directory_exists && backupStatus.latest_backup ? (
            <div className="table-wrap">
              <table className="stats-table">
                <tbody>
                  <tr>
                    <th>Status</th>
                    <td className="green">Latest backup found</td>
                  </tr>
                  <tr>
                    <th>Backup Name</th>
                    <td>{backupStatus.latest_backup.file_name}</td>
                  </tr>
                  <tr>
                    <th>Size</th>
                    <td>{backupStatus.latest_backup.size_mb} MB</td>
                  </tr>
                  <tr>
                    <th>Modified</th>
                    <td>
                      {backupStatus.latest_backup.modified_time
                        ? new Date(backupStatus.latest_backup.modified_time).toLocaleString()
                        : "Unavailable"}
                    </td>
                  </tr>
                  <tr>
                    <th>Retention</th>
                    <td>{backupStatus.retention_days || 14} days</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              No backup archive is visible yet. Check the server backup job before relying on disaster recovery.
            </div>
          )
        ) : (
          <div className="empty-state">Backup status is unavailable right now.</div>
        )}
      </section>

      <section className="card card-pad health-section">
        <h2>Weekly Community Report Preview</h2>
        {loading ? (
          <Spinner label="Generating weekly report preview..." />
        ) : weeklyReport?.success ? (
          <div className="stats-grid compact-stats">
            {Object.entries(weeklyReport.stats)
              .filter(([key]) => !["generated_at"].includes(key))
              .map(([key, value]) => (
                <div className="stat-card" key={key}>
                  <span>{key.replaceAll("_", " ")}</span>
                  <strong>{String(value)}</strong>
                </div>
              ))}
          </div>
        ) : (
          <div className="empty-state">Weekly report preview is unavailable right now.</div>
        )}
      </section>
    </div>
  );
}

export default Health;
