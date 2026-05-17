const socialLinks = [
  { label: "Discord", href: "https://discord.gg/qpX5sHD4pC", icon: DiscordIcon },
  { label: "Telegram", href: "https://t.me/Vorliq", icon: TelegramIcon },
  { label: "Reddit", href: "https://www.reddit.com/u/Vorliq/s/PbPMGkrGVS", icon: RedditIcon },
  { label: "GitHub", href: "https://github.com/vorliq/Vorliq", icon: GitHubIcon },
  { label: "X", href: "https://x.com/vorliq", icon: XIcon },
];

function SocialLinks({ compact = false }) {
  return (
    <div className={`social-links ${compact ? "compact" : ""}`}>
      {socialLinks.map((link) => {
        const Icon = link.icon;
        return (
          <a href={link.href} target="_blank" rel="noopener noreferrer" key={link.href} aria-label={`Open Vorliq on ${link.label}`}>
            <Icon />
            <span>{link.label}</span>
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
      <path d="M8.4 14.6c1.9 1.2 5.3 1.2 7.2 0" />
      <path d="M9.2 12.2h.01" />
      <path d="M14.8 12.2h.01" />
      <path d="M12 7.8c4.1 0 7.4 2.2 7.4 4.9s-3.3 4.9-7.4 4.9-7.4-2.2-7.4-4.9S7.9 7.8 12 7.8Z" />
      <path d="M16.4 8.5 17.5 5l3 .7" />
      <path d="M4.7 11.1a1.9 1.9 0 1 1 1.5-3.4" />
      <path d="M19.3 11.1a1.9 1.9 0 1 0-1.5-3.4" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 19c-4 1.3-4-2-5.6-2.4" />
      <path d="M15 22v-3.5c0-1 .1-1.6-.5-2.2 2.8-.3 5.8-1.4 5.8-6A4.7 4.7 0 0 0 19 7.1c.1-.3.6-1.6-.1-3.1 0 0-1.1-.3-3.5 1.3a12.2 12.2 0 0 0-6.4 0C6.6 3.7 5.5 4 5.5 4c-.7 1.5-.2 2.8-.1 3.1a4.7 4.7 0 0 0-1.3 3.2c0 4.6 3 5.7 5.8 6-.6.6-.6 1.3-.5 2.2V22" />
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
