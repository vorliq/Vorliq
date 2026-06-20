// Faucet page inside the new app shell (/preview/app/faucet). Carries forward
// the existing faucet APIs exactly:
//   - GET  /faucet/summary           starter amount, treasury balance, counts
//   - GET  /faucet/claims?address    this wallet's claims (for the cooldown)
//   - POST /faucet/claim             { wallet_address }
// The faucet sends a small starter amount from the community treasury when funds
// are available; it never mints VLQ, and the claim must be mined to confirm.
// Cooldown is one claim per wallet every 24h (faucet.py WALLET_COOLDOWN_SECONDS);
// we derive the next-available time from the wallet's most recent active claim.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Droplets } from "lucide-react";

import "../../styles/vnext.css";
import logo from "../../assets/logo.png";
import AppShell from "../../components/vnext/AppShell";
import { Button, Card, InlineError } from "../../components/vnext/primitives";
import { useAuth } from "../../context/AuthContext";
import api from "../../helpers/api";
import { apiErrorMessage } from "../../helpers/errors";
import { formatHash, formatVlq } from "../../helpers/publicApi";
import { useSharedWalletBalance } from "../../context/WalletBalanceContext";

const COOLDOWN_SECONDS = 24 * 60 * 60;

function CoinDrop() {
  // Decorative CSS coin-drop; honours prefers-reduced-motion via the stylesheet.
  return (
    <div className="vn-coindrop" aria-hidden="true">
      <span style={{ left: "20%", animationDelay: "0s" }} />
      <span style={{ left: "50%", animationDelay: "0.7s" }} />
      <span style={{ left: "78%", animationDelay: "1.3s" }} />
    </div>
  );
}

