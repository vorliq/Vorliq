import { useState } from "react";
import { Navigate, Link, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import { KeyRound, ShieldCheck } from "lucide-react";

import { Card, PageShell, Section, StatusPill } from "../components/MarketingPrimitives";
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
    <PageShell>
      <Section className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
        <div className="pt-4">
          <StatusPill>Create account</StatusPill>
          <h1 className="mt-5 text-[clamp(2.4rem,7vw,4.8rem)] font-black leading-none text-white">Create your Vorliq account safely.</h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-vorliq-muted">
            A Vorliq account starts with an encrypted browser wallet for VLQ. The app creates the wallet through the existing public API and stores the encrypted backup locally in this browser.
          </p>
          <div className="mt-8 grid gap-4">
            <SafetyItem title="No external wallets" body="Vorliq does not use external wallet connection systems, gas fees, or third party chains." />
            <SafetyItem title="No private key paste box" body="This page never asks you to paste a private key, seed phrase, admin token, or password from another service." />
          </div>
        </div>

        <Card className="p-5 md:p-7">
          <ErrorMessage message={errorMessage} />
          <form className="grid gap-5" onSubmit={createAccount}>
            <div className="flex items-center gap-3">
              <span className="grid h-12 w-12 place-items-center rounded-lg border border-vorliq-border bg-vorliq-accent/10 text-vorliq-accent">
                <KeyRound size={24} aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-2xl font-black text-white">Create wallet</h2>
                <p className="text-sm font-semibold text-vorliq-muted">Encrypted local storage, self-custody keys.</p>
              </div>
            </div>

            <div className="rounded-lg border border-vorliq-gold/40 bg-vorliq-gold/10 p-4">
              <strong className="text-white">Private keys are self-custody</strong>
              <p className="mt-2 text-sm leading-6 text-vorliq-muted">
                Vorliq cannot recover your password or private key. Keep your encrypted backup and password somewhere safe.
              </p>
              <label className="mt-4 flex items-start gap-3 text-sm font-bold text-white">
                <input
                  className="mt-1 h-5 w-5 accent-vorliq-accent"
                  type="checkbox"
                  checked={safetyConfirmed}
                  onChange={(event) => setSafetyConfirmed(event.target.checked)}
                />
                <span>I understand that my private key cannot be recovered by Vorliq.</span>
              </label>
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-black text-white" htmlFor="register-password">
                Password
              </label>
              <input
                id="register-password"
                className="min-h-12 rounded-lg border border-vorliq-border bg-[#0A0E1A] px-4 text-white outline-none transition focus:border-vorliq-accent"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
              />
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-black text-white" htmlFor="register-confirm-password">
                Confirm password
              </label>
              <input
                id="register-confirm-password"
                className="min-h-12 rounded-lg border border-vorliq-border bg-[#0A0E1A] px-4 text-white outline-none transition focus:border-vorliq-accent"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
              />
            </div>

            <button
              className="min-h-12 rounded-full bg-vorliq-accent px-5 py-3 text-sm font-black text-[#06101c] shadow-glow transition disabled:cursor-not-allowed disabled:opacity-60"
              type="submit"
              disabled={loading || !safetyConfirmed}
            >
              {loading ? "Creating..." : "Create Account"}
            </button>
            <p className="text-center text-sm font-semibold text-vorliq-muted">
              Already have a wallet?{" "}
              <Link className="font-black text-vorliq-accent" to="/login">
                Sign in
              </Link>
              .
            </p>
          </form>
        </Card>
      </Section>
    </PageShell>
  );
}

function SafetyItem({ title, body }) {
  return (
    <div className="flex items-start gap-3">
      <ShieldCheck className="mt-1 shrink-0 text-vorliq-accent" size={21} aria-hidden="true" />
      <div>
        <h2 className="text-lg font-black text-white">{title}</h2>
        <p className="mt-1 leading-7 text-vorliq-muted">{body}</p>
      </div>
    </div>
  );
}

export default Register;
