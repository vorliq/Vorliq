import { Link, useLocation } from "react-router-dom";

// Catch-all for unknown URLs. Without it an unmatched path renders an empty
// route region (a blank page); this gives a clear message and routes the user
// back to real destinations instead of a dead end.
export default function NotFound() {
  const location = useLocation();
  return (
    <div className="page stack">
      <section className="card card-pad stack" aria-label="Page not found">
        <div className="section-title">
          <div>
            <span className="eyebrow">Error 404</span>
            <h1>This page doesn’t exist</h1>
          </div>
        </div>
        <p className="muted">
          We couldn’t find <code>{location.pathname}</code>. It may have moved, or the link may be out of
          date.
        </p>
        <div className="button-row">
          <Link className="button primary" to="/">
            Back to home
          </Link>
          <Link className="button secondary" to="/blockchain">
            Explore the blockchain
          </Link>
        </div>
      </section>
    </div>
  );
}
