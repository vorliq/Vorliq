const socialLinks = [
  { label: "X", href: "https://x.com/Vorliq", icon: XIcon, brand: "x" },
  { label: "Discord", href: "https://discord.gg/qpX5sHD4pC", icon: DiscordIcon, brand: "discord" },
  { label: "GitHub", href: "https://github.com/vorliq/Vorliq", icon: GitHubIcon, brand: "github" },
];

function SocialLinks({ compact = false, className = "" }) {
  return (
    <div className={`social-links brand-social-links ${compact ? "compact" : ""} ${className}`}>
      {socialLinks.map((link) => {
        const Icon = link.icon;
        return (
          <a
            className={`social-brand-link ${link.brand}`}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            key={link.href}
            aria-label={`Open Vorliq on ${link.label}`}
            title={link.label}
          >
            <Icon />
            <span className="sr-only">{link.label}</span>
          </a>
        );
      })}
    </div>
  );
}

// Official X (formerly Twitter) mark.
function XIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.656l-5.214-6.817-5.966 6.817H1.683l7.73-8.835L1.254 2.25h6.826l4.713 6.231 5.451-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644Z"
      />
    </svg>
  );
}

// Official Discord mark.
function DiscordIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M20.317 4.369A19.79 19.79 0 0 0 15.432 2.86a.074.074 0 0 0-.079.037c-.211.375-.444.865-.608 1.249a18.27 18.27 0 0 0-5.487 0 12.6 12.6 0 0 0-.617-1.249.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.369a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.873-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127c-.598.349-1.225.645-1.873.891a.076.076 0 0 0-.04.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.029 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.056c.5-5.177-.838-9.674-3.549-13.66a.06.06 0 0 0-.031-.028ZM8.02 15.331c-1.182 0-2.157-1.085-2.157-2.419 0-1.333.956-2.418 2.157-2.418 1.21 0 2.176 1.094 2.157 2.418 0 1.334-.956 2.419-2.157 2.419Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.094 2.157 2.418 0 1.334-.946 2.419-2.157 2.419Z"
      />
    </svg>
  );
}

// Official GitHub mark.
function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.486 2 12.02c0 4.428 2.865 8.184 6.839 9.51.5.092.682-.218.682-.483 0-.237-.009-.866-.013-1.7-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.467-1.11-1.467-.908-.622.069-.61.069-.61 1.004.071 1.532 1.034 1.532 1.034.892 1.532 2.341 1.09 2.91.834.092-.648.35-1.09.636-1.341-2.22-.254-4.555-1.114-4.555-4.957 0-1.095.39-1.99 1.029-2.692-.103-.254-.446-1.274.098-2.655 0 0 .84-.27 2.75 1.028A9.56 9.56 0 0 1 12 6.847c.85.004 1.705.116 2.504.34 1.909-1.298 2.747-1.028 2.747-1.028.546 1.381.203 2.401.1 2.655.64.702 1.028 1.597 1.028 2.692 0 3.853-2.339 4.7-4.566 4.949.359.31.678.921.678 1.856 0 1.339-.012 2.419-.012 2.748 0 .267.18.58.688.482A10.02 10.02 0 0 0 22 12.02C22 6.486 17.523 2 12 2Z"
      />
    </svg>
  );
}

export { socialLinks };
export default SocialLinks;
