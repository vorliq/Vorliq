import { Link } from "react-router-dom";

const pillars = [
  {
    title: "Savings",
    body:
      "Communities pool VLQ and save together, with every contribution and balance recorded transparently on Vorliq's own chain.",
  },
  {
    title: "Lending",
    body:
      "Members can propose loans and vote according to community rules. Lending activity is traceable on chain, while each group remains responsible for its own decisions.",
  },
  {
    title: "Blockchain",
    body:
      "VLQ runs on Vorliq's own lightweight blockchain. Wallets, transactions, and validation stay within the Vorliq network.",
  },
  {
    title: "Community",
    body:
      "Vorliq is built for real communities saving toward shared goals — transparent records, open governance, and lending decided together.",
  },
  {
    title: "Governance",
    body:
      "Supported settings and community proposals can be voted on openly. Governance is a software feature, not a legal wrapper or guarantee.",
  },
  {
    title: "Transparency",
    body:
      "Blocks, transactions, node readiness, releases, and public documentation give members a shared record they can inspect.",
  },
];

const commitments = [
  "Native Vorliq wallet flow.",
  "No third party blockchain dependency.",
  "No promise of financial returns.",
  "No request for users to paste private keys into public forms.",
];

function Features() {
  return (
    <div className="page">
      <section className="hero" aria-label="Features introduction">
        <span className="eyebrow">Responsible Community Finance Software</span>
        <h1>Savings, lending, and shared records for real communities.</h1>
        <p className="subtitle">
          Vorliq is a community savings and lending platform built on its own lightweight blockchain. The internal
          coin is VLQ.
        </p>
      </section>

      <section className="card card-pad stack" aria-label="Product pillars">
        <div className="section-title">
          <div>
            <span className="eyebrow">Pillars</span>
            <h2>What Vorliq Gives Your Community</h2>
          </div>
        </div>
        <div className="lifecycle-grid">
          {pillars.map((pillar) => (
            <article className="lifecycle-step" key={pillar.title}>
              <h3>{pillar.title}</h3>
              <p>{pillar.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="card card-pad stack" aria-label="What Vorliq is not">
        <div className="section-title">
          <div>
            <span className="eyebrow">Honest Limits</span>
            <h2>What Vorliq is not</h2>
          </div>
        </div>
        <p className="subtitle">
          Responsible wording matters. Vorliq describes itself as a community savings bank product experience, not as
          regulated banking, legal lending, custody, exchange services, or a promise of value.
        </p>
        <div className="grid quick-link-grid">
          {commitments.map((item) => (
            <article className="lifecycle-step" key={item}>
              <p>{item}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="card card-pad stack" aria-label="Explore the public chain">
        <div className="section-title">
          <div>
            <span className="eyebrow">Explore</span>
            <h2>Explore the public chain.</h2>
          </div>
        </div>
        <p className="subtitle">View live blocks, transactions, and chain status through the existing public API.</p>
        <div className="button-row">
          <Link className="button" to="/blockchain">
            Open Blockchain
          </Link>
          <Link className="button secondary" to="/vlq">
            Understand VLQ
          </Link>
          <Link className="button secondary" to="/register">
            Create Account
          </Link>
        </div>
      </section>
    </div>
  );
}

export default Features;
