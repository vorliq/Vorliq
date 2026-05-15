function Footer() {
  function reopenHelp() {
    window.localStorage.removeItem("vorliq_onboarding_complete");
    window.location.reload();
  }

  const links = [
    { label: "Discord", href: "https://discord.gg/qpX5sHD4pC" },
    { label: "Telegram", href: "https://t.me/Vorliq" },
    { label: "Reddit", href: "https://www.reddit.com/u/Vorliq/s/PbPMGkrGVS" },
    { label: "GitHub", href: "https://github.com/vorliq/Vorliq" },
    { label: "X", href: "https://x.com/vorliq" },
    { label: "Network Status", href: "https://status.vorliq.org" },
    { label: "Developer API", href: "https://vorliq.github.io/Vorliq/api.html" },
    { label: "Privacy", href: "https://vorliq.github.io/Vorliq/privacy.html" },
    { label: "Terms", href: "https://vorliq.github.io/Vorliq/terms.html" },
    { label: "Become an Ambassador", href: "/ambassador", internal: true },
    { label: "Achievements", href: "/achievements", internal: true },
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
            <a key={link.href} href={link.href} target={link.internal ? undefined : "_blank"} rel={link.internal ? undefined : "noreferrer"}>
              {link.label}
            </a>
          ))}
          <button className="footer-help-link" type="button" onClick={reopenHelp}>
            Help
          </button>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
