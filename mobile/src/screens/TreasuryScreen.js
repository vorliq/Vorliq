import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { getMyTreasury, getTreasuryLedger, getTreasuryProposals, getTreasurySummary, submitTreasuryProposal, voteTreasuryProposal } from "../api";
import { loadWallet } from "../storage";
import theme from "../theme";
import { formatTimestamp, normalizeStatus, shortText, statusColor } from "../utils/format";
import sharedStyles from "./sharedStyles";

export default function TreasuryScreen({ navigation }) {
  const [segment, setSegment] = useState("Overview");
  const [wallet, setWallet] = useState(null);
  const [summary, setSummary] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [proposals, setProposals] = useState([]);
  const [myTreasury, setMyTreasury] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [proposalForm, setProposalForm] = useState({
    title: "",
    category: "community",
    description: "",
    requested_amount: "",
    recipient_address: "",
  });

  const load = useCallback(async () => {
    setError("");
    const savedWallet = await loadWallet();
    setWallet(savedWallet);
    const [summaryResult, ledgerResult, proposalResult] = await Promise.all([
      getTreasurySummary(),
      getTreasuryLedger({ limit: 20 }),
      getTreasuryProposals({ limit: 30 }),
    ]);
    if (summaryResult.success) setSummary(summaryResult.data.summary || summaryResult.data.data?.summary || summaryResult.data);
    if (ledgerResult.success) setLedger(ledgerResult.data.ledger || ledgerResult.data.data?.ledger || ledgerResult.data.data || []);
    if (proposalResult.success) setProposals(proposalResult.data.proposals || proposalResult.data.data?.proposals || proposalResult.data.data || []);
    if (savedWallet?.address) {
      const myResult = await getMyTreasury(savedWallet.address);
      if (myResult.success) setMyTreasury(myResult.data.proposals || myResult.data.data?.proposals || myResult.data.data || []);
    }
    if (!summaryResult.success) setError(summaryResult.error);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const active = proposals.filter((proposal) => proposal.status === "active");
  const history = proposals.filter((proposal) => proposal.status !== "active");
  const treasuryBalance = Number(summary?.current_balance ?? summary?.treasury_balance ?? 0);

  const handleSubmitProposal = async () => {
    setError("");
    setMessage("");
    if (!wallet?.address) return setError("Create a wallet before submitting a treasury proposal.");
    if (!proposalForm.title.trim() || !proposalForm.description.trim() || !proposalForm.recipient_address.trim()) {
      return setError("Enter a title, description, and recipient address.");
    }
    if (Number(proposalForm.requested_amount) <= 0 || Number(proposalForm.requested_amount) > treasuryBalance) {
      return setError("Requested amount must be positive and no more than the current treasury balance.");
    }
    setActionLoading("propose");
    const result = await submitTreasuryProposal({
      proposer_address: wallet.address,
      title: proposalForm.title.trim(),
      category: proposalForm.category,
      description: proposalForm.description.trim(),
      requested_amount: Number(proposalForm.requested_amount),
      recipient_address: proposalForm.recipient_address.trim(),
    });
    if (result.success) {
      setMessage("Treasury proposal submitted for community voting.");
      setProposalForm({ title: "", category: "community", description: "", requested_amount: "", recipient_address: "" });
      setSegment("Active");
      await load();
    } else {
      setError(result.error);
    }
    setActionLoading("");
  };

  const handleVote = async (proposalId, vote) => {
    setError("");
    setMessage("");
    if (!wallet?.address) return setError("Create a wallet before voting on treasury proposals.");
    setActionLoading(`${vote}-${proposalId}`);
    const result = await voteTreasuryProposal({ proposal_id: proposalId, voter_address: wallet.address, vote });
    if (result.success) {
      setMessage(`Treasury ${vote} vote recorded. Vote weight depends on your VLQ balance.`);
      await load();
    } else {
      setError(result.error);
    }
    setActionLoading("");
  };

  return (
    <ScrollView style={sharedStyles.screen} contentContainerStyle={sharedStyles.content}>
      <Text style={sharedStyles.title}>Treasury</Text>
      <Text style={sharedStyles.subtitle}>
        Public treasury tracking for mining reward inflows, voted proposals, pending payouts, and paid records.
      </Text>

      <View style={styles.segmented}>
        {["Overview", "Submit", "Active", "My Treasury", "Ledger", "History"].map((item) => (
          <Pressable key={item} style={[styles.segmentButton, segment === item && styles.segmentButtonActive]} onPress={() => setSegment(item)}>
            <Text style={[styles.segmentText, segment === item && styles.segmentTextActive]}>{item}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? <ActivityIndicator color={theme.accent} /> : null}
      {message ? <Text style={sharedStyles.successText}>{message}</Text> : null}
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

      {segment === "Submit" ? (
        <View style={sharedStyles.card}>
          <Text style={sharedStyles.label}>Submit Treasury Proposal</Text>
          <Text style={sharedStyles.mutedText}>Current treasury balance: {treasuryBalance} VLQ. Requested amount cannot exceed this balance.</Text>
          <Text style={sharedStyles.mutedText}>Proposer: {shortText(wallet?.address, 14, 8)}</Text>
          <TextInput style={sharedStyles.input} placeholder="Title" placeholderTextColor={theme.textSecondary} value={proposalForm.title} onChangeText={(title) => setProposalForm((form) => ({ ...form, title }))} />
          <View style={styles.categoryWrap}>
            {["development", "marketing", "community", "infrastructure", "security", "education", "other"].map((category) => (
              <Pressable key={category} style={[styles.categoryButton, proposalForm.category === category && styles.segmentButtonActive]} onPress={() => setProposalForm((form) => ({ ...form, category }))}>
                <Text style={[styles.segmentText, proposalForm.category === category && styles.segmentTextActive]}>{category}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput multiline style={[sharedStyles.input, sharedStyles.textArea]} placeholder="Description" placeholderTextColor={theme.textSecondary} value={proposalForm.description} onChangeText={(description) => setProposalForm((form) => ({ ...form, description }))} />
          <TextInput keyboardType="decimal-pad" style={sharedStyles.input} placeholder="Requested VLQ amount" placeholderTextColor={theme.textSecondary} value={proposalForm.requested_amount} onChangeText={(requested_amount) => setProposalForm((form) => ({ ...form, requested_amount }))} />
          <TextInput autoCapitalize="none" style={sharedStyles.input} placeholder="Recipient address" placeholderTextColor={theme.textSecondary} value={proposalForm.recipient_address} onChangeText={(recipient_address) => setProposalForm((form) => ({ ...form, recipient_address }))} />
          <Text style={sharedStyles.warningText}>This is community treasury tracking inside Vorliq software, not legal treasury control.</Text>
          <Pressable style={[sharedStyles.button, styles.top]} onPress={handleSubmitProposal} disabled={actionLoading === "propose"}>
            <Text style={sharedStyles.buttonText}>{actionLoading === "propose" ? "Submitting..." : "Submit Proposal"}</Text>
          </Pressable>
        </View>
      ) : null}

      {segment === "Ledger" ? (
        ledger.length ? ledger.map((entry) => <LedgerEntry key={entry.ledger_id || entry.tx_id} entry={entry} navigation={navigation} />) : <Text style={sharedStyles.mutedText}>No ledger entries returned by this node.</Text>
      ) : null}

      {segment === "Active" ? active.map((proposal) => (
        <Proposal
          key={proposal.proposal_id}
          proposal={proposal}
          navigation={navigation}
          wallet={wallet}
          onVote={handleVote}
          actionLoading={actionLoading}
        />
      )) : null}
      {segment === "My Treasury" ? (
        myTreasury.length ? myTreasury.map((proposal) => (
          <Proposal key={proposal.proposal_id} proposal={proposal} navigation={navigation} wallet={wallet} onVote={handleVote} actionLoading={actionLoading} />
        )) : <Text style={sharedStyles.mutedText}>No treasury records for the saved wallet yet.</Text>
      ) : null}
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

function Proposal({ proposal, navigation, wallet, onVote, actionLoading }) {
  const canVote = proposal.status === "active" && wallet?.address;
  return (
    <View style={sharedStyles.card}>
      <View style={[sharedStyles.badge, { backgroundColor: statusColor(proposal.status) }]}>
        <Text style={sharedStyles.badgeText}>{normalizeStatus(proposal.status)}</Text>
      </View>
      <Text style={[sharedStyles.sectionTitle, styles.top]}>{proposal.title}</Text>
      <Text style={sharedStyles.value}>{proposal.description}</Text>
      <Text style={sharedStyles.mutedText}>Requested: {proposal.requested_amount} VLQ</Text>
      <Text style={sharedStyles.mutedText}>Category: {proposal.category}</Text>
      <Text style={sharedStyles.mutedText}>Recipient: {shortText(proposal.recipient_address, 12, 6)}</Text>
      <Text style={sharedStyles.mutedText}>Yes {proposal.yes_vote_weight || 0} | No {proposal.no_vote_weight || 0}</Text>
      {canVote ? (
        <View style={styles.voteRow}>
          <Pressable style={[sharedStyles.button, styles.voteButton]} onPress={() => onVote(proposal.proposal_id, "yes")} disabled={actionLoading === `yes-${proposal.proposal_id}`}>
            <Text style={sharedStyles.buttonText}>{actionLoading === `yes-${proposal.proposal_id}` ? "Voting..." : "Vote Yes"}</Text>
          </Pressable>
          <Pressable style={[sharedStyles.button, sharedStyles.secondaryButton, styles.voteButton]} onPress={() => onVote(proposal.proposal_id, "no")} disabled={actionLoading === `no-${proposal.proposal_id}`}>
            <Text style={sharedStyles.buttonText}>{actionLoading === `no-${proposal.proposal_id}` ? "Voting..." : "Vote No"}</Text>
          </Pressable>
          <Text style={sharedStyles.mutedText}>Vote weight depends on your current VLQ balance.</Text>
        </View>
      ) : null}
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
    flexWrap: "wrap",
    gap: theme.spacing.xs,
    marginVertical: theme.spacing.md,
    padding: theme.spacing.xs,
  },
  segmentButton: {
    alignItems: "center",
    borderRadius: 10,
    flexGrow: 1,
    paddingHorizontal: theme.spacing.sm,
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
  categoryWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.xs,
    marginBottom: theme.spacing.md,
  },
  categoryButton: {
    alignItems: "center",
    borderColor: theme.border,
    borderRadius: 10,
    borderWidth: 1,
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: theme.spacing.sm,
  },
  voteRow: {
    borderTopColor: theme.border,
    borderTopWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
    paddingTop: theme.spacing.md,
  },
  voteButton: {
    flexGrow: 1,
  },
});
