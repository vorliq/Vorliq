export function trustLabelsForProfile(profile) {
  if (!profile) return ["Unverified Wallet"];
  if (Array.isArray(profile.trust_labels) && profile.trust_labels.length) {
    return profile.trust_labels;
  }
  const labels = [profile.verified_wallet ? "Wallet Verified" : "Unverified Wallet"];
  const reputation = Number(profile.reputation_score || 0);
  const createdAt = Number(profile.created_at || 0);
  if (reputation >= 100) labels.push("Top Reputation");
  if (reputation >= 25) labels.push("Active Contributor");
  if (createdAt && Date.now() / 1000 - createdAt < 14 * 24 * 60 * 60) labels.push("New Member");
  return labels;
}

export function trustLabelDescription(label) {
  if (label === "Wallet Verified") return "Wallet Verified: this profile has proven control of its wallet address. This is not legal identity verification.";
  if (label === "Unverified Wallet") return "Unverified Wallet: this profile has not completed wallet-control verification.";
  if (label === "Top Reputation") return "Top Reputation: this profile has a high public activity reputation score.";
  if (label === "Active Contributor") return "Active Contributor: this profile has visible community activity.";
  if (label === "New Member") return "New Member: this profile was created recently.";
  return label;
}
