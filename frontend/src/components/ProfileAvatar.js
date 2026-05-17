function initialsFromName(name, address) {
  const source = (name || address || "VLQ").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

function ProfileAvatar({ profile, address, size = "medium" }) {
  const style = profile?.avatar_style || "gradient";
  const label = profile?.display_name || address || "Vorliq member";

  return (
    <span className={`profile-avatar ${size} avatar-${style}`} aria-label={`${label} profile avatar`}>
      {initialsFromName(profile?.display_name, address)}
    </span>
  );
}

export default ProfileAvatar;
