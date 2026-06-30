import { Link } from "react-router-dom";

// Plain-language privacy policy. Written to be read and understood by a
// non-technical member: every data type the platform actually handles is listed
// with what it is used for, how long it is kept, whether it leaves Vorliq, and
// how to have it removed. Kept in sync with what the code really collects.
const LAST_UPDATED = "22 June 2026";

const DATA_ROWS = [
  {
    item: "Wallet address",
    used: "Identifies your account on the blockchain and links your public activity (transactions, posts, votes) to one identity.",
    retained: "Permanent. A wallet address is part of the public blockchain and cannot be erased from the chain's history.",
    shared: "Public by design. Anyone can see wallet addresses in the block explorer.",
  },
  {
    item: "Transaction history",
    used: "Records transfers, mining rewards, loans, and exchange trades so balances are correct and the chain is auditable.",
    retained: "Permanent, as part of the public blockchain.",
    shared: "Public by design and visible in the block explorer to anyone, signed in or not.",
  },
  {
    item: "Profile image and display name",
    used: "Shown next to your address on your profile, forum posts, and governance proposals so the community can recognise you.",
    retained: "Until you change or remove it in Settings.",
    shared: "Public to anyone who views your profile. Never sold or sent to advertisers.",
  },
  {
    item: "Forum posts and replies",
    used: "Power community discussion. Stored with your wallet address as the author so authorship is verifiable.",
    retained: "Until removed by you or by moderation. Public content is not auto-deleted.",
    shared: "Public to all visitors of the forum.",
  },
  {
    item: "Notification email address",
    used: "Only if you opt in. Used to email you about events you asked to be notified of (for example, a received transfer).",
    retained: "Until you remove it or turn off email notifications in Settings.",
    shared: "Used only to deliver your own notifications. Never sold, rented, or shared for marketing.",
  },
  {
    item: "Usage analytics",
    used: "Anonymous counts of which pages and features are used, to find broken flows and decide what to improve.",
    retained: "Aggregated and time-limited. Not tied to your wallet address or identity.",
    shared: "Not shared with third-party advertising networks.",
  },
];

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

function Privacy() {
  return (
    <div className="page">
      <section className="hero">
        <span className="eyebrow">Privacy Policy</span>
        <h1>What we collect, and what we do with it.</h1>
        <p className="subtitle">
          This policy explains, in plain language, every kind of information Vorliq handles, why we
          handle it, how long it is kept, and how you can have your data removed. Last updated {LAST_UPDATED}.
        </p>
      </section>

      <Section id="summary" eyebrow="In short" title="The short version">
        <p>
          Vorliq is built on a public blockchain, so some of your activity, like your wallet address and
          the transactions, posts, and votes attached to it, is public and permanent by design. That
          is what makes the chain transparent and verifiable. Everything that is not part of the public
          chain, such as your notification email address, is collected only when you choose to provide
          it, is used only to provide the feature you asked for, and is never sold or shared for
          advertising. Your password and private key never leave your browser, so we could not access
          your wallet even if we wanted to.
        </p>
      </Section>

      <Section id="what-we-collect" eyebrow="Details" title="What we collect and why">
        <p className="help-text">
          Each row below lists a kind of information, what it is used for, how long it is kept, and
          whether it is shared.
        </p>
        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Information</th>
                <th scope="col">What it is used for</th>
                <th scope="col">How long it is kept</th>
                <th scope="col">Who it is shared with</th>
              </tr>
            </thead>
            <tbody>
              {DATA_ROWS.map((row) => (
                <tr key={row.item}>
                  <th scope="row">{row.item}</th>
                  <td>{row.used}</td>
                  <td>{row.retained}</td>
                  <td>{row.shared}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="keys" eyebrow="Your keys" title="Your password and private key">
        <p>
          When you create a wallet, your private key is encrypted with a password you choose, and the
          encrypted backup is stored only in your browser. Your password and your unencrypted private
          key are never sent to Vorliq's servers. We cannot recover them for you, and we cannot move
          your funds. This is a deliberate trade-off: it means you, and only you, control your wallet.
        </p>
      </Section>

      <Section id="third-parties" eyebrow="Sharing" title="Third parties">
        <p>
          Vorliq does not sell your personal information and does not share it with advertising
          networks. The public blockchain data (addresses and transactions) is, by its nature, visible
          to anyone. If you opt in to email notifications, your email address is handled by the mail
          service that delivers those messages, and is used for nothing else.
        </p>
      </Section>

      <Section id="deletion" eyebrow="Your rights" title="How to delete your data">
        <p>You can remove the data that is not part of the permanent public chain at any time:</p>
        <div className="lifecycle-grid">
          <article className="lifecycle-step">
            <h3>Profile and image</h3>
            <p>Clear your display name, bio, and profile image in <Link to="/settings">Settings</Link>.</p>
          </article>
          <article className="lifecycle-step">
            <h3>Email notifications</h3>
            <p>Turn off email notifications and remove your address in <Link to="/settings">Settings</Link>.</p>
          </article>
          <article className="lifecycle-step">
            <h3>Forum content</h3>
            <p>Delete your own posts and replies, or ask a moderator through the report tools.</p>
          </article>
        </div>
        <p className="help-text">
          Wallet addresses and confirmed transactions cannot be deleted, because they are part of the
          public blockchain that every member relies on to verify the chain. This is true of every
          public blockchain, not just Vorliq.
        </p>
      </Section>

      <Section id="contact" eyebrow="Questions" title="Contact and changes">
        <p>
          If you have a question about your data or want help removing it, raise it in the{" "}
          <Link to="/forum">community forum</Link>. If this policy changes in a way that affects you,
          the updated date at the top of this page will change and the change will be announced in the
          product. Vorliq is community software, not a licensed banking service; see the{" "}
          <Link to="/terms">Terms of Service</Link> for what that means.
        </p>
      </Section>
    </div>
  );
}

export default Privacy;
