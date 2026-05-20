import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import api from "../helpers/api";
import ProfileAvatar from "./ProfileAvatar";
import TrustLabels from "./TrustLabels";

function shortAddress(address) {
  if (!address) return "Unknown";
  return address.length > 12 ? `${address.slice(0, 12)}...` : address;
}

function AddressIdentity({ address, compact = false, className = "", profile: providedProfile = null }) {
  const [profile, setProfile] = useState(providedProfile);
  const [loaded, setLoaded] = useState(Boolean(providedProfile));

  useEffect(() => {
    let mounted = true;
    const trimmed = address?.trim();
    if (providedProfile) {
      setProfile(providedProfile);
      setLoaded(true);
      return undefined;
    }
    if (!trimmed) {
      setLoaded(true);
      return undefined;
    }

    setLoaded(false);
    api
      .get("/profiles/profile", { params: { address: trimmed } })
      .then((response) => {
        if (mounted) {
          setProfile(response.data.profile || null);
        }
      })
      .catch(() => {
        if (mounted) {
          setProfile(null);
        }
      })
      .finally(() => {
        if (mounted) {
          setLoaded(true);
        }
      });

    return () => {
      mounted = false;
    };
  }, [address, providedProfile]);

  const label = profile?.display_name || shortAddress(address);

  return (
    <Link
      className={`address-identity ${compact ? "compact" : ""} ${className}`.trim()}
      to={`/profile?address=${encodeURIComponent(address || "")}`}
      onClick={(event) => event.stopPropagation()}
    >
      {profile && <ProfileAvatar profile={profile} address={address} size={compact ? "small" : "medium"} />}
      <span>
        <strong>{label}</strong>
        {!compact && profile && <small>{shortAddress(address)}</small>}
        {profile && <TrustLabels profile={profile} compact />}
        {!loaded && !profile && <small>Loading profile...</small>}
      </span>
    </Link>
  );
}

export { shortAddress };
export default AddressIdentity;
