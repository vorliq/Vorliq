function RiskNotice({ compact = false }) {
  return (
    <aside className={`risk-notice ${compact ? "compact" : ""}`} aria-label="Risk notice">
      <strong>Risk Notice</strong>
      <p>
        Vorliq is community savings bank software built on its own blockchain with the VLQ coin.
        VLQ has no guaranteed market value, and economic features such as mining,
        lending, peer community requests, tips, treasury proposals, and governance may change over time.
      </p>
    </aside>
  );
}

export default RiskNotice;
