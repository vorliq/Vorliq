const socialLinks = [
  { label: "X", href: "https://x.com/Vorliq", icon: XIcon, brand: "x" },
  { label: "Discord", href: "https://discord.gg/qpX5sHD4pC", icon: DiscordIcon, brand: "discord" },
  { label: "Reddit", href: "https://www.reddit.com/r/VorliqOfficial/", icon: RedditIcon, brand: "reddit" },
  { label: "Facebook", href: "https://www.facebook.com/people/Vorliq/61590708960405/", icon: FacebookIcon, brand: "facebook" },
  { label: "Telegram", href: "https://t.me/Vorliq", icon: TelegramIcon, brand: "telegram" },
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

function DiscordIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8.3 8.7c2.4-.7 5-.7 7.4 0" />
      <path d="M9.1 15.2c2 .7 3.8.7 5.8 0" />
      <path d="M8.8 12.9h.01" />
      <path d="M15.2 12.9h.01" />
      <path d="M7.4 5.5c3-1.2 6.2-1.2 9.2 0 1.7 2.4 2.6 5.2 2.7 8.4-2.1 1.6-4.1 2.5-6.1 2.8l-.8-1.4" />
      <path d="M11.6 15.3l-.8 1.4c-2-.3-4-1.2-6.1-2.8.1-3.2 1-6 2.7-8.4" />
    </svg>
  );
}

function TelegramIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 4 3 11.2l6.9 2.2L17 8.2l-5.4 6.6.2 5.2 3.1-3.4 3.9 2.9L21 4Z" />
    </svg>
  );
}

function RedditIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="14" r="7" />
      <circle cx="9.2" cy="13.2" r="0.6" />
      <circle cx="14.8" cy="13.2" r="0.6" />
      <path d="M9.2 16.4c1.8 1.1 3.8 1.1 5.6 0" />
      <path d="M12 7l1-4 4 1.2" />
      <circle cx="17.8" cy="4.6" r="1.2" />
      <path d="M5 11.5a1.8 1.8 0 0 1 2-3" />
      <path d="M19 11.5a1.8 1.8 0 0 0-2-3" />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14 8h2.5V4.5H14a4 4 0 0 0-4 4V11H7.5v3.5H10V21h3.5v-6.5h2.6l.6-3.5h-3.2V8.8c0-.5.3-.8.5-.8Z" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 4l16 16" />
      <path d="M20 4 4 20" />
    </svg>
  );
}

export { socialLinks };
export default SocialLinks;
