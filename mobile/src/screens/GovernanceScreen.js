import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { getGovernanceProposals, getGovernanceSettings, getGovernanceSummary, getMyGovernance, getRuleChanges, voteGovernanceProposal } from "../api";
import { loadWallet } from "../storage";
import theme from "../theme";
import { formatTimestamp, normalizeStatus, shortText, statusColor } from "../utils/format";
import sharedStyles from "./sharedStyles";

const segments = ["Active", "Vote", "My", "Rule Changes", "Settings"];

export default function GovernanceScreen() {
  const [segment, setSegment] = useState("Active");
  const [wallet, setWallet] = useState(null);
  const [summary, setSummary] = useState(null);
  const [proposals, setProposals] = useState([]);
  const [myGovernance, setMyGovernance] = useState([]);
  const [ruleChanges, setRuleChanges] = useState([]);
  const [settings, setSettings] = useState({});
  const [proposalId, setProposalId] = useState("");
  const [vote, setVote] = useState("yes");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    const savedWallet = await loadWallet();
    setWallet(savedWallet);
    const [summaryResult, proposalsResult, ruleResult, settingsResult, myResult] = await Promise.all([
      getGovernanceSummary(),
      getGovernanceProposals({ limit: 50 }),
      getRuleChanges(),
      getGovernanceSettings(),
      savedWallet?.address ? getMyGovernance(savedWallet.address) : Promise.resolve({ success: true, data: { proposals: [] } }),
    ]);
    if (summaryResult.success) setSummary(summaryResult.data.summary || summaryResult.data.data?.summary || summaryResult.data);
    if (proposalsResult.success) setProposals(proposalsResult.data.proposals || proposalsResult.data.data?.proposals || proposalsResult.data.data || []);
    if (ruleResult.success) setRuleChanges(ruleResult.data.rule_changes || ruleResult.data.data?.rule_changes || ruleResult.data.data || []);
    if (settingsResult.success) setSettings(settingsResult.data.settings || settingsResult.data.data?.settings || {});
    if (myResult.success) setMyGovernance(myResult.data.proposals || myResult.data.votes || myResult.data.data?.proposals || myResult.data.data || []);
    if (!proposalsResult.success) setError(proposalsResult.error);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleVote = async () => {
    setError("");
    setMessage("");
    if (!wallet?.address) return setError("Create a wallet before voting.");
    if (!proposalId.trim()) return setError("Enter a proposal ID.");
    const result = await voteGovernanceProposal({ proposal_id: proposalId.trim(), voter_address: wallet.address, voter_wallet_address: wallet.address, vote });
    if (result.success) {
      setMessage("Vote cast.");
      setProposalId("");
      await loadData();
    } else {
      setError(result.error);
    }
  };

  return (
    <ScrollView style={sharedStyles.screen} contentContainerStyle={sharedStyles.content}>
      <Text style={sharedStyles.title}>Governance</Text>
      <Text style={sharedStyles.subtitle}>
        Community rule-setting inside Vorliq software. Passed proposals are tracked separately from executed rule changes.
      </Text>

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.label}>Summary</Text>
        <Text style={sharedStyles.value}>Active: {summary?.active_count ?? 0}</Text>
        <Text style={sharedStyles.value}>Pending execution: {summary?.passed_pending_execution_count ?? 0}</Text>
        <Text style={sharedStyles.mutedText}>Executed: {summary?.executed_count ?? 0} | Total votes: {summary?.total_votes ?? 0}</Text>
      </View>

      <View style={styles.segmented}>
        {segments.map((item) => (
          <Pressable key={item} style={[styles.segmentButton, segment === item && styles.segmentButtonActive]} onPress={() => setSegment(item)}>
            <Text style={[styles.segmentText, segment === item && styles.segmentTextActive]}>{item}</Text>
          </Pressable>
        ))}
      </View>

      {message ? <Text style={sharedStyles.successText}>{message}</Text> : null}
      {error ? <Text style={sharedStyles.errorText}>{error}</Text> : null}
      {loading ? <ActivityIndicator color={theme.accent} /> : null}

      {segment === "Active" ? proposals.filter((proposal) => proposal.status === "active").map((proposal) => <Proposal key={proposal.proposal_id} proposal={proposal} />) : null}
      {segment === "Vote" ? (
        <View style={sharedStyles.card}>
          <Text style={sharedStyles.label}>Vote</Text>
          <TextInput autoCapitalize="none" style={sharedStyles.input} placeholder="Proposal ID" placeholderTextColor={theme.textSecondary} value={proposalId} onChangeText={setProposalId} />
          <View style={styles.voteToggle}>
            {["yes", "no"].map((choice) => (
              <Pressable key={choice} style={[styles.voteButton, vote === choice && styles.segmentButtonActive]} onPress={() => setVote(choice)}>
                <Text style={[styles.segmentText, vote === choice && styles.segmentTextActive]}>{choice.toUpperCase()}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable style={sharedStyles.button} onPress={handleVote}>
            <Text style={sharedStyles.buttonText}>Cast Vote</Text>
          </Pressable>
          <Text style={[sharedStyles.mutedText, styles.top]}>Governance votes are weighted by VLQ balance returned by the network.</Text>
        </View>
      ) : null}
      {segment === "My" ? (myGovernance.length ? myGovernance.map((proposal) => <Proposal key={proposal.proposal_id || proposal.vote_id} proposal={proposal} />) : <Text style={sharedStyles.mutedText}>No governance records for this wallet yet.</Text>) : null}
      {segment === "Rule Changes" ? (
        ruleChanges.length ? ruleChanges.map((change) => (
          <View style={sharedStyles.card} key={change.rule_change_id || change.proposal_id}>
            <Text style={sharedStyles.label}>{change.category}</Text>
            <Text style={sharedStyles.value}>{String(change.old_value)} -> {String(change.new_value)}</Text>
            <Text style={sharedStyles.mutedText}>Applied {formatTimestamp(change.applied_at)} at block {change.applied_block_height ?? "unknown"}</Text>
            <Text style={sharedStyles.mutedText}>Proposal: {shortText(change.proposal_id, 12, 6)}</Text>
          </View>
        )) : <Text style={sharedStyles.mutedText}>No rule changes returned by this node.</Text>
      ) : null}
      {segment === "Settings" ? Object.entries(settings).map(([key, value]) => (
        <View style={sharedStyles.card} key={key}>
          <Text style={sharedStyles.label}>{key.replace(/_/g, " ")}</Text>
          <Text style={sharedStyles.value}>{String(value.current ?? value)}</Text>
          {value.default !== undefined ? <Text style={sharedStyles.mutedText}>Default: {String(value.default)}</Text> : null}
        </View>
      )) : null}
    </ScrollView>
  );
}

function Proposal({ proposal }) {
  const yes = Number(proposal.yes_vote_weight || 0);
  const no = Number(proposal.no_vote_weight || 0);
  const total = Math.max(yes + no, 1);
  return (
    <View style={sharedStyles.card}>
      <View style={[sharedStyles.badge, { backgroundColor: statusColor(proposal.status) }]}>
        <Text style={sharedStyles.badgeText}>{normalizeStatus(proposal.status)}</Text>
      </View>
      <Text style={[sharedStyles.sectionTitle, styles.top]}>{proposal.title || proposal.proposal_id}</Text>
      <Text style={sharedStyles.value}>{proposal.description}</Text>
      <Text style={sharedStyles.mutedText}>Proposer: {shortText(proposal.proposer_address, 12, 6)}</Text>
      <Text style={sharedStyles.mutedText}>Category: {proposal.category || "general"}</Text>
      <View style={styles.progressWrap}>
        <View style={[styles.yesBar, { flex: yes / total }]} />
        <View style={[styles.noBar, { flex: no / total }]} />
      </View>
      <Text style={sharedStyles.mutedText}>Yes {yes} | No {no}</Text>
      <Text style={sharedStyles.mutedText}>Deadline {formatTimestamp(proposal.voting_deadline)}</Text>
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
    minHeight: 42,
    justifyContent: "center",
    paddingHorizontal: theme.spacing.sm,
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
  voteToggle: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  voteButton: {
    alignItems: "center",
    borderColor: theme.border,
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    minHeight: 46,
    justifyContent: "center",
  },
  progressWrap: {
    backgroundColor: theme.input,
    borderRadius: 999,
    flexDirection: "row",
    height: 12,
    marginTop: theme.spacing.md,
    overflow: "hidden",
  },
  yesBar: {
    backgroundColor: theme.success,
  },
  noBar: {
    backgroundColor: theme.error,
  },
  top: {
    marginTop: theme.spacing.md,
  },
});
