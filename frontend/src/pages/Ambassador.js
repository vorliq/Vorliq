import { useState } from "react";

function Ambassador() {
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submitApplication(event) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    const form = event.currentTarget;
    const response = await fetch("https://formspree.io/f/mzdoladl", {
      method: "POST",
      body: new FormData(form),
      headers: { Accept: "application/json" },
    });

    if (response.ok) {
      form.reset();
      setSubmitted(true);
    } else {
      setError("The ambassador application could not be submitted. Please try again.");
    }

    setSubmitting(false);
  }

  return (
    <main className="page">
      <section className="hero">
        <span className="eyebrow">Community Growth</span>
        <h1>Become a Vorliq Ambassador</h1>
        <p className="subtitle">
          Vorliq ambassadors are community members who represent Vorliq in their local area,
          help new members get started, and grow the network organically. Ambassadors earn
          special recognition in the community and have their wallet address featured on this page.
        </p>
      </section>

      <section className="card card-pad stack">
        <h2>What Ambassadors Do</h2>
        <p>
          Ambassadors help new community members set up their Vorliq node, understand the app, and
          create their first VLQ wallet. They make the first steps feel simple and welcoming.
        </p>
        <p>
          Ambassadors organize local meetups, online sessions, and small community introductions
          so people can learn how Vorliq savings, lending, exchange, governance, and mining work.
        </p>
        <p>
          Ambassadors report feedback from their local community so Vorliq can improve around real
          needs instead of guessing from a distance.
        </p>
      </section>

      <section className="grid two-column">
        <div className="card card-pad stack">
          <h2>Apply to Become an Ambassador</h2>
          {submitted && (
            <div className="success-box">
              Thank you for applying. We will review your ambassador application and follow up with the Vorliq community.
            </div>
          )}
          {error && <div className="error-box">{error}</div>}
          <form
            className="form"
            action="https://formspree.io/f/mzdoladl"
            method="POST"
            onSubmit={submitApplication}
          >
            <input type="hidden" name="form_type" value="ambassador_application" />
            <div className="field">
              <label>Wallet Address</label>
              <input className="input" name="wallet_address" required />
            </div>
            <div className="field">
              <label>Name or Nickname</label>
              <input className="input" name="name_or_nickname" required />
            </div>
            <div className="field">
              <label>Location</label>
              <input className="input" name="location" placeholder="City and country" required />
            </div>
            <div className="field">
              <label>Why do you want to be an ambassador?</label>
              <textarea className="textarea" name="why_ambassador" minLength={100} required />
            </div>
            <div className="field">
              <label>How will you grow the community in your area?</label>
              <textarea className="textarea" name="growth_plan" required />
            </div>
            <button className="button" type="submit" disabled={submitting}>
              {submitting ? "Submitting..." : "Submit Application"}
            </button>
          </form>
        </div>

        <div className="card card-pad stack ambassador-highlight">
          <h2>Current Ambassadors</h2>
          <div className="empty-state accent-empty">
            Be the first Vorliq ambassador in your area.
          </div>
        </div>
      </section>
    </main>
  );
}

export default Ambassador;
