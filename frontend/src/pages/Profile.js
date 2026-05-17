import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "react-toastify";

import AddressIdentity, { shortAddress } from "../components/AddressIdentity";
import ErrorMessage from "../components/ErrorMessage";
import ProfileAvatar from "../components/ProfileAvatar";
import ProfileBadge from "../components/ProfileBadge";
import Spinner from "../components/Spinner";
import { useAuth } from "../context/AuthContext";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";

const emptyForm = {
  display_name: "",
  bio: "",
  location: "",
  country: "",
  avatar_style: "gradient",
  website: "",
  x_link: "",
  telegram_link: "",
  discord_name: "",
};

function Profile() {
  const { wallet, isLoggedIn } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryAddress = searchParams.get("address") || "";
  const initialAddress = queryAddress || wallet?.address || "";
  const [addressInput, setAddressInput] = useState(initialAddress);
  const [activeAddress, setActiveAddress] = useState(initialAddress);
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(Boolean(initialAddress));
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const canEdit = Boolean(isLoggedIn && wallet?.address && wallet.address === activeAddress);

  useEffect(() => {
    const nextAddress = queryAddress || wallet?.address || "";
    setAddressInput(nextAddress);
    setActiveAddress(nextAddress);
  }, [queryAddress, wallet?.address]);

  useEffect(() => {
    let mounted = true;

    async function loadProfile() {
      if (!activeAddress) {
        setLoading(false);
        setProfile(null);
        return;
      }

      setLoading(true);
      try {
        const response = await api.get("/profiles/profile", { params: { address: activeAddress } });
        if (mounted) {
          const loadedProfile = response.data.profile || null;
          setProfile(loadedProfile);
          setForm(profileToForm(loadedProfile));
          setErrorMessage("");
        }
      } catch (error) {
        if (mounted) {
          setProfile(null);
          setForm(emptyForm);
          if (error.response?.status === 404) {
            setErrorMessage("");
          } else {
            setErrorMessage(apiErrorMessage(error, "Unable to load profile."));
          }
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadProfile();

    return () => {
      mounted = false;
    };
  }, [activeAddress]);

  const displayProfile = useMemo(() => {
    if (profile) return profile;
    if (!activeAddress) return null;
    return {
      wallet_address: activeAddress,
      display_name: "",
      avatar_style: form.avatar_style || "gradient",
      reputation_score: 0,
      badges: [],
      activity_summary: {},
    };
  }, [activeAddress, form.avatar_style, profile]);

  function searchProfile(event) {
    event.preventDefault();
    const nextAddress = addressInput.trim();
    if (!nextAddress) {
      setErrorMessage("Enter a wallet address to view a profile.");
      return;
    }
    setSearchParams({ address: nextAddress });
  }

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function validateForm() {
    const name = form.display_name.trim();
    if (name.length < 3 || name.length > 32) {
      return "Display name must be 3 to 32 characters.";
    }
    if (form.bio.length > 300) return "Bio must be 300 characters or fewer.";
    if (form.location.length > 80) return "Location must be 80 characters or fewer.";
    if (form.country.length > 80) return "Country must be 80 characters or fewer.";
    return "";
  }

  async function saveProfile(event) {
    event.preventDefault();
    if (!canEdit) {
      setErrorMessage("Log in with this wallet to edit this profile.");
      return;
    }
    const validation = validateForm();
    if (validation) {
      setErrorMessage(validation);
      return;
    }

    setSaving(true);
    try {
      const response = await api.post("/profiles/profile", {
        wallet_address: wallet.address,
        ...form,
      });
      setProfile(response.data.profile);
      setForm(profileToForm(response.data.profile));
      setErrorMessage("");
      toast.success("Profile saved.");
    } catch (error) {
      const message = apiErrorMessage(error, "Unable to save profile.");
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page">
      <section className="hero">
        <span className="eyebrow">Member Identity</span>
        <h1>Profiles</h1>
        <p className="subtitle">
          Public community profiles connect a display name, reputation, and profile details to a Vorliq wallet address.
        </p>
      </section>

      <ErrorMessage message={errorMessage} />

      <section className="card card-pad profile-search-section">
        <form className="form inline-form" onSubmit={searchProfile}>
          <input
            className="input"
            value={addressInput}
            onChange={(event) => setAddressInput(event.target.value)}
            placeholder="Wallet address"
            aria-label="Wallet address to view profile"
          />
          <button className="button" type="submit">View Profile</button>
          {isLoggedIn && wallet?.address && (
            <button
              className="button secondary"
              type="button"
              onClick={() => setSearchParams({ address: wallet.address })}
            >
              My Profile
            </button>
          )}
        </form>
      </section>

      {loading ? (
        <Spinner label="Loading profile..." />
      ) : activeAddress ? (
        <div className="profile-layout">
          <section className="card card-pad profile-card-public">
            <div className="profile-card-head">
              <ProfileAvatar profile={displayProfile} address={activeAddress} size="large" />
              <div>
                <span className="eyebrow">Public Profile</span>
                <h2>{profile?.display_name || "No profile yet"}</h2>
                <AddressIdentity address={activeAddress} compact />
              </div>
            </div>

            {!profile && (
              <div className="empty-state">
                This wallet has not created a public profile yet.
                {canEdit && <Link className="text-button" to={`/profile?address=${activeAddress}`}>Create it below</Link>}
              </div>
            )}

            {profile && (
              <>
                <div className="profile-reputation">
                  <strong>{profile.reputation_score || 0}</strong>
                  <span>Reputation score</span>
                </div>
                <div className="meta-list">
                  <div className="meta-item"><span className="meta-label">Wallet</span><span className="meta-value">{shortAddress(activeAddress)}</span></div>
                  {(profile.location || profile.country) && (
                    <div className="meta-item">
                      <span className="meta-label">Location</span>
                      <span className="meta-value">{[profile.location, profile.country].filter(Boolean).join(", ")}</span>
                    </div>
                  )}
                  {profile.discord_name && <div className="meta-item"><span className="meta-label">Discord</span><span className="meta-value">{profile.discord_name}</span></div>}
                </div>
                {profile.bio && <p>{profile.bio}</p>}
                <ProfileLinks profile={profile} />
                <div className="profile-badge-row">
                  {(profile.badges || []).map((badge, index) => <ProfileBadge badge={badge} key={`${badge.id || badge}-${index}`} />)}
                  {profile.is_ambassador && <ProfileBadge badge="Ambassador" />}
                </div>
                <ActivitySummary summary={profile.activity_summary || {}} />
              </>
            )}
          </section>

          {canEdit && (
            <section className="card card-pad profile-form-card">
              <span className="eyebrow">Edit Public Profile</span>
              <h2>{profile ? "Update your profile" : "Create your public profile"}</h2>
              <p className="help-text">
                Everything saved here is public and linked to your wallet address. Do not post private information.
              </p>
              <form className="form" onSubmit={saveProfile}>
                <div className="field">
                  <label htmlFor="profile-display-name">Display Name</label>
                  <input id="profile-display-name" className="input" value={form.display_name} maxLength={32} onChange={(event) => updateForm("display_name", event.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="profile-bio">Bio</label>
                  <textarea id="profile-bio" className="textarea" value={form.bio} maxLength={300} onChange={(event) => updateForm("bio", event.target.value)} />
                </div>
                <div className="two-column">
                  <div className="field">
                    <label htmlFor="profile-location">Location</label>
                    <input id="profile-location" className="input" value={form.location} maxLength={80} onChange={(event) => updateForm("location", event.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor="profile-country">Country</label>
                    <input id="profile-country" className="input" value={form.country} maxLength={80} onChange={(event) => updateForm("country", event.target.value)} />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="profile-avatar-style">Avatar Style</label>
                  <select id="profile-avatar-style" className="input" value={form.avatar_style} onChange={(event) => updateForm("avatar_style", event.target.value)}>
                    <option value="gradient">gradient</option>
                    <option value="green">green</option>
                    <option value="cyan">cyan</option>
                    <option value="blue">blue</option>
                    <option value="gold">gold</option>
                    <option value="purple">purple</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="profile-website">Website</label>
                  <input id="profile-website" className="input" value={form.website} onChange={(event) => updateForm("website", event.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="profile-x">X Link</label>
                  <input id="profile-x" className="input" value={form.x_link} onChange={(event) => updateForm("x_link", event.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="profile-telegram">Telegram Link</label>
                  <input id="profile-telegram" className="input" value={form.telegram_link} onChange={(event) => updateForm("telegram_link", event.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="profile-discord">Discord Name</label>
                  <input id="profile-discord" className="input" value={form.discord_name} maxLength={80} onChange={(event) => updateForm("discord_name", event.target.value)} />
                </div>
                <button className="button" type="submit" disabled={saving}>
                  {saving ? "Saving..." : "Save Profile"}
                </button>
              </form>
            </section>
          )}
        </div>
      ) : (
        <div className="empty-state">Enter a wallet address to view a public profile.</div>
      )}
    </div>
  );
}

function profileToForm(profile) {
  if (!profile) return emptyForm;
  return {
    display_name: profile.display_name || "",
    bio: profile.bio || "",
    location: profile.location || "",
    country: profile.country || "",
    avatar_style: profile.avatar_style || "gradient",
    website: profile.website || "",
    x_link: profile.x_link || "",
    telegram_link: profile.telegram_link || "",
    discord_name: profile.discord_name || "",
  };
}

function ProfileLinks({ profile }) {
  const links = [
    ["Website", profile.website],
    ["X", profile.x_link],
    ["Telegram", profile.telegram_link],
  ].filter(([, href]) => href);
  if (!links.length) return null;
  return (
    <div className="profile-links">
      {links.map(([label, href]) => (
        <a className="button secondary small-button" href={href} target="_blank" rel="noreferrer" key={label}>
          {label}
        </a>
      ))}
    </div>
  );
}

function ActivitySummary({ summary }) {
  const rows = [
    ["Achievements", summary.achievements || 0],
    ["Forum posts", summary.forum_posts || 0],
    ["Forum replies", summary.forum_replies || 0],
    ["Trades", summary.completed_exchange_trades || 0],
    ["Loans repaid", summary.repaid_loans || 0],
    ["Governance votes", summary.governance_votes || 0],
    ["Treasury votes", summary.treasury_votes || 0],
    ["Mined blocks", summary.mined_blocks || 0],
  ];
  return (
    <div className="profile-activity-grid">
      {rows.map(([label, value]) => (
        <div className="stat-card compact-stat" key={label}>
          <span className="stat-label">{label}</span>
          <span className="stat-value">{value}</span>
        </div>
      ))}
    </div>
  );
}

export default Profile;
