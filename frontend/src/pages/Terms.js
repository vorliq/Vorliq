import { Link } from "react-router-dom";

// Plain-language terms of service. Explains what Vorliq is (and is not), what the
// member is responsible for, what the platform does and does not promise, and
// what is not allowed. Deliberately readable by a non-technical member.
const LAST_UPDATED = "22 June 2026";

function Section({ id, eyebrow, title, children }) {
  return (
    <section id={id} className="card card-pad stack" aria-label={title}>
      <div className="section-title">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h2>{title}</h2>
        </div>
      </div>
      {children}
    </section>
  );
}

function Terms() {
  return (
    <div className="page">
      <section className="hero">
        <span className="eyebrow">Terms of Service</span>
        <h1>The agreement between you and Vorliq.</h1>
        <p className="subtitle">
          These terms explain what Vorliq is, what you are responsible for, and what is and is not
          allowed. By creating a wallet or using Vorliq, you agree to them. Please read them. Last
          updated {LAST_UPDATED}.
        </p>
      </section>

      <Section id="what-is-vorliq" eyebrow="What it is" title="What Vorliq is">
        <p>
          Vorliq is a community savings platform built on its own lightweight blockchain, with a coin
          called VLQ. Members create wallets, send and receive VLQ, take part in community lending,
          trade with each other, and vote on how the community is run. Decisions about the platform are
          made by community governance, not by a company.
        </p>
        <div className="risk-box">
          <strong>Vorliq is community software, not a licensed banking service.</strong>
          <p>
            Vorliq is not a bank, a broker, or a licensed financial institution, and it is not
            supervised by a financial regulator. VLQ is a community coin on Vorliq's own chain, not
            legal tender, and not a deposit that is insured or guaranteed by any government scheme.
            Taking part is voluntary and at your own risk.
          </p>
        </div>
      </Section>

      <Section id="your-responsibilities" eyebrow="Your part" title="What you are responsible for">
        <div className="lifecycle-grid">
          <article className="lifecycle-step">
            <h3>Your keys and password</h3>
            <p>
              Your wallet is protected by a password only you know, and your private key is stored
              encrypted in your own browser. Vorliq cannot recover either one. If you lose your
              password or backup, or if someone else gets them, your funds cannot be restored. Keep
              them safe and private.
            </p>
          </article>
          <article className="lifecycle-step">
            <h3>Your transactions</h3>
            <p>
              Transactions on the blockchain are final and cannot be reversed. Check the address and
              amount before you confirm. You are responsible for the transfers, trades, loans, and
              votes you sign.
            </p>
          </article>
          <article className="lifecycle-step">
            <h3>Your device</h3>
            <p>
              Because your wallet lives in your browser, keep your device free of malware and do not
              share your screen or backup file with anyone. Never paste your private key or password
              into any site or message.
            </p>
          </article>
          <article className="lifecycle-step">
            <h3>Your conduct</h3>
            <p>
              You are responsible for what you post and how you treat other members. Follow the
              prohibited-use rules below.
            </p>
          </article>
        </div>
      </Section>

      <Section id="guarantees" eyebrow="Promises" title="What we do and do not guarantee">
        <p>
          Vorliq aims to be transparent, available, and honest, and the chain's rules are enforced by
          code that anyone can read. But this is open-source community software provided as-is. We do
          not promise that:
        </p>
        <ul className="legal-list">
          <li>VLQ has, or will hold, any particular value. Its value is whatever the community decides, and it can fall to nothing.</li>
          <li>The service will always be online, fast, or free of bugs.</li>
          <li>Any loan will be funded, repaid, or that any trade will complete.</li>
          <li>Lost passwords, lost keys, or transactions sent to the wrong address can be recovered.</li>
        </ul>
        <p className="help-text">
          What we do commit to: keeping the chain's history public and verifiable, never taking custody
          of your keys, and never selling your personal data. See the <Link to="/privacy">Privacy
          Policy</Link>.
        </p>
      </Section>

      <Section id="prohibited" eyebrow="Not allowed" title="Prohibited behaviour">
        <p>To keep Vorliq safe and useful for everyone, you must not:</p>
        <ul className="legal-list">
          <li>Use Vorliq for any unlawful purpose, including fraud, money laundering, or financing illegal activity.</li>
          <li>Try to break, overload, or attack the chain, the nodes, or other members' wallets.</li>
          <li>Impersonate another member, or try to spoof authorship of posts, votes, or transactions.</li>
          <li>Post content that is abusive, harassing, hateful, or that shares other people's private information.</li>
          <li>Publish wallet secrets — your own or anyone else's — including private keys, backup passwords, or seed phrases.</li>
          <li>Manipulate governance, lending, or the exchange through deception, collusion, or automated abuse.</li>
        </ul>
        <p className="help-text">
          Community moderation and governance can remove content and restrict accounts that break these
          rules.
        </p>
      </Section>

      <Section id="risk-notice" eyebrow="Risk" title="Risk notice">
        <p>
          Community finance carries real risk. A loan you fund may not be repaid. A trade may not
          complete. The value of VLQ can go down as well as up. Only take part with value you can
          afford to lose, and make your own judgement about each loan, trade, and vote. Nothing in
          Vorliq is financial advice.
        </p>
      </Section>

      <Section id="changes" eyebrow="Updates" title="Changes to these terms">
        <p>
          These terms may change as the platform and its governance evolve. When they do, the date at
          the top of this page will change. Continuing to use Vorliq after a change means you accept the
          updated terms. Questions can be raised in the <Link to="/forum">community forum</Link>.
        </p>
      </Section>
    </div>
  );
}

export default Terms;
