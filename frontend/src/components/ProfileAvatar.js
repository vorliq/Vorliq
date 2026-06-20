import { useEffect, useState, useSyncExternalStore } from "react";

import { avatarImageUrl, avatarVersion, subscribeAvatar } from "../helpers/avatarStore";

function initialsFromName(name, address) {
  const source = (name || address || "VLQ").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

// Renders a member's uploaded avatar image when one exists, falling back cleanly
// to the generated initials + colour-style identicon when it does not (or while
// it fails to load). Subscribes to the avatar version bus so a new upload shows
// immediately wherever this component is mounted.
function ProfileAvatar({ profile, address, size = "medium" }) {
  const style = profile?.avatar_style || "gradient";
  const label = profile?.display_name || address || "Vorliq member";
  const version = useSyncExternalStore(subscribeAvatar, () => avatarVersion(address));
  const url = address ? avatarImageUrl(address, version) : "";
  const [failed, setFailed] = useState(false);

  // Re-attempt the image whenever the address or version changes.
  useEffect(() => {
    setFailed(false);
  }, [url]);

  if (url && !failed) {
    return (
      <img
        className={`profile-avatar ${size} avatar-image`}
        src={url}
        alt={`${label} profile avatar`}
        loading="lazy"
        onError={() => setFailed(true)}
        style={{ objectFit: "cover" }}
      />
    );
  }

  return (
    <span className={`profile-avatar ${size} avatar-${style}`} aria-label={`${label} profile avatar`}>
      {initialsFromName(profile?.display_name, address)}
    </span>
  );
}

export default ProfileAvatar;
