function badgeLabel(badge) {
  if (!badge) return "";
  if (typeof badge === "string") return badge;
  return badge.title || badge.id || badge.achievement_id || "Badge";
}

function ProfileBadge({ badge }) {
  const label = badgeLabel(badge);
  if (!label) return null;

  return <span className="profile-badge">{label}</span>;
}

export default ProfileBadge;
