import { Link } from "react-router-dom";

function Ambassador() {
  return (
    <div className="page">
      <section className="hero" aria-label="Ambassador program introduction">
        <span className="eyebrow">Community Growth</span>
        <h1>Become a Vorliq Ambassador</h1>
        <p className="subtitle">
          Vorliq ambassadors are community members who represent Vorliq in their local area, help new members get
          started, and grow the network organically. Ambassadors earn special recognition in the community.
        </p>
      </section>

      <section className="card card-pad stack" aria-label="What ambassadors do">
        <div className="section-title">
          <div>
            <span className="eyebrow">The Role</span>
            <h2>What Ambassadors Do</h2>
          </div>
        </div>
        <p>
          Ambassadors help new community members set up their Vorliq node, understand the app, and create their first
          VLQ wallet. They make the first steps feel simple and welcoming.
        </p>
        <p>
          Ambassadors organize local meetups, online sessions, and small community introductions so people can learn
          how Vorliq savings, lending, exchange, governance, and mining work.
        </p>
        <p>
          Ambassadors report feedback from their local community so Vorliq can improve around real needs instead of
          guessing from a distance.
        </p>
      </section>

      <div className="two-column">
        <section className="card card-pad stack" aria-label="Application status">
          <div className="section-title">
            <div>
              <span className="eyebrow">Applications</span>
              <h2>Applications Are Not Open Through the Site Yet</h2>
            </div>
          </div>
          <div className="risk-box" role="status">
            <strong>No application form is available right now.</strong>
            <p>
              Vorliq does not currently collect ambassador applications through this site, and application details are
              never sent to third-party form services. When a Vorliq-run application path opens, it will appear here.
            </p>
          </div>
          <p className="muted-text">
            In the meantime, the community forum is the place to introduce yourself and get involved with other
            members.
          </p>
          <div className="button-row">
            <Link className="button secondary" to="/forum">
              Visit the Community Forum
            </Link>
          </div>
        </section>

        <section className="card card-pad stack" aria-label="Current ambassadors">
          <div className="section-title">
            <div>
              <span className="eyebrow">Recognition</span>
              <h2>Current Ambassadors</h2>
            </div>
          </div>
          <div className="empty-state">Be the first Vorliq ambassador in your area.</div>
        </section>
      </div>
    </div>
  );
}

export default Ambassador;
