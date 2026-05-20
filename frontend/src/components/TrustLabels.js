import { trustLabelDescription, trustLabelsForProfile } from "../helpers/trustLabels";

function TrustLabels({ profile, compact = false }) {
  const labels = trustLabelsForProfile(profile);
  return (
    <div className={`profile-badge-row trust-labels ${compact ? "compact" : ""}`}>
      {labels.map((label) => (
        <span className={`badge trust-badge ${label === "Wallet Verified" ? "verified" : ""}`} title={trustLabelDescription(label)} key={label}>
          {label}
        </span>
      ))}
    </div>
  );
}

export default TrustLabels;
