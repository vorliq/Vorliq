import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { claimFaucet, getFaucetClaims, getFaucetSummary, getRecentFaucetClaims } from "../api";
import { loadWallet } from "../storage";
import theme from "../theme";
import { formatTimestamp, shortText } from "../utils/format";
import sharedStyles from "./sharedStyles";

export default function FaucetScreen({ navigation }) {
  const [wallet, setWallet] = useState(null);
  const [summary, setSummary] = useState(null);
  const [claims, setClaims] = useState([]);
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [lastClaim, setLastClaim] = useState(null);

  const load = useCallback(async () => {
    const savedWallet = await loadWallet();
    setWallet(savedWallet);
    const [summaryResult, recentResult] = await Promise.all([getFaucetSummary(), getRecentFaucetClaims({ limit: 5 })]);
    if (summaryResult.success) setSummary(summaryResult.data);
    if (recentResult.success) setRecent(recentResult.data.claims || recentResult.data.data?.claims || recentResult.data.data || []);
    if (savedWallet?.address) {
      const claimsResult = await getFaucetClaims(savedWallet.address);
      if (claimsResult.success) setClaims(claimsResult.data.claims || claimsResult.data.data?.claims || claimsResult.data.data || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleClaim = async () => {
    setError("");
    setMessage("");
    setLastClaim(null);
    if (!wallet?.address) {
      setError("Create a wallet first. The faucet never asks for your private key.");
      return;
    }
    setClaiming(true);
    const result = await claimFaucet(wallet.address);
    if (result.success) {
      const claim = result.data.claim || result.data.data?.claim || result.data;
      setLastClaim(claim);
      setMessage(result.data.message || "Claim submitted as a pending treasury transaction.");
      await load();
    } else {
      setError(result.error);
    }
    setClaiming(false);
  };

  return (
    <ScrollView style={sharedStyles.screen} contentContainerStyle={sharedStyles.content}>
      <Text style={sharedStyles.title}>Starter VLQ Faucet</Text>
      <Text style={sharedStyles.subtitle}>
        The faucet sends a small starter amount from the community treasury. It does not mint VLQ, and the payout must be mined before it is confirmed.
      </Text>

      {loading ? <ActivityIndicator color={theme.accent} /> : null}
      {message ? <Text style={sharedStyles.successText}>{message}</Text> : null}
      {error ? <Text style={sharedStyles.errorText}>{error}</Text> : null}

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.label}>Summary</Text>
        <Text style={sharedStyles.value}>Treasury balance: {summary?.treasury_balance ?? "Unknown"} VLQ</Text>
        <Text style={sharedStyles.value}>Starter amount: {summary?.starter_amount ?? 1} VLQ</Text>
        <Text style={sharedStyles.mutedText}>Pending claims: {summary?.pending_claims ?? 0}</Text>
        <Text style={sharedStyles.mutedText}>Confirmed claims: {summary?.confirmed_claims ?? 0}</Text>
      </View>

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.label}>Wallet</Text>
        <Text style={sharedStyles.codeText}>{wallet?.address || "No wallet saved on this phone."}</Text>
        <Pressable style={[sharedStyles.button, styles.button]} onPress={handleClaim} disabled={claiming}>
          <Text style={sharedStyles.buttonText}>{claiming ? "Claiming..." : "Claim Starter VLQ"}</Text>
        </Pressable>
        <Text style={[sharedStyles.mutedText, styles.button]}>
          Claims are rate-limited. You do not enter or share your private key for faucet claims.
        </Text>
      </View>

      {lastClaim?.tx_id ? (
        <View style={sharedStyles.card}>
          <Text style={sharedStyles.label}>Claim Transaction</Text>
          <Text style={sharedStyles.codeText}>{lastClaim.tx_id}</Text>
          <Pressable style={[sharedStyles.button, styles.button]} onPress={() => navigation.navigate("Transaction", { txId: lastClaim.tx_id })}>
            <Text style={sharedStyles.buttonText}>Open Transaction</Text>
          </Pressable>
        </View>
      ) : null}

      <ClaimList title="My Faucet Claims" claims={claims} navigation={navigation} />
      <ClaimList title="Recent Claims" claims={recent} navigation={navigation} />
    </ScrollView>
  );
}

function ClaimList({ title, claims, navigation }) {
  return (
    <View style={sharedStyles.card}>
      <Text style={sharedStyles.label}>{title}</Text>
      {claims.length ? (
        claims.map((claim) => (
          <Pressable key={claim.claim_id || claim.tx_id} style={styles.claimRow} onPress={() => claim.tx_id && navigation.navigate("Transaction", { txId: claim.tx_id })}>
            <Text style={sharedStyles.value}>{claim.amount} VLQ - {claim.status}</Text>
            <Text style={sharedStyles.mutedText}>{formatTimestamp(claim.requested_at || claim.timestamp)}</Text>
            {claim.tx_id ? <Text style={sharedStyles.linkText}>{shortText(claim.tx_id)}</Text> : null}
          </Pressable>
        ))
      ) : (
        <Text style={sharedStyles.mutedText}>No claims to show yet.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    marginTop: theme.spacing.md,
  },
  claimRow: {
    borderTopColor: theme.border,
    borderTopWidth: 1,
    paddingVertical: theme.spacing.sm,
  },
});
