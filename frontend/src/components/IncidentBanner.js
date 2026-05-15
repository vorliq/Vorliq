import { useEffect, useMemo, useState } from "react";

import api from "../helpers/api";

function strongestSeverity(incidents) {
  if (incidents.some((incident) => incident.severity === "critical")) {
    return "critical";
  }
  if (incidents.some((incident) => incident.severity === "major")) {
    return "major";
  }
  return "minor";
}

function IncidentBanner() {
  const [incidents, setIncidents] = useState([]);

  useEffect(() => {
    let mounted = true;

    async function loadIncidents() {
      try {
        const response = await api.get("/incidents/active", { timeout: 5000 });
        if (mounted) {
          setIncidents(response.data.incidents || []);
        }
      } catch (error) {
        if (mounted) {
          setIncidents([]);
        }
      }
    }

    loadIncidents();
    const interval = window.setInterval(loadIncidents, 60000);
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, []);

  const primaryIncident = incidents[0];
  const severity = useMemo(() => strongestSeverity(incidents), [incidents]);

  if (!primaryIncident) {
    return null;
  }

  return (
    <div className={`incident-banner ${severity}`} role="status">
      <div>
        <strong>{primaryIncident.title}</strong>
        <span>
          {incidents.length > 1
            ? `${incidents.length} active incidents`
            : `${primaryIncident.severity} incident: ${primaryIncident.status}`}
        </span>
      </div>
      <a href="https://status.vorliq.org" target="_blank" rel="noreferrer">
        View status
      </a>
    </div>
  );
}

export default IncidentBanner;
