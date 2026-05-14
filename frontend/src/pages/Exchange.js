import { useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";

import ErrorMessage from "../components/ErrorMessage";
import Spinner from "../components/Spinner";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";

const initialOfferForm = {
  creatorAddress: "",
  offerType: "buy",
  amount: "",
  price: "",
  description: "",
};

function shortAddress(address) {
  if (!address) return "None";
  return address.length > 12 ? `${address.slice(0, 12)}...` : address;
}

function formatTime(timestamp) {
  return new Date(timestamp * 1000).toLocaleString();
}

function Exchange() {
  const [activeTab, setActiveTab] = useState("open");
  const [openOffers, setOpenOffers] = useState([]);
  const [allOffers, setAllOffers] = useState([]);
  const [myOffers, setMyOffers] = useState([]);
  const [offerForm, setOfferForm] = useState(initialOfferForm);
  const [acceptAddresses, setAcceptAddresses] = useState({});
  const [myAddress, setMyAddress] = useState("");
  const [sortConfig, setSortConfig] = useState({ key: "timestamp", direction: "desc" });
  const [loadingOpen, setLoadingOpen] = useState(true);
  const [loadingAll, setLoadingAll] = useState(false);
  const [loadingMine, setLoadingMine] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function loadOpenOffers({ quiet = false } = {}) {
    try {
      const response = await api.get("/exchange/offers");
      setOpenOffers(response.data.offers || []);
      setErrorMessage("");
    } catch (error) {
      if (!quiet) {
        const message = apiErrorMessage(error, "Unable to load open exchange offers.");
        setErrorMessage(message);
        toast.error(message);
      }
    } finally {
      setLoadingOpen(false);
    }
  }

  async function loadAllOffers() {
    setLoadingAll(true);
    try {
      const response = await api.get("/exchange/all");
      setAllOffers(response.data.offers || []);
      setErrorMessage("");
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to load exchange history.");
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setLoadingAll(false);
    }
  }

  async function searchMyOffers(event) {
    event?.preventDefault();
    if (!myAddress.trim()) {
      toast.error("Enter your wallet address.");
      return;
    }

    setLoadingMine(true);
    try {
      const response = await api.get("/exchange/my", { params: { address: myAddress.trim() } });
      setMyOffers(response.data.offers || []);
      setErrorMessage("");
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to load your offers.");
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setLoadingMine(false);
    }
  }

  useEffect(() => {
    loadOpenOffers();
  }, []);

  useEffect(() => {
    if (activeTab === "all" && allOffers.length === 0) {
      loadAllOffers();
    }
  }, [activeTab, allOffers.length]);

  function updateOfferForm(field, value) {
    setOfferForm((current) => ({ ...current, [field]: value }));
  }

  async function submitOffer(event) {
    event.preventDefault();
    if (
      !offerForm.creatorAddress.trim() ||
      !offerForm.amount ||
      !offerForm.price.trim() ||
      !offerForm.description.trim()
    ) {
      toast.error("Fill in every offer field.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await api.post("/exchange/offer", {
        creator_address: offerForm.creatorAddress.trim(),
        offer_type: offerForm.offerType,
        amount: Number(offerForm.amount),
        price: offerForm.price.trim(),
        description: offerForm.description.trim(),
      });
      toast.success(`Offer posted: ${response.data.offer_id}`);
      setOfferForm(initialOfferForm);
      setErrorMessage("");
      await loadOpenOffers({ quiet: true });
      setActiveTab("open");
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to post exchange offer.");
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  async function acceptOffer(offerId) {
    const acceptorAddress = acceptAddresses[offerId]?.trim();
    if (!acceptorAddress) {
      toast.error("Enter your wallet address before accepting.");
      return;
    }

    try {
      await api.post("/exchange/accept", {
        offer_id: offerId,
        acceptor_address: acceptorAddress,
      });
      toast.success("Offer accepted.");
      setAcceptAddresses((current) => ({ ...current, [offerId]: "" }));
      await loadOpenOffers({ quiet: true });
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to accept this offer.");
      setErrorMessage(message);
      toast.error(message);
    }
  }

  async function updateOfferStatus(offerId, action) {
    const endpoint = action === "cancel" ? "/exchange/cancel" : "/exchange/complete";
    const callerAddress = myAddress.trim();

    if (!callerAddress) {
      toast.error("Search with your wallet address first.");
      return;
    }

    try {
      await api.post(endpoint, {
        offer_id: offerId,
        caller_address: callerAddress,
      });
      toast.success(action === "cancel" ? "Offer cancelled." : "Offer completed.");
      await searchMyOffers();
      await loadOpenOffers({ quiet: true });
      setAllOffers([]);
    } catch (error) {
      const message = apiErrorMessage(error, `Unable to ${action} this offer.`);
      setErrorMessage(message);
      toast.error(message);
    }
  }

  function sortBy(key) {
    setSortConfig((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  }

  const sortedAllOffers = useMemo(() => {
    return [...allOffers].sort((left, right) => {
      const leftValue = left[sortConfig.key];
      const rightValue = right[sortConfig.key];
      const direction = sortConfig.direction === "asc" ? 1 : -1;

      if (typeof leftValue === "number" && typeof rightValue === "number") {
        return (leftValue - rightValue) * direction;
      }

      return String(leftValue || "").localeCompare(String(rightValue || "")) * direction;
    });
  }, [allOffers, sortConfig]);

  return (
    <main className="page">
      <section className="hero">
        <span className="eyebrow">Peer to Peer Marketplace</span>
        <h1>Exchange</h1>
        <p className="subtitle">
          Post buy and sell offers for VLQ and trade directly with community members using terms
          both sides agree on.
        </p>
      </section>

      <ErrorMessage message={errorMessage} />

      <div className="tab-list">
        <button className={`tab-button ${activeTab === "open" ? "active" : ""}`} type="button" onClick={() => setActiveTab("open")}>
          Open Offers
        </button>
        <button className={`tab-button ${activeTab === "post" ? "active" : ""}`} type="button" onClick={() => setActiveTab("post")}>
          Post Offer
        </button>
        <button className={`tab-button ${activeTab === "mine" ? "active" : ""}`} type="button" onClick={() => setActiveTab("mine")}>
          My Offers
        </button>
        <button className={`tab-button ${activeTab === "all" ? "active" : ""}`} type="button" onClick={() => setActiveTab("all")}>
          All Trades
        </button>
      </div>

      {activeTab === "open" && (
        <section className="card card-pad stack">
          <div className="section-title">
            <h2>Open Offers</h2>
            <button className="button secondary small-button" type="button" onClick={() => loadOpenOffers()}>
              Refresh
            </button>
          </div>
          {loadingOpen ? <Spinner label="Loading open offers..." /> : <OfferGrid offers={openOffers} acceptAddresses={acceptAddresses} setAcceptAddresses={setAcceptAddresses} acceptOffer={acceptOffer} />}
        </section>
      )}

      {activeTab === "post" && (
        <section className="card card-pad stack">
          <h2>Post Offer</h2>
          <form className="form" onSubmit={submitOffer}>
            <div className="field">
              <label htmlFor="exchange-wallet">Wallet Address</label>
              <input id="exchange-wallet" className="input" type="text" value={offerForm.creatorAddress} onChange={(event) => updateOfferForm("creatorAddress", event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="exchange-type">Offer Type</label>
              <select id="exchange-type" className="input" value={offerForm.offerType} onChange={(event) => updateOfferForm("offerType", event.target.value)}>
                <option value="buy">buy</option>
                <option value="sell">sell</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="exchange-amount">Amount of VLQ</label>
              <input id="exchange-amount" className="input" type="number" min="0.000001" step="0.000001" value={offerForm.amount} onChange={(event) => updateOfferForm("amount", event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="exchange-price">Price</label>
              <input id="exchange-price" className="input" type="text" placeholder="for example 10 USD or one bag of vegetables" value={offerForm.price} onChange={(event) => updateOfferForm("price", event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="exchange-description">Description</label>
              <textarea id="exchange-description" className="textarea" value={offerForm.description} onChange={(event) => updateOfferForm("description", event.target.value)} />
            </div>
            <button className="button" type="submit" disabled={submitting}>
              {submitting ? "Submitting..." : "Submit Offer"}
            </button>
          </form>
        </section>
      )}

      {activeTab === "mine" && (
        <section className="card card-pad stack">
          <h2>My Offers</h2>
          <form className="form inline-form" onSubmit={searchMyOffers}>
            <input className="input" type="text" placeholder="Wallet address" value={myAddress} onChange={(event) => setMyAddress(event.target.value)} />
            <button className="button" type="submit">Search</button>
          </form>
          {loadingMine ? <Spinner label="Loading your offers..." /> : <MyOfferGrid offers={myOffers} onAction={updateOfferStatus} />}
        </section>
      )}

      {activeTab === "all" && (
        <section className="card card-pad stack">
          <div className="section-title">
            <h2>All Trades</h2>
            <button className="button secondary small-button" type="button" onClick={loadAllOffers}>
              Refresh
            </button>
          </div>
          {loadingAll ? <Spinner label="Loading exchange history..." /> : <AllTradesTable offers={sortedAllOffers} sortBy={sortBy} sortConfig={sortConfig} />}
        </section>
      )}
    </main>
  );
}

function OfferGrid({ offers, acceptAddresses, setAcceptAddresses, acceptOffer }) {
  if (offers.length === 0) {
    return <div className="empty-state">No open exchange offers are available yet.</div>;
  }

  return (
    <div className="exchange-grid">
      {offers.map((offer) => (
        <article className="exchange-card" key={offer.offer_id}>
          <OfferDetails offer={offer} />
          <div className="inline-form">
            <input
              className="input"
              type="text"
              placeholder="Your wallet address"
              value={acceptAddresses[offer.offer_id] || ""}
              onChange={(event) =>
                setAcceptAddresses((current) => ({
                  ...current,
                  [offer.offer_id]: event.target.value,
                }))
              }
            />
            <button className="button" type="button" onClick={() => acceptOffer(offer.offer_id)}>
              Accept
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function MyOfferGrid({ offers, onAction }) {
  if (offers.length === 0) {
    return <div className="empty-state">No offers found for this wallet address.</div>;
  }

  return (
    <div className="exchange-grid">
      {offers.map((offer) => (
        <article className="exchange-card" key={offer.offer_id}>
          <OfferDetails offer={offer} showStatus />
          <div className="button-row">
            {offer.status === "open" && (
              <button className="button secondary" type="button" onClick={() => onAction(offer.offer_id, "cancel")}>
                Cancel
              </button>
            )}
            {offer.status === "accepted" && (
              <button className="button" type="button" onClick={() => onAction(offer.offer_id, "complete")}>
                Complete
              </button>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

function OfferDetails({ offer, showStatus = false }) {
  return (
    <>
      <div className="section-title">
        <span className={`exchange-badge ${offer.offer_type}`}>{offer.offer_type}</span>
        {showStatus && <span className={`status-badge ${offer.status}`}>{offer.status}</span>}
      </div>
      <h3>{offer.amount} VLQ</h3>
      <div className="meta-item">
        <span className="meta-label">Price</span>
        <span className="meta-value">{offer.price}</span>
      </div>
      <div className="meta-item">
        <span className="meta-label">Description</span>
        <span className="meta-value">{offer.description}</span>
      </div>
      <div className="meta-item">
        <span className="meta-label">Creator</span>
        <span className="meta-value">{shortAddress(offer.creator_address)}</span>
      </div>
      <div className="meta-item">
        <span className="meta-label">Posted</span>
        <span className="meta-value">{formatTime(offer.timestamp)}</span>
      </div>
    </>
  );
}

function AllTradesTable({ offers, sortBy, sortConfig }) {
  if (offers.length === 0) {
    return <div className="empty-state">No exchange trades have been posted yet.</div>;
  }

  const headers = [
    ["offer_type", "Type"],
    ["amount", "Amount"],
    ["price", "Price"],
    ["status", "Status"],
    ["creator_address", "Creator"],
    ["timestamp", "Time"],
  ];

  return (
    <div className="table-wrap">
      <table className="stats-table">
        <thead>
          <tr>
            {headers.map(([key, label]) => (
              <th key={key}>
                <button className="table-sort-button" type="button" onClick={() => sortBy(key)}>
                  {label} {sortConfig.key === key ? (sortConfig.direction === "asc" ? "ASC" : "DESC") : ""}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {offers.map((offer) => (
            <tr key={offer.offer_id}>
              <td>{offer.offer_type}</td>
              <td>{offer.amount} VLQ</td>
              <td>{offer.price}</td>
              <td>{offer.status}</td>
              <td>{shortAddress(offer.creator_address)}</td>
              <td>{formatTime(offer.timestamp)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default Exchange;
