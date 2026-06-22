import { useEffect, useState, useSyncExternalStore } from "react";

import { avatarImageUrl, avatarVersion, subscribeAvatar } from "../helpers/avatarStore";

// Deterministic brand-coloured fallback. The wallet address picks a stable colour
// from the brand palette (so a member always gets the same recognisable colour),
// and the first character of the address is shown in white inside the circle.
const AVATAR_COLORS = [
  "#00a896", // teal
  "#1e6fd9", // royal blue
  "#56c870", // green
  "#0d7e74", // deep teal
  "#1457a8", // deep blue
  "#2f9e57", // deep green
  "#7a3ff2", // violet
  "#c2410c", // amber-rust
];

function colorForAddress(address) {
  const source = String(address || "VLQ");
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = (hash * 31 + source.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function firstChar(address) {
  const source = String(address || "V").trim();
  return (source[0] || "V").toUpperCase();
}

// Renders a member's uploaded avatar image when one exists, and otherwise a
// deterministic brand-coloured circle with the first character of the address.
// The image and the fallback both carry the address colour, so even a broken or
// still-loading image shows a coloured circle rather than a black box. Subscribes
// to the avatar version bus so a new upload appears immediately everywhere.
function ProfileAvatar({ profile, address, size = "medium" }) {
  const label = profile?.display_name || address || "Vorliq member";
  const version = useSyncExternalStore(subscribeAvatar, () => avatarVersion(address));
  const url = address ? avatarImageUrl(address, version) : "";
  const [failed, setFailed] = useState(false);
  const background = colorForAddress(address);

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
        // The address colour fills the frame until the image paints (and if it
        // never does), so a missing avatar is a coloured circle, not black.
        style={{ objectFit: "cover", backgroundColor: background }}
      />
    );
  }

  return (
    <span
      className={`profile-avatar ${size} avatar-fallback`}
      style={{ backgroundColor: background, color: "#fff" }}
      aria-label={`${label} profile avatar`}
    >
      {firstChar(address)}
    </span>
  );
}

export default ProfileAvatar;
