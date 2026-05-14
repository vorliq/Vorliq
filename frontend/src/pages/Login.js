import { useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";

import { useAuth } from "../context/AuthContext";
import { hasWallet } from "../helpers/storage";

function Login() {
  const navigate = useNavigate();
  const { createAndSaveWallet, isLoggedIn, login } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const walletExists = useMemo(() => hasWallet(), []);

  async function createWallet(event) {
    event.preventDefault();

    if (!password) {
      toast.error("Choose a password for your wallet.");
      return;
    }

    if (password !== confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      await createAndSaveWallet(password);
      toast.success("Wallet created and saved securely.");
      navigate("/account");
    } catch (error) {
      toast.error(error.response?.data?.error || error.message || "Unable to create wallet.");
    } finally {
      setLoading(false);
    }
  }

  async function unlockWallet(event) {
    event.preventDefault();

    if (!password) {
      toast.error("Enter your wallet password.");
      return;
    }

    setLoading(true);
    try {
      await login(password);
      toast.success("Wallet unlocked.");
      navigate("/account");
    } catch (error) {
      toast.error("incorrect password");
    } finally {
      setLoading(false);
    }
  }

  if (isLoggedIn) {
    return <Navigate to="/account" replace />;
  }

  return (
    <main className="page auth-page">
      <section className="hero">
        <span className="eyebrow">Member Access</span>
        <h1>{walletExists ? "Welcome Back" : "Create Your Vorliq Wallet"}</h1>
        <p className="subtitle">
          Your wallet is encrypted in this browser with your password. Vorliq cannot recover
          the password or private key for you.
        </p>
      </section>

      <section className="card card-pad auth-card">
        {walletExists ? (
          <form className="form" onSubmit={unlockWallet}>
            <h2>Welcome Back</h2>
            <div className="field">
              <label htmlFor="unlock-password">Password</label>
              <input
                id="unlock-password"
                className="input"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
              />
            </div>
            <button className="button" type="submit" disabled={loading}>
              {loading ? "Unlocking..." : "Unlock Wallet"}
            </button>
          </form>
        ) : (
          <form className="form" onSubmit={createWallet}>
            <h2>Create Your Vorliq Wallet</h2>
            <div className="field">
              <label htmlFor="create-password">Password</label>
              <input
                id="create-password"
                className="input"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="field">
              <label htmlFor="confirm-password">Confirm Password</label>
              <input
                id="confirm-password"
                className="input"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
              />
            </div>
            <button className="button" type="submit" disabled={loading}>
              {loading ? "Creating..." : "Create Wallet and Set Password"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}

export default Login;
