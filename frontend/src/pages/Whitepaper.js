function Whitepaper() {
  const communityLinks = [
    { label: "Discord", href: "https://discord.gg/qpX5sHD4pC" },
    { label: "Telegram", href: "https://t.me/Vorliq" },
    { label: "Reddit", href: "https://www.reddit.com/u/Vorliq/s/PbPMGkrGVS" },
    { label: "GitHub", href: "https://github.com/vorliq/Vorliq" },
    { label: "X", href: "https://x.com/vorliq" },
  ];

  return (
    <div className="page">
      <section className="hero">
        <span className="eyebrow">Vorliq Whitepaper</span>
        <h1>Community blockchain software on an independent chain</h1>
        <p className="subtitle">
          Vorliq is experimental open-source software for communities that want to test
          transparent wallets, signed transactions, community requests, and governance using VLQ.
        </p>
      </section>

      <article className="whitepaper card card-pad">
        <section>
          <h2>Introduction</h2>
          <p>
            Vorliq is a self contained community blockchain platform where ordinary people can
            test saving-style coordination, sending, and lending-style requests with VLQ without depending on any external cryptocurrency network.
            The platform is built around the idea that a community should be able to keep its
            own ledger, operate its own coin, and use that shared record without relying on
            Ethereum, Bitcoin, Solana, or any other outside chain.
          </p>
          <p>
            Most crypto projects are inaccessible to everyday communities because they often
            involve high fees, technical complexity, and dependence on infrastructure that the
            community does not control. Vorliq solves this by keeping the blockchain, wallet
            system, transaction layer, and user application inside one focused network built
            for practical community coordination use.
          </p>
        </section>

        <section>
          <h2>The VLQ Coin</h2>
          <p>
            VLQ is the native coin of the Vorliq network. It is the unit of value used for
            transactions, mining rewards, balances, and community voting activity.
            Vorliq uses a maximum supply of 21 million VLQ, mirroring the scarcity model made
            familiar by Bitcoin while keeping the network independent and community focused.
          </p>
          <p>
            The initial mining reward is 50 VLQ per block, and this reward halves every 210000
            blocks. No VLQ can be created outside of mining rewards and the genesis allocation,
            which means supply growth is transparent and controlled by the rules of the chain
            rather than by a central operator. VLQ has no guaranteed market value and should
            not be treated as an investment promise.
          </p>
        </section>

        <section>
          <h2>How the Blockchain Works</h2>
          <p>
            Vorliq runs its own proof of work blockchain with a difficulty target of four
            leading zeros. Miners search for a valid nonce that produces a block hash matching
            this target, and the resulting proof makes it costly to rewrite history while
            remaining lightweight enough for the application to demonstrate the full process.
          </p>
          <p>
            Transactions are signed with SECP256K1 elliptic curve cryptography, the same curve
            used by Bitcoin. Every block contains a list of signed transactions and links to
            the previous block by hash. Each node validates the full chain by checking block
            hashes, previous hash links, proof of work, and transaction signatures.
          </p>
        </section>

        <section>
          <h2>Community Governance</h2>
          <p>
            Vorliq is designed to explore community governance. Members can vote on supported
            changes to mining rewards, difficulty, and lending-style rules using their VLQ
            balance as voting weight. The goal is to make the people using the system the
            people who guide its direction.
          </p>
          <p>
            This approach is intended to make rules visible and decisions accountable. It does
            not guarantee adoption, returns, repayment, or economic value.
          </p>
        </section>

        <section>
          <h2>Roadmap</h2>
          <p>
            Phase one is the current phase: the launch of the core blockchain and application.
            This includes the Python blockchain, the Express backend API, the React frontend,
            wallet creation, signed transactions, mining, chain inspection, and token economics.
          </p>
          <p>
            Phase two is peer to peer networking so multiple Vorliq nodes can connect, share
            blocks, compare chain state, and sync with each other. This will move Vorliq from a
            self contained local chain toward a community operated network.
          </p>
          <p>
            Phase three is the community lending system where members can request loans, review
            proposals, approve lending activity, and track repayment using transparent on-chain
            records tied to VLQ balances.
          </p>
          <p>
            Phase four is mobile application support. The goal of this phase is to make Vorliq
            easier to use for everyday members who need wallet access, balance checks, transfers,
            loan participation, and community updates from their phones.
          </p>
        </section>

        <section>
          <h2>Responsible Use</h2>
          <p>
            Vorliq is not a licensed bank, broker, exchange, lender, investment adviser,
            custodian, or financial institution. Users are responsible for their own keys,
            actions, local laws, counterparties, and risk decisions.
          </p>
        </section>

        <section>
          <h2>Community Links</h2>
          <div className="whitepaper-links">
            {communityLinks.map((link) => (
              <a key={link.href} href={link.href} target="_blank" rel="noreferrer">
                {link.label}
              </a>
            ))}
          </div>
        </section>
      </article>
    </div>
  );
}

export default Whitepaper;
