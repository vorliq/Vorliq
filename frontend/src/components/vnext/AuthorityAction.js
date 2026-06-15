// Inline wallet-password panel for signed authority writes (lending votes /
// requests, governance votes / proposals). The password decrypts the saved
// wallet locally to sign the action — it is never sent to the server (see
// helpers/signedAuthority.js). Manages its own password field and clears it
// after each submit.
import { useId, useState } from "react";

import { Button } from "./primitives";

export default function AuthorityAction({
  isLoggedIn = false,
  busy = false,
  submitLabel = "Sign and submit",
  note = "Your wallet password decrypts your saved wallet in this browser only to sign locally. It is never sent to the server.",
  onSubmit,
}) {
  const [password, setPassword] = useState("");
  const fieldId = useId();

  async function handleSubmit(event) {
    event.preventDefault();
    if (!password) return;
    try {
      await onSubmit(password);
    } finally {
      setPassword("");
    }
  }

  return (
    <form className="vn-auth" onSubmit={handleSubmit}>
      <div className="vn-field">
        <label htmlFor={fieldId}>Wallet password</label>
        <input
          id={fieldId}
          className="vn-input"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="To sign locally"
        />
      </div>
      <p className="vn-auth__note">{note}</p>
      <Button variant="primary" type="submit" disabled={!isLoggedIn || busy || !password}>
        {busy ? "Submitting…" : submitLabel}
      </Button>
    </form>
  );
}
