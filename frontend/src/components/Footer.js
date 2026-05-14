function Footer() {
  const links = [
    { label: "Discord", href: "https://discord.gg/qpX5sHD4pC" },
    { label: "Telegram", href: "https://t.me/Vorliq" },
    { label: "Reddit", href: "https://www.reddit.com/u/Vorliq/s/PbPMGkrGVS" },
    { label: "GitHub", href: "https://github.com/vorliq/Vorliq" },
    { label: "X", href: "https://x.com/vorliq" },
    { label: "Network Status", href: "https://status.vorliq.org" },
  ];

  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <h2>Vorliq</h2>
          <p>Your Community Your Coin</p>
        </div>

        <div className="footer-links">
          {links.map((link) => (
            <a key={link.href} href={link.href} target="_blank" rel="noreferrer">
              {link.label}
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}

export default Footer;
