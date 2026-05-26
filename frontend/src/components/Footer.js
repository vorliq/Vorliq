import SocialLinks from "./SocialLinks";
import logo from "../assets/logo.png";

function Footer() {
  function reopenHelp() {
    window.localStorage.removeItem("vorliq_onboarding_complete");
    window.location.reload();
  }

  const links = [
    {
      title: "Network",
      items: [
        { label: "Network Status", href: "https://status.vorliq.org" },
        { label: "Developer API", href: "https://vorliq.github.io/Vorliq/api.html" },
        { label: "Transparency", href: "/transparency", internal: true },
        { label: "Growth", href: "/growth", internal: true },
        { label: "Audit", href: "/audit", internal: true },
        { label: "Roadmap", href: "/roadmap", internal: true },
        { label: "Releases", href: "/releases", internal: true },
        { label: "Readiness", href: "/readiness", internal: true },
        { label: "Snapshot Verification", href: "/snapshot", internal: true },
        { label: "Snapshot Archive", href: "/snapshot-archive", internal: true },
        { label: "Bootstrap Node", href: "/bootstrap", internal: true },
        { label: "Storage Roadmap", href: "/migration-readiness", internal: true },
        { label: "Profiles", href: "/profile", internal: true },
      ],
    },
    {
      title: "Community",
      items: [
        { label: "Forum", href: "/forum", internal: true },
        { label: "Become an Ambassador", href: "/ambassador", internal: true },
        { label: "Achievements", href: "/achievements", internal: true },
      ],
    },
    {
      title: "Trust",
      items: [
        { label: "Privacy", href: "https://vorliq.github.io/Vorliq/privacy.html" },
        { label: "Terms", href: "https://vorliq.github.io/Vorliq/terms.html" },
        { label: "Risk Notice", href: "https://vorliq.github.io/Vorliq/terms.html#risk-notice" },
        { label: "Operator Login", href: "/admin", internal: true },
      ],
    },
  ];

  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <div className="footer-wordmark">
            <img src={logo} alt="" aria-hidden="true" />
            <h2>Vorliq</h2>
          </div>
          <p>Your Community Your Coin</p>
          <p className="footer-version">Vorliq 1.0.0 - API v1 - stable</p>
          <SocialLinks compact />
        </div>

        <div className="footer-links">
          {links.map((group) => (
            <div className="footer-link-group" key={group.title}>
              <h3>{group.title}</h3>
              {group.items.map((link) => (
                <a key={link.href} href={link.href} target={link.internal ? undefined : "_blank"} rel={link.internal ? undefined : "noreferrer"}>
                  {link.label}
                </a>
              ))}
            </div>
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
