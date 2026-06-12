import { useState } from "react";
import { Navigate, Link, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";

import ErrorMessage from "../components/ErrorMessage";
import { useAuth } from "../context/AuthContext";
import { apiErrorMessage } from "../helpers/errors";

function Register() {
  const navigate = useNavigate();
  const { createAndSaveWallet, isLoggedIn } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [safetyConfirmed, setSafetyConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function createAccount(event) {
    event.preventDefault();

    if (!password) {
      toast.error("Choose a password for your wallet.");
      return;
    }

    if (password !== confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }

    if (!safetyConfirmed) {
      toast.error("Confirm that you understand Vorliq cannot recover your private key.");
      return;
    }

    setLoading(true);
    try {
      await createAndSaveWallet(password);
      setErrorMessage("");
      toast.success("Wallet created and saved securely.");
      navigate("/account");
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to create account.");
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  if (isLoggedIn) {
    return <Navigate to="/account" replace />;
  }

  return (
    <div className="page">
      <div className="two-column">
        <section className="hero" aria-label="Account creation introduction">
          <span className="eyebrow">Create Account</span>
          <h1>Create your Vorliq account safely.</h1>
          <p className="subtitle">
            A Vorliq account starts with an encrypted browser wallet for VLQ. The app creates the wallet through the
            existing public API and stores the encrypted backup locally in this browser.
          </p>
          <div className="stack">
            <article className="lifecycle-step">
              <h2>Native Vorliq wallets</h2>
              <p>
                Vorliq creates encrypted local wallets for its own lightweight chain, with no gas fee step or third
                party chain dependency.
              </p>
            </article>
            <article className="lifecycle-step">
              <h2>No private key paste box</h2>
              <p>
                This page never asks you to paste a private key, seed phrase, admin token, or password from another
                service.
              </p>
            </article>
          </div>
        </section>

        <section className="card card-pad stack elev-2" aria-label="Create wallet form">
          <div className="section-title">
            <div>
              <span className="eyebrow">Create Wallet</span>
              <h2>Encrypted local storage, user-controlled keys.</h2>
            </div>
          </div>
          <ErrorMessage message={errorMessage} />
          <form className="form" onSubmit={createAccount}>
            <div className="risk-box">
              <strong>Private keys stay with you</strong>
              <p>
                Vorliq cannot recover your password or private key. Keep your encrypted backup and password somewhere
                safe.
              </p>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={safetyConfirmed}
                  onChange={(event) => setSafetyConfirmed(event.target.checked)}
                />
                <span>I understand that my private key cannot be recovered by Vorliq.</span>
              </label>
            </div>

            <div className="field">
              <label htmlFor="register-password">Password</label>
              <input
                id="register-password"
                className="input"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
              />
            </div>

            <div className="field">
              <label htmlFor="register-confirm-password">Confirm password</label>
              <input
                id="register-confirm-password"
                className="input"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
              />
            </div>

            <button className="button" type="submit" disabled={loading || !safetyConfirmed}>
              {loading ? "Creating..." : "Create Account"}
            </button>
            <p className="help-text">
              Already have a wallet?{" "}
              <Link to="/login">Sign in</Link>.
            </p>
          </form>
        </section>
      </div>
    </div>
  );
}

export default Register;
