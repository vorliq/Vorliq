import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { getTreasuryLedger, getTreasuryProposals, getTreasurySummary } from "../api";
import theme from "../theme";
import { formatTimestamp, normalizeStatus, shortText, statusColor } from "../utils/format";
import sharedStyles from "./sharedStyles";

export default function TreasuryScreen({ navigation }) {
  const [segment, setSegment] = useState("Overview");
  const [summary, setSummary] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    const [summaryResult, ledgerResult, proposalResult] = await Promise.all([
      getTreasurySummary(),
      getTreasuryLedger({ limit: 20 }),
      getTreasuryProposals({ limit: 30 }),
    ]);
    if (summaryResult.success) setSummary(summaryResult.data.summary || summaryResult.data.data?.summary || summaryResult.data);
    if (ledgerResult.success) setLedger(ledgerResult.data.ledger || ledgerResult.data.data?.ledger || ledgerResult.data.data || []);
    if (proposalResult.success) setProposals(proposalResult.data.proposals || proposalResult.data.data?.proposals || proposalResult.data.data || []);
    if (!summaryResult.success) setError(summaryResult.error);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const active = proposals.filter((proposal) => proposal.status === "active");
  const history = proposals.filter((proposal) => proposal.status !== "active");

  return (
    <ScrollView style={sharedStyles.screen} contentContainerStyle={sharedStyles.content}>
      <Text style={sharedStyles.title}>Treasury</Text>
      <Text style={sharedStyles.subtitle}>
        Public treasury tracking for mining reward inflows, voted proposals, pending payouts, and paid records.
      </Text>

      <View style={styles.segmented}>
        {["Overview", "Ledger", "Active", "History"].map((item) => (
          <Pressable key={item} style={[styles.segmentButton, segment === item && styles.segmentButtonActive]} onPress={() => setSegment(item)}>
            <Text style={[styles.segmentText, segment === item && styles.segmentTextActive]}>{item}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? <ActivityIndicator color={theme.accent} /> : null}
      {error ? <Text style={sharedStyles.errorText}>{error}</Text> : null}

      {segment === "Overview" ? (
        <View style={sharedStyles.card}>
          <Text style={sharedStyles.label}>Summary</Text>
          <Text style={sharedStyles.value}>Balance: {summary?.current_balance ?? summary?.treasury_balance ?? 0} VLQ</Text>
          <Text style={sharedStyles.value}>Total received: {summary?.total_received ?? 0} VLQ</Text>
          <Text style={sharedStyles.value}>Total paid: {summary?.total_paid ?? 0} VLQ</Text>
          <Text style={sharedStyles.mutedText}>Pending payouts: {summary?.pending_payouts ?? 0}</Text>
          <Text style={sharedStyles.mutedText}>Active proposals: {summary?.active_proposal_count ?? summary?.active_count ?? active.length}</Text>
          <Text style={[sharedStyles.warningText, styles.top]}>
            Treasury records are community software accounting, not legal treasury control or guaranteed funding.
          </Text>
        </View>
      ) : null}

      {segment === "Ledger" ? (
        ledger.length ? ledger.map((entry) => <LedgerEntry key={entry.ledger_id || entry.tx_id} entry={entry} navigation={navigation} />) : <Text style={sharedStyles.mutedText}>No ledger entries returned by this node.</Text>
      ) : null}

      {segment === "Active" ? active.map((proposal) => <Proposal key={proposal.proposal_id} proposal={proposal} navigation={navigation} />) : null}
      {segment === "History" ? history.map((proposal) => <Proposal key={proposal.proposal_id} proposal={proposal} navigation={navigation} />) : null}
    </ScrollView>
  );
}

function LedgerEntry({ entry, navigation }) {
  return (
    <Pressable style={sharedStyles.card} onPress={() => entry.tx_id && navigation.navigate("Transaction", { txId: entry.tx_id })}>
      <Text style={sharedStyles.label}>{String(entry.type || "ledger").replace(/_/g, " ")}</Text>
      <Text style={sharedStyles.value}>{entry.amount} VLQ</Text>
      <Text style={sharedStyles.mutedText}>{formatTimestamp(entry.timestamp)}</Text>
      {entry.tx_id ? <Text style={sharedStyles.linkText}>{shortText(entry.tx_id)}</Text> : null}
      {entry.block_index !== undefined && entry.block_index !== null ? <Text style={sharedStyles.mutedText}>Block #{entry.block_index}</Text> : null}
    </Pressable>
  );
}

function Proposal({ proposal, navigation }) {
  return (
    <View style={sharedStyles.card}>
      <View style={[sharedStyles.badge, { backgroundColor: statusColor(proposal.status) }]}>
        <Text style={sharedStyles.badgeText}>{normalizeStatus(proposal.status)}</Text>
      </View>
      <Text style={[sharedStyles.sectionTitle, styles.top]}>{proposal.title}</Text>
      <Text style={sharedStyles.value}>{proposal.description}</Text>
      <Text style={sharedStyles.mutedText}>Requested: {proposal.requested_amount} VLQ</Text>
      <Text style={sharedStyles.mutedText}>Category: {proposal.category}</Text>
      {proposal.payout_tx_id ? (
        <Pressable style={[sharedStyles.button, styles.top]} onPress={() => navigation.navigate("Transaction", { txId: proposal.payout_tx_id })}>
          <Text style={sharedStyles.buttonText}>Open Payout Transaction</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  segmented: {
    backgroundColor: theme.card,
    borderColor: theme.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    marginVertical: theme.spacing.md,
    padding: theme.spacing.xs,
  },
  segmentButton: {
    alignItems: "center",
    borderRadius: 10,
    flex: 1,
    minHeight: 44,
    justifyContent: "center",
  },
  segmentButtonActive: {
    backgroundColor: theme.accent,
  },
  segmentText: {
    color: theme.textSecondary,
    fontWeight: "800",
  },
  segmentTextActive: {
    color: theme.background,
  },
  top: {
    marginTop: theme.spacing.md,
  },
});