function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function Faucet() {
  const { isLoggedIn, wallet } = useAuth();
  const address = wallet?.address;
  const { balance, reload: reloadBalance } = useSharedWalletBalance();

  const [summary, setSummary] = useState(null);
  const [nextAvailable, setNextAvailable] = useState(null); // ms epoch or null
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [claimResult, setClaimResult] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(
    async (signal) => {
      setLoading(true);
      setError("");
      try {
        const requests = [api.get("/faucet/summary", { signal })];
        if (address) requests.push(api.get("/faucet/claims", { params: { address }, signal }));
        const [summaryRes, claimsRes] = await Promise.all(requests);
        setSummary(summaryRes.data?.summary || {});
        if (claimsRes) {
          const claims = claimsRes.data?.claims || [];
          const latestActive = claims.find((c) => c.status === "pending" || c.status === "confirmed");
          if (latestActive?.requested_at) {
            setNextAvailable((Number(latestActive.requested_at) + COOLDOWN_SECONDS) * 1000);
          } else {
            setNextAvailable(null);
          }
        }
      } catch (err) {
        if (err?.name === "CanceledError" || err?.code === "ERR_CANCELED") return;
        setError(apiErrorMessage(err, "Unable to load the faucet right now."));
      } finally {
        setLoading(false);
      }
    },
    [address]
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // Tick the cooldown clock while one is active; cleared on unmount.
  const cooldownActive = nextAvailable != null && nextAvailable > now;
  useEffect(() => {
    if (!cooldownActive) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [cooldownActive]);

  async function claim() {
    if (!address) return;
    setClaiming(true);
    setError("");
    setClaimResult(null);
    try {
      const res = await api.post("/faucet/claim", { wallet_address: address });
      const claim = res.data?.claim;
      setClaimResult(claim || null);
      setNextAvailable((Math.floor(Date.now() / 1000) + COOLDOWN_SECONDS) * 1000);
      setNow(Date.now());
      reloadBalance();
    } catch (err) {
      const claim = err.response?.data?.claim;
      if (claim) setClaimResult(claim);
      // Refresh the cooldown/summary FIRST — load() clears the error banner on
      // entry, so setting the failure message before it would be wiped out
      // immediately, which is why a refused claim used to show nothing.
      await load();
      setError(apiErrorMessage(err, "Unable to submit faucet claim."));
    } finally {
      setClaiming(false);
    }
  }

  const starter = summary?.starter_amount ?? 1;
  const treasury = summary?.treasury_balance;
  // A refused claim is most often the treasury floor: the faucet only sends a
  // starter amount while the community treasury holds enough to cover it, and
  // the treasury refills as members mine blocks. Detect that case so the page
  // can explain what happened and what to do instead of showing a bare error.
  const treasuryTooLow =
    claimResult?.status === "treasury_empty" || /treasury/i.test(error || "");

  return (
    <AppShell active="faucet">
      <div className="vn-page-head">
        <h1>Faucet</h1>
      </div>

      <Card className="vn-faucet">
        <img className="vn-faucet__logo" src={logo} alt="Vorliq logo" width="88" height="88" />
        <h1>Starter VLQ Faucet</h1>
        <p>
          The faucet sends a small starter amount from the community treasury when funds are available.
          It does not mint new VLQ, and the transaction must be mined before it is confirmed.
        </p>
        <CoinDrop />

        <div className="vn-faucet__facts">
          <Card nested className="vn-faucet__fact">
            <div className="vn-faucet__fact-num">{formatVlq(starter)}</div>
            <div className="vn-faucet__fact-label">Per claim</div>
          </Card>
          <Card nested className="vn-faucet__fact">
            <div className="vn-faucet__fact-num">24h</div>
            <div className="vn-faucet__fact-label">Cooldown per wallet</div>
          </Card>
          <Card nested className="vn-faucet__fact">
            <div className="vn-faucet__fact-num">{treasury != null ? formatVlq(treasury) : "—"}</div>
            <div className="vn-faucet__fact-label">Treasury balance</div>
          </Card>
        </div>

        <p className="vn-field__hint vn-faucet__explainer">
          The cooldown means each wallet can claim once every 24 hours, so the starter pool is shared
          fairly. The treasury floor means the faucet only sends VLQ while the community treasury holds
          enough to cover a starter amount; the treasury refills as members mine blocks. If the treasury
          is below that floor your claim is refused until it refills.
        </p>

        {error && (
          treasuryTooLow ? (
            <div className="vn-error" role="status" style={{ textAlign: "left" }}>
              <span>
                The community treasury is currently below the minimum needed to send a starter amount, so
                the faucet can't dispense right now. The treasury refills as members mine blocks, so check
                back a little later. You can also receive VLQ directly from another member, or run a node
                to mine and help refill it.
              </span>
            </div>
          ) : (
            <InlineError message={error} onRetry={() => load()} />
          )
        )}

        {!isLoggedIn || !address ? (
          <div className="vn-faucet__claim">
            <Button variant="primary" size="lg" to="/login">
              Sign in to claim
            </Button>
          </div>
        ) : cooldownActive ? (
          <div className="vn-faucet__cooldown">
            <div className="vn-faucet__fact-label">You can claim again in</div>
            <div className="vn-faucet__cooldown-time">{formatCountdown(nextAvailable - now)}</div>
          </div>
        ) : (
          <div className="vn-faucet__claim">
            <Button variant="primary" size="lg" onClick={claim} disabled={claiming || loading}>
              <Droplets size={18} aria-hidden="true" /> {claiming ? "Submitting…" : `Claim ${formatVlq(starter)}`}
            </Button>
          </div>
        )}

        {claimResult && (claimResult.status === "pending" || claimResult.status === "confirmed") && (
          <div className="vn-faucet__success">
            <div className="vn-faucet__success-title">
              <CheckCircle2 size={18} aria-hidden="true" /> Starter VLQ claim submitted
            </div>
            <p style={{ margin: 0, color: "var(--vn-text-2)" }}>
              {claimResult.reason || "Your claim is pending until it is mined into a block."}
            </p>
            {claimResult.tx_id && (
              <div>
                <span className="vn-status__detail-label">Transaction</span>
                <br />
                <Link className="vn-block-link vn-mono" to={`/tx/${claimResult.tx_id}`}>
                  {formatHash(claimResult.tx_id, 10, 6)}
                </Link>
              </div>
            )}
            <div>
              <span className="vn-status__detail-label">Confirmed balance</span>
              <br />
              <strong>{balance == null ? "…" : formatVlq(balance)}</strong>
            </div>
          </div>
        )}

        <p className="vn-field__hint" style={{ marginTop: 14 }}>
          Vorliq never asks for your private key for faucet claims. Claims are limited to one per wallet
          every 24 hours.
        </p>
      </Card>
    </AppShell>
  );
}
