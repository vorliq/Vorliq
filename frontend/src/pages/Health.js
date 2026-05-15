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
  const [securityStatus, setSecurityStatus] = useState(null);
  const [weeklyReport, setWeeklyReport] = useState(null);
  const [registryNodes, setRegistryNodes] = useState([]);
  const [networkHealth, setNetworkHealth] = useState([]);
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
        const deploymentRequest = api.get("/deployment");
        const securityRequest = api.get("/security/status");
        const weeklyReportRequest = api.get("/reports/weekly");
        const [diagnosticsResponse, registryResponse, deploymentResponse, securityResponse, weeklyReportResponse] = await Promise.all([
          diagnosticsRequest,
          registryRequest,
          deploymentRequest,
          securityRequest,
          weeklyReportRequest,
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
          setSecurityStatus(securityResponse.data);
          setWeeklyReport(weeklyReportResponse.data);
          setRegistryNodes(nodes);
          setNetworkHealth(nodeChecks);
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

  return (
    <main className="page">
      <section className="hero">
        <span className="eyebrow">Node Operations</span>
        <h1>Health</h1>
        <p className="subtitle">
          Monitor local node diagnostics, public registry nodes, and live network response times.
        </p>
      </section>

      <ErrorMessage message={errorMessage} />

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
    </main>
  );
}

export default Health;
