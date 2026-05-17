import { useState } from "react";
import { toast } from "react-toastify";

import AddressIdentity from "../components/AddressIdentity";
import ErrorMessage from "../components/ErrorMessage";
import Spinner from "../components/Spinner";
import api from "../helpers/api";
import { apiErrorMessage } from "../helpers/errors";

function Achievements() {
  const [address, setAddress] = useState("");
  const [earned, setEarned] = useState([]);
  const [allAchievements, setAllAchievements] = useState([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function searchAchievements(event) {
    event.preventDefault();
    if (!address.trim()) {
      toast.error("Enter a wallet address.");
      return;
    }

    setLoading(true);
    try {
      const [earnedResponse, allResponse] = await Promise.all([
        api.get("/achievements", { params: { address: address.trim() } }),
        api.get("/achievements/all"),
      ]);
      setEarned(earnedResponse.data.achievements || []);
      setAllAchievements(allResponse.data.achievements || []);
      setSearched(true);
      setErrorMessage("");
    } catch (error) {
      setErrorMessage(apiErrorMessage(error, "Unable to load achievements."));
    } finally {
      setLoading(false);
    }
  }

  const earnedIds = new Set(earned.map((achievement) => achievement.id || achievement.achievement_id));

  return (
    <div className="page">
      <section className="hero">
        <span className="eyebrow">Community Progress</span>
        <h1>Achievements</h1>
        <p className="subtitle">
          Search any Vorliq wallet address to see the badges that member has earned.
        </p>
      </section>

      <ErrorMessage message={errorMessage} />

      <section className="card card-pad">
        <form className="inline-form" onSubmit={searchAchievements}>
          <input
            className="input"
            type="text"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="Wallet address"
          />
          <button className="button" type="submit">Search</button>
        </form>
      </section>

      {loading && <Spinner label="Loading achievements..." />}

      {searched && !loading && (
        <section className="card card-pad stack">
          <div className="section-title">
            <h2>Achievement Lookup</h2>
            <AddressIdentity address={address.trim()} />
          </div>
          <div className="achievement-grid">
            {allAchievements.map((achievement) => {
              const unlocked = earnedIds.has(achievement.id);
              return (
                <article
                  className={`achievement-badge ${unlocked ? "earned" : "locked"} achievement-${achievement.badge_color}`}
                  key={achievement.id}
                >
                  <strong>{achievement.title}</strong>
                  <p>{achievement.description}</p>
                  <span>{unlocked ? "Earned" : "Locked"}</span>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

export default Achievements;
