import { Link } from "react-router-dom";

import { useAuth } from "../context/AuthContext";

function AuthorityWriteNotice() {
  const { isLoggedIn } = useAuth();

  return (
    <aside className="risk-notice authority-write-notice" role="status" aria-label="Authority write status">
      <strong>Signed wallet authorization required</strong>
      {isLoggedIn ? (
        <p>
          Vorliq signs authority actions locally with your saved wallet after password confirmation.
          Your private key and wallet password are never sent to the backend.
        </p>
      ) : (
        <p>
          Unlock your Vorliq wallet to sign this action locally. Read-only records remain available.{" "}
          <Link to="/login">Unlock wallet</Link>
        </p>
      )}
    </aside>
  );
}

export default AuthorityWriteNotice;
