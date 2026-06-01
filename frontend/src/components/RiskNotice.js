function RiskNotice({ compact = false }) {
  return (
    <aside className={`risk-notice ${compact ? "compact" : ""}`} aria-label="Risk notice">
      <strong>Risk Notice</strong>
      <p>
        Vorliq is experimental open-source community blockchain software. VLQ has no guaranteed
        market value, and economic features such as mining,
        lending, exchange offers, tips, treasury proposals, and governance may change over time.
      </p>
    </aside>
  );
}

export default RiskNotice;
