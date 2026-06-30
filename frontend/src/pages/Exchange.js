import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "react-toastify";

import AddressIdentity from "../components/AddressIdentity";
import AuthorityWriteNotice from "../components/AuthorityWriteNotice";
import ErrorMessage from "../components/ErrorMessage";
import RiskNotice from "../components/RiskNotice";
import Spinner from "../components/Spinner";
import { useAuth } from "../context/AuthContext";
import { useRealtime } from "../context/RealtimeContext";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";
import { authorityErrorMessage, postSignedAuthority } from "../helpers/signedAuthority";

const initialOfferForm = {
  offerType: "buy",
  amount: "",
  price: "",
  description: "",
};

const tabs = [
  ["browse", "Browse Requests"],
  ["post", "Post Request"],
  ["mine", "My Requests"],
  ["active", "Active Coordination"],
  ["history", "Request History"],
];

function Exchange() {
  const { wallet } = useAuth();
  const { latestBlockHeight, exchangeVersion } = useRealtime();
  const [activeTab, setActiveTab] = useState("browse");
  const [offers, setOffers] = useState([]);
  const [summary, setSummary] = useState(null);
  const [myTrades, setMyTrades] = useState({ created: [], accepted: [], offers: [] });
  const [offerForm, setOfferForm] = useState(initialOfferForm);
  const [offerPassword, setOfferPassword] = useState("");
  const [acceptPasswords, setAcceptPasswords] = useState({});
  const [actionPasswords, setActionPasswords] = useState({});
  const [recordTxInputs, setRecordTxInputs] = useState({});
  const [disputeInputs, setDisputeInputs] = useState({});
  const [myAddress, setMyAddress] = useState(wallet?.address || "");
  const [typeFilter, setTypeFilter] = useState("all");
  const [searchText, setSearchText] = useState("");
  const [loadingOffers, setLoadingOffers] = useState(true);
  const [loadingMine, setLoadingMine] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionId, setActionId] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  async function loadExchange({ quiet = false } = {}) {
    try {
      const [offersResponse, summaryResponse] = await Promise.all([
        api.get("/exchange/offers", { params: { limit: 200 } }),
        api.get("/exchange/summary"),
      ]);
      setOffers(offersResponse.data.offers || []);
      setSummary(summaryResponse.data.summary || null);
      setErrorMessage("");
    } catch (error) {
      if (!quiet) {
        const message = apiErrorMessage(error, "Unable to load exchange lifecycle.");
        setErrorMessage(message);
        toast.error(message);
      }
    } finally {
      setLoadingOffers(false);
    }
  }

  async function loadMyTrades(address = myAddress) {
    if (!address.trim()) {
      toast.error("Enter your wallet address.");
      return;
    }

    setLoadingMine(true);
    try {
      const response = await api.get("/exchange/my", { params: { address: address.trim() } });
      setMyTrades({
        created: response.data.created || [],
        accepted: response.data.accepted || [],
        offers: response.data.offers || [],
      });
      setErrorMessage("");
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to load your exchange requests.");
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setLoadingMine(false);
    }
  }

  useEffect(() => {
    loadExchange();
  }, []);

  // Live updates: refetch when any coordination changes over the socket
  // (exchange:update — the other party accepted, sent VLQ, confirmed, etc.) or
  // when a new block confirms (which can move a recorded VLQ tx to confirmed).
  // The initial mount load above already runs, so this only fires on changes.
  useEffect(() => {
    if (latestBlockHeight == null && exchangeVersion === 0) return;
    loadExchange({ quiet: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exchangeVersion, latestBlockHeight]);

  useEffect(() => {
    if (wallet?.address && !myAddress) {
      setMyAddress(wallet.address);
    }
  }, [myAddress, wallet?.address]);

  const browseOffers = useMemo(() => {
    return offers
      .filter((offer) => offer.status === "open")
      .filter((offer) => typeFilter === "all" || offer.offer_type === typeFilter)
      .filter((offer) => {
        const query = searchText.trim().toLowerCase();
        if (!query) return true;
        return [offer.price, offer.description, offer.creator_address]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(query));
      });
  }, [offers, searchText, typeFilter]);

  const activeTrades = useMemo(
    () => offers.filter((offer) => ["accepted", "vlq_pending", "vlq_confirmed", "disputed"].includes(offer.status)),
    [offers]
  );

  const tradeHistory = useMemo(
    () => offers.filter((offer) => ["completed", "cancelled"].includes(offer.status)),
    [offers]
  );

  function updateOfferForm(field, value) {
    setOfferForm((current) => ({ ...current, [field]: value }));
  }

  function actionPassword(offer) {
    return actionPasswords[offer.offer_id]?.trim() || "";
  }

  function clearActionPassword(offer) {
    setActionPasswords((current) => ({ ...current, [offer.offer_id]: "" }));
  }

  async function submitOffer(event) {
    event.preventDefault();
    if (!offerForm.amount || !offerForm.price.trim() || !offerForm.description.trim()) {
      toast.error("Fill in every offer field.");
      return;
    }
    if (!offerPassword) {
      toast.error("Enter your wallet password to sign this request locally.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await postSignedAuthority({
        action: "exchange.offer",
        body: {
          offer_type: offerForm.offerType,
          amount: Number(offerForm.amount),
          price: offerForm.price.trim(),
          description: offerForm.description.trim(),
        },
        walletPassword: offerPassword,
      });
      toast.success(`Request posted: ${response.data.offer_id}`);
      setOfferForm(initialOfferForm);
      setOfferPassword("");
      setErrorMessage("");
      await loadExchange({ quiet: true });
      setActiveTab("browse");
    } catch (error) {
      const message = authorityErrorMessage(error, "Unable to post exchange request.");
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  async function acceptOffer(offer) {
    const password = acceptPasswords[offer.offer_id];
    if (!password) {
      toast.error("Enter your wallet password to accept and sign this locally.");
      return;
    }

    setActionId(`${offer.offer_id}:accept`);
    try {
      await postSignedAuthority({
        action: "exchange.accept",
        body: { offer_id: offer.offer_id },
        walletPassword: password,
      });
      toast.success("Request accepted. Record the VLQ transaction after it is sent.");
      setAcceptPasswords((current) => ({ ...current, [offer.offer_id]: "" }));
      if (wallet?.address) setMyAddress(wallet.address);
      await loadExchange({ quiet: true });
      setActiveTab("active");
    } catch (error) {
      const message = authorityErrorMessage(error, "Unable to accept this request.");
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setActionId("");
    }
  }

  async function cancelOffer(offer) {
    const password = actionPassword(offer);
    if (!password) {
      toast.error("Enter your wallet password to sign this action locally.");
      return;
    }

    await runOfferAction(offer, "cancel", () => postSignedAuthority({
      action: "exchange.cancel",
      body: { offer_id: offer.offer_id },
      walletPassword: password,
    }), "Request cancelled.");
    clearActionPassword(offer);
  }

  async function recordVlqTx(offer) {
    const password = actionPassword(offer);
    const txId = recordTxInputs[offer.offer_id]?.trim();
    if (!password || !txId) {
      toast.error("Enter the VLQ transaction ID and your wallet password.");
      return;
    }

    await runOfferAction(offer, "record", () => postSignedAuthority({
      action: "exchange.record_vlq_tx",
      body: { offer_id: offer.offer_id, tx_id: txId },
      walletPassword: password,
    }), "VLQ transaction recorded.");
    setRecordTxInputs((current) => ({ ...current, [offer.offer_id]: "" }));
    clearActionPassword(offer);
  }

  async function confirmComplete(offer) {
    const password = actionPassword(offer);
    if (!password) {
      toast.error("Enter your wallet password to sign this action locally.");
      return;
    }

    await runOfferAction(offer, "confirm", () => postSignedAuthority({
      action: "exchange.confirm_complete",
      body: { offer_id: offer.offer_id },
      walletPassword: password,
    }), "Completion confirmation recorded.");
    clearActionPassword(offer);
  }

  async function openDispute(offer) {
    const password = actionPassword(offer);
    const reason = disputeInputs[offer.offer_id]?.trim();
    if (!password || !reason) {
      toast.error("Enter a dispute reason and your wallet password.");
      return;
    }

    await runOfferAction(offer, "dispute", () => postSignedAuthority({
      action: "exchange.dispute",
      body: { offer_id: offer.offer_id, reason },
      walletPassword: password,
    }), "Coordination marked as disputed.");
    setDisputeInputs((current) => ({ ...current, [offer.offer_id]: "" }));
    clearActionPassword(offer);
  }

  async function runOfferAction(offer, action, request, successMessage) {
    setActionId(`${offer.offer_id}:${action}`);
    try {
      await request();
      toast.success(successMessage);
      setErrorMessage("");
      await loadExchange({ quiet: true });
      if (myAddress.trim()) await loadMyTrades(myAddress.trim());
    } catch (error) {
      const message = authorityErrorMessage(error, "Unable to update this request.");
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setActionId("");
    }
  }

  return (
    <div className="page">
      <section className="hero">
        <span className="eyebrow">Peer Community Requests</span>
        <h1>Community Exchange Requests</h1>
        <p className="subtitle">
          Coordinate peer community requests for VLQ, accept member coordination records, track the VLQ transaction, and confirm completion after both sides finish their off-chain agreement.
        </p>
      </section>

      <ErrorMessage message={errorMessage} />
      <RiskNotice />
      <AuthorityWriteNotice />

      <section className="card card-pad stack elev-2 feature-intro">
        <span className="eyebrow">New here?</span>
        <h2>What an exchange is, and how it differs from just sending VLQ</h2>
        <p className="feature-intro-lead">
          A plain <Link to="/send">Send</Link> moves VLQ one way, with nothing expected back, like a gift or a
          payment. An exchange is a two-sided deal: you post what you'll give and what you want in return,
          and another member takes you up on it.
        </p>
        <ul className="feature-intro-points">
          <li><strong>How is it different from Send?</strong> Send has no strings attached. An exchange is an agreement between two people, where you each do your part.</li>
          <li><strong>What can I trade?</strong> VLQ for goods, services, community help, or any terms you both agree on. You describe the deal in your own words.</li>
          <li><strong>How does it actually work?</strong> You post a request, another member accepts it, you coordinate, and you both confirm when it's done. The VLQ settles on-chain like any transfer.</li>
          <li><strong>Why use it?</strong> To put VLQ to work. Trade it for things you want, or offer something and earn VLQ, instead of only holding or sending it.</li>
        </ul>
        <div className="button-row">
          <button className="button" type="button" onClick={() => setActiveTab("post")}>Post a request</button>
          <Link className="button secondary small-button" to="/send">Just send VLQ instead</Link>
        </div>
      </section>

      <section className="card card-pad stack exchange-explainer" aria-label="How the community exchange works">
        <div className="section-title">
          <div>
            <span className="eyebrow">How it works</span>
            <h2>A community exchange, step by step</h2>
          </div>
          <span className="status-badge active" title="This page updates in real time">Live updates</span>
        </div>
        <ol className="exchange-steps">
          <li><strong>Post or accept a request.</strong> One member offers or requests VLQ in exchange for something agreed off-chain (goods, services, support). Another member accepts it.</li>
          <li><strong>Send the VLQ.</strong> Whoever is sending VLQ sends it from the Send page, then records the transaction ID here so both sides can track it.</li>
          <li><strong>Wait for confirmation.</strong> The VLQ transaction confirms on the chain automatically, so you do not need to refresh.</li>
          <li><strong>Both sides confirm completion.</strong> Once the off-chain part of the deal is done, each member confirms. If something goes wrong, either side can open a dispute or cancel an open request.</li>
        </ol>
        <div className="exchange-signing-note">
          <strong>Why Vorliq asks for your password at each step</strong>
          <p>
            Every exchange action, whether posting, accepting, recording the VLQ transaction, confirming, or
            disputing, is signed by your wallet so the network can prove it really came from you, and
            nobody can act in your name. Your password unlocks your wallet in this browser just long
            enough to sign. It never leaves your device, and Vorliq never sees it or your private key.
          </p>
        </div>
      </section>

      {summary && (
        <section className="card card-pad">
          <div className="grid stats-grid">
            <SummaryStat label="Open Requests" value={summary.open_count} />
            <SummaryStat label="Active Coordinations" value={summary.active_trades_count} />
            <SummaryStat label="Completed" value={summary.completed_count} />
            <SummaryStat label="Disputed" value={summary.disputed_count} />
          </div>
        </section>
      )}

      <nav className="tabs" aria-label="Exchange sections">
        {tabs.map(([key, label]) => (
          <button className={`tab-button ${activeTab === key ? "active" : ""}`} key={key} type="button" onClick={() => setActiveTab(key)}>
            {label}
          </button>
        ))}
      </nav>

      {activeTab === "browse" && (
        <section className="card card-pad stack">
          <div className="section-title">
            <h2>Browse Requests</h2>
            <button className="button secondary small-button" type="button" onClick={() => loadExchange()}>
              Refresh
            </button>
          </div>
          <div className="grid two-column">
            <div className="field">
              <label htmlFor="exchange-type-filter">Request type</label>
              <select id="exchange-type-filter" className="input" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
                <option value="all">all</option>
                <option value="buy">requesting VLQ</option>
                <option value="sell">offering VLQ</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="exchange-search">Search terms</label>
              <input id="exchange-search" className="input" value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="terms, description, or address" />
            </div>
          </div>
          {loadingOffers ? <Spinner label="Loading open requests..." /> : (
            <OfferGrid
              actionId={actionId}
              acceptPasswords={acceptPasswords}
              myAddress={wallet?.address || myAddress}
              offers={browseOffers}
              onAccept={acceptOffer}
              setAcceptPasswords={setAcceptPasswords}
            />
          )}
        </section>
      )}

      {activeTab === "post" && (
        <section className="card card-pad stack">
          <h2>Post Request</h2>
          <p className="help-text">
            The terms field can describe goods, services, community support, or any agreed value. Vorliq records the request and VLQ transaction, but it cannot enforce off-chain delivery.
          </p>
          <form className="form" onSubmit={submitOffer}>
            <div className="field">
              <label>Posting as</label>
              {wallet?.address ? (
                <p className="help-text"><AddressIdentity address={wallet.address} compact /> — the request is signed by, and attributed to, this wallet.</p>
              ) : (
                <p className="help-text">Your saved wallet signs this request locally. Its address is derived from your password and recorded as the creator.</p>
              )}
            </div>
            <div className="field">
              <label htmlFor="exchange-type">Request Type</label>
              <select id="exchange-type" className="input" value={offerForm.offerType} onChange={(event) => updateOfferForm("offerType", event.target.value)}>
                <option value="buy">requesting VLQ</option>
                <option value="sell">offering VLQ</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="exchange-amount">Amount of VLQ</label>
              <input id="exchange-amount" className="input" type="number" min="0.000001" step="0.000001" value={offerForm.amount} onChange={(event) => updateOfferForm("amount", event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="exchange-price">Coordination Terms</label>
              <input id="exchange-price" className="input" type="text" placeholder="goods, services, community support, or agreed terms" value={offerForm.price} onChange={(event) => updateOfferForm("price", event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="exchange-description">Description</label>
              <textarea id="exchange-description" className="textarea" value={offerForm.description} onChange={(event) => updateOfferForm("description", event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="exchange-password">Wallet password</label>
              <input id="exchange-password" className="input" type="password" autoComplete="off" placeholder="Signs this request locally" value={offerPassword} onChange={(event) => setOfferPassword(event.target.value)} />
            </div>
            <button className="button" type="submit" disabled={submitting}>
              {submitting ? "Submitting..." : "Submit Request"}
            </button>
          </form>
        </section>
      )}

      {activeTab === "mine" && (
        <section className="card card-pad stack">
          <div className="section-title">
            <h2>My Requests</h2>
            <button className="button secondary small-button" type="button" onClick={() => loadMyTrades()}>
              Refresh
            </button>
          </div>
          <form className="form inline-form" onSubmit={(event) => { event.preventDefault(); loadMyTrades(); }}>
            <input className="input" type="text" aria-label="Wallet address for My Requests search" placeholder="Wallet address" value={myAddress} onChange={(event) => setMyAddress(event.target.value)} />
            <button className="button" type="submit">Load</button>
          </form>
          {loadingMine ? <Spinner label="Loading your requests..." /> : (
            <TradeGrid
              actionId={actionId}
              actionPasswords={actionPasswords}
              disputeInputs={disputeInputs}
              myAddress={myAddress}
              offers={myTrades.offers}
              onCancel={cancelOffer}
              onConfirm={confirmComplete}
              onDispute={openDispute}
              onRecordTx={recordVlqTx}
              recordTxInputs={recordTxInputs}
              setActionPasswords={setActionPasswords}
              setDisputeInputs={setDisputeInputs}
              setRecordTxInputs={setRecordTxInputs}
            />
          )}
        </section>
      )}

      {activeTab === "active" && (
        <TradeSection
          actionId={actionId}
          actionPasswords={actionPasswords}
          disputeInputs={disputeInputs}
          empty="No active coordination records right now."
          loading={loadingOffers}
          myAddress={myAddress}
          offers={activeTrades}
          onCancel={cancelOffer}
          onConfirm={confirmComplete}
          onDispute={openDispute}
          onRecordTx={recordVlqTx}
          recordTxInputs={recordTxInputs}
          setActionPasswords={setActionPasswords}
          setDisputeInputs={setDisputeInputs}
          setRecordTxInputs={setRecordTxInputs}
          title="Active Coordination"
        />
      )}

      {activeTab === "history" && (
        <TradeSection
          empty="No completed or cancelled coordination records yet."
          loading={loadingOffers}
          myAddress={myAddress}
          offers={tradeHistory}
          title="Trade History"
        />
      )}
    </div>
  );
}

function OfferGrid({ acceptPasswords, actionId, offers, onAccept, setAcceptPasswords, myAddress = "" }) {
  if (offers.length === 0) {
    return (
      <div className="empty-state">
        No open requests right now, so this is a chance to set the terms. Post the first one from the{" "}
        <strong>Post Request</strong> tab above: offer some VLQ for something you want, or offer a skill in
        return for VLQ, and describe the deal in your own words.
      </div>
    );
  }

  return (
    <div className="exchange-grid">
      {offers.map((offer) => (
        <article className="exchange-card" key={offer.offer_id}>
          <TradeDetails offer={offer} myAddress={myAddress} />
          <div className="inline-form">
            <input
              className="input"
              type="password"
              autoComplete="off"
              aria-label="Wallet password to accept and sign this request"
              placeholder="Wallet password to accept"
              value={acceptPasswords[offer.offer_id] || ""}
              onChange={(event) => setAcceptPasswords((current) => ({ ...current, [offer.offer_id]: event.target.value }))}
            />
            <button className="button" type="button" disabled={actionId === `${offer.offer_id}:accept`} onClick={() => onAccept(offer)}>
              Accept
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function TradeSection(props) {
  return (
    <section className="card card-pad stack">
      <div className="section-title">
        <h2>{props.title}</h2>
      </div>
      {props.loading ? <Spinner label={`Loading ${props.title.toLowerCase()}...`} /> : <TradeGrid {...props} />}
    </section>
  );
}

function TradeGrid(props) {
  if (props.offers.length === 0) {
    return <div className="empty-state">{props.empty || "No coordination records found for this wallet address."}</div>;
  }

  return (
    <div className="exchange-grid">
      {props.offers.map((offer) => (
        <article className="exchange-card" key={offer.offer_id}>
          <TradeDetails offer={offer} showStatus myAddress={props.myAddress} />
          <TradeActions offer={offer} {...props} />
        </article>
      ))}
    </div>
  );
}

function LifecycleGuidance({ offer, role }) {
  const guidance = lifecycleGuidance(offer, role);
  if (!guidance) return null;
  return (
    <div className={`exchange-guidance exchange-guidance--${guidance.tone}`}>
      <strong>{guidance.headline}</strong>
      <p>{guidance.detail}</p>
    </div>
  );
}

function TradeDetails({ offer, showStatus = true, myAddress = "" }) {
  const role = userRole(offer, myAddress);
  return (
    <>
      <div className="section-title">
        <span className={`exchange-badge ${offer.offer_type}`}>{offerTypeLabel(offer.offer_type)}</span>
        {showStatus && <span className={`status-badge ${offer.status}`}>{statusLabel(offer.status)}</span>}
      </div>
      <h3>{formatNumber(offer.amount)} VLQ</h3>
      <LifecycleGuidance offer={offer} role={role} />
      <div className="meta-item">
        <span className="meta-label">Terms</span>
        <span className="meta-value">{offer.price}</span>
      </div>
      <div className="meta-item">
        <span className="meta-label">Description</span>
        <span className="meta-value">{offer.description}</span>
      </div>
      <div className="meta-item">
        <span className="meta-label">Creator</span>
        <span className="meta-value"><AddressIdentity address={offer.creator_address} compact /></span>
      </div>
      {offer.acceptor_address && (
        <div className="meta-item">
          <span className="meta-label">Acceptor</span>
          <span className="meta-value"><AddressIdentity address={offer.acceptor_address} compact /></span>
        </div>
      )}
      <div className="meta-item">
        <span className="meta-label">Posted</span>
        <span className="meta-value">{formatTime(offer.created_at || offer.timestamp)}</span>
      </div>
      {offer.accepted_at && (
        <div className="meta-item">
          <span className="meta-label">Accepted</span>
          <span className="meta-value">{formatTime(offer.accepted_at)}</span>
        </div>
      )}
      {offer.vlq_tx_id && (
        <div className="button-row">
          <Link className="button secondary small-button" to={`/tx/${offer.vlq_tx_id}`}>VLQ Tx</Link>
        </div>
      )}
      {offer.acceptor_address && (
        <div className="meta-item">
          <span className="meta-label">Confirmations</span>
          <span className="meta-value">
            Creator {offer.offchain_confirmation_creator ? "yes" : "no"} / Acceptor {offer.offchain_confirmation_acceptor ? "yes" : "no"}
          </span>
        </div>
      )}
      {offer.dispute_reason && (
        <div className="risk-box">
          <strong>Dispute</strong>
          <p>{offer.dispute_reason}</p>
        </div>
      )}
    </>
  );
}

function TradeActions({
  actionId = "",
  actionPasswords = {},
  disputeInputs = {},
  myAddress = "",
  offer,
  onCancel,
  onConfirm,
  onDispute,
  onRecordTx,
  recordTxInputs = {},
  setActionPasswords = () => {},
  setDisputeInputs,
  setRecordTxInputs,
}) {
  const role = userRole(offer, myAddress);
  const canRecord = ["accepted", "vlq_pending"].includes(offer.status) && role === expectedSenderRole(offer);
  const canConfirm = offer.status === "vlq_confirmed" && ["creator", "acceptor"].includes(role);
  const canDispute = ["accepted", "vlq_pending", "vlq_confirmed"].includes(offer.status) && ["creator", "acceptor"].includes(role);
  const canCancel = offer.status === "open" && role === "creator";
  const showActions = canRecord || canConfirm || canDispute || canCancel;

  if (!showActions) {
    return null;
  }

  return (
    <div className="stack">
      <div className="field">
        <input
          className="input"
          type="password"
          autoComplete="off"
          aria-label="Wallet password to sign this action"
          placeholder="Wallet password to sign"
          value={actionPasswords[offer.offer_id] || ""}
          onChange={(event) => setActionPasswords((current) => ({ ...current, [offer.offer_id]: event.target.value }))}
        />
      </div>
      {canRecord && (
        <div className="form">
          <p className="help-text">Send VLQ from the Send page first, then paste the transaction ID here.</p>
          <div className="inline-form">
            <input
              className="input"
              aria-label="VLQ transaction ID"
              placeholder="VLQ transaction ID"
              value={recordTxInputs[offer.offer_id] || ""}
              onChange={(event) => setRecordTxInputs((current) => ({ ...current, [offer.offer_id]: event.target.value }))}
            />
            <button className="button" type="button" disabled={actionId === `${offer.offer_id}:record`} onClick={() => onRecordTx(offer)}>
              Record VLQ Transaction
            </button>
          </div>
        </div>
      )}

      <div className="button-row">
        {canConfirm && (
          <button className="button small-button" type="button" disabled={actionId === `${offer.offer_id}:confirm`} onClick={() => onConfirm(offer)}>
            Confirm Complete
          </button>
        )}
        {canCancel && (
          <button className="button secondary small-button" type="button" disabled={actionId === `${offer.offer_id}:cancel`} onClick={() => onCancel(offer)}>
            Cancel
          </button>
        )}
      </div>

      {canDispute && (
        <div className="inline-form">
          <input
            className="input"
            aria-label="Dispute reason"
            placeholder="Dispute reason"
            value={disputeInputs[offer.offer_id] || ""}
            onChange={(event) => setDisputeInputs((current) => ({ ...current, [offer.offer_id]: event.target.value }))}
          />
          <button className="button secondary" type="button" disabled={actionId === `${offer.offer_id}:dispute`} onClick={() => onDispute(offer)}>
            Open Dispute
          </button>
        </div>
      )}
    </div>
  );
}

function SummaryStat({ label, value }) {
  return (
    <div className="card card-pad stat-card compact-stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value ?? 0}</span>
    </div>
  );
}

function offerTypeLabel(type) {
  return type === "sell" ? "offering VLQ" : "requesting VLQ";
}

function capitalize(value) {
  const text = String(value || "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Plain-language "where is this, and what do I do next" for the viewing member.
// Tone drives the colour: wait (neutral), action (you must do something), done,
// or alert (disputed).
function lifecycleGuidance(offer, role) {
  const youSend = role === expectedSenderRole(offer);
  const otherParty = role === "creator" ? "the acceptor" : "the creator";
  switch (offer.status) {
    case "open":
      if (role === "creator") {
        return {
          tone: "wait",
          headline: "Open, waiting for someone to accept",
          detail: "Your request is live for the community. You can cancel it any time while it is still open.",
        };
      }
      return {
        tone: "action",
        headline: "Open, and you can accept this",
        detail: "Accepting commits you to coordinate with the creator. You sign with your wallet, then follow the steps to send or receive the VLQ.",
      };
    case "accepted":
      if (youSend) {
        return {
          tone: "action",
          headline: "Your turn to send the VLQ",
          detail: `Send ${formatNumber(offer.amount)} VLQ from the Send page to ${otherParty}, then paste the transaction ID below to record it.`,
        };
      }
      return {
        tone: "wait",
        headline: "Waiting for the VLQ to be sent",
        detail: `${capitalize(otherParty)} needs to send the VLQ and record the transaction. This page updates the moment they do.`,
      };
    case "vlq_pending":
      return {
        tone: "wait",
        headline: "VLQ sent, waiting to confirm",
        detail: "The VLQ transaction is recorded and confirming on the chain. It moves on automatically once it is included in a block.",
      };
    case "vlq_confirmed":
      return {
        tone: "action",
        headline: "VLQ confirmed, finish your side, then confirm",
        detail: "The VLQ has arrived and is confirmed on-chain. Once you have completed the off-chain part of the deal, confirm completion. Both sides must confirm.",
      };
    case "completed":
      return { tone: "done", headline: "Completed", detail: "Both sides confirmed. This coordination is finished." };
    case "cancelled":
      return { tone: "done", headline: "Cancelled", detail: "This request was cancelled and is no longer active." };
    case "disputed":
      return {
        tone: "alert",
        headline: "Disputed",
        detail: "This coordination was marked as disputed, which pauses completion. Review the reason and resolve it together with the other member.",
      };
    default:
      return null;
  }
}

function userRole(offer, address) {
  const normalized = address.trim();
  if (!normalized) return "viewer";
  if (offer.creator_address === normalized) return "creator";
  if (offer.acceptor_address === normalized) return "acceptor";
  return "viewer";
}

function expectedSenderRole(offer) {
  return offer.offer_type === "sell" ? "creator" : "acceptor";
}

function statusLabel(status) {
  return String(status || "").replace(/_/g, " ");
}

function formatTime(timestamp) {
  if (!timestamp) return "Unknown";
  return new Date(Number(timestamp) * 1000).toLocaleString();
}

function formatNumber(value) {
  const number = Number(value || 0);
  return Number.isInteger(number) ? String(number) : number.toFixed(4).replace(/\.?0+$/, "");
}

export default Exchange;
