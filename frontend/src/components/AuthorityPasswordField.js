import { Link } from "react-router-dom";

function AuthorityPasswordField({ id, isLoggedIn, onChange, value }) {
  if (!isLoggedIn) {
    return (
      <div className="wallet-safety-box">
        <strong>Unlock required</strong>
        <p>Unlock your Vorliq wallet to sign this action locally.</p>
        <Link className="button secondary small-button" to="/login">Unlock Wallet</Link>
      </div>
    );
  }

  return (
    <div className="field">
      <label htmlFor={id}>Wallet Password</label>
      <input
        id={id}
        className="input"
        type="password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="current-password"
      />
      <p className="help-text">
        Used only in this browser to decrypt your saved wallet long enough to sign this action.
      </p>
    </div>
  );
}

export default AuthorityPasswordField;
