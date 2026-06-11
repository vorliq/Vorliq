export const AUTHORITY_WRITES_DISABLED = true;

function AuthorityWriteNotice() {
  return (
    <aside className="risk-notice" role="status" aria-label="Authority write status">
      <strong>Authority writes temporarily unavailable</strong>
      <p>
        Governance, treasury, and lending writes are disabled until Vorliq verifies signed wallet
        authorization. Read-only records remain available.
      </p>
    </aside>
  );
}

export default AuthorityWriteNotice;
