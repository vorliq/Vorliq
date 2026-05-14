import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  getGovernanceProposals,
  getGovernanceSettings,
  voteGovernanceProposal,
} from "../api";
import { loadWallet } from "../storage";
import theme from "../theme";
import sharedStyles from "./sharedStyles";

function normalizeProposals(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.proposals)) return raw.proposals;
  if (Array.isArray(raw?.data)) return raw.data;
  return [];
}

function categoryLabel(category) {
  return String(category || "").replace(/_/g, " ");
}

export default function GovernanceScreen() {
  const [activeSegment, setActiveSegment] = useState("Proposals");
  const [wallet, setWallet] = useState(null);
  const [proposals, setProposals] = useState([]);
  const [settings, setSettings] = useState({});
  const [proposalId, setProposalId] = useState("");
  const [voterAddress, setVoterAddress] = useState("");
  const [vote, setVote] = useState("yes");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    setError("");
    const savedWallet = await loadWallet();
    setWallet(savedWallet);
    setVoterAddress(savedWallet?.address || "");

    const [proposalResult, settingsResult] = await Promise.all([
      getGovernanceProposals(),
      getGovernanceSettings(),
    ]);

    if (proposalResult.success) {
      setProposals(normalizeProposals(proposalResult.data));
    } else {
      setError(proposalResult.error);
    }

    if (settingsResult.success) {
      setSettings(settingsResult.data.settings || {});
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleVote = async () => {
    setError("");
    setMessage("");

    if (!proposalId.trim() || !voterAddress.trim()) {
      setError("Enter a proposal ID and voter wallet address.");
      return;
    }

    const result = await voteGovernanceProposal({
      proposal_id: proposalId.trim(),
      voter_address: voterAddress.trim(),
      voter_wallet_address: voterAddress.trim(),
      vote,
    });

    if (result.success) {
      setMessage("Vote cast successfully.");
      setProposalId("");
      await loadData();
      setActiveSegment("Proposals");
    } else {
      setError(result.error);
    }
  };

  const renderProposals = () => {
    if (proposals.length === 0) {
      return <Text style={sharedStyles.mutedText}>No active governance proposals right now.</Text>;
    }

    return proposals.map((proposal) => {
      const yesWeight = Number(proposal.yes_vote_weight || 0);
      const noWeight = Number(proposal.no_vote_weight || 0);
      const total = Math.max(yesWeight + noWeight, 1);

      return (
        <View style={sharedStyles.card} key={proposal.proposal_id}>
          <View style={styles.headerRow}>
            <Text style={styles.proposalTitle}>{proposal.title}</Text>
            <View style={sharedStyles.badge}>
              <Text style={sharedStyles.badgeText}>{categoryLabel(proposal.category)}</Text>
            </View>
          </View>
          <Text style={sharedStyles.value}>{proposal.description}</Text>
          <View style={styles.progressWrap}>
            <View style={[styles.yesBar, { flex: yesWeight / total }]} />
            <View style={[styles.noBar, { flex: noWeight / total }]} />
          </View>
          <Text style={sharedStyles.mutedText}>Yes {yesWeight} VLQ | No {noWeight} VLQ</Text>
          <Text style={sharedStyles.mutedText}>
            Deadline {new Date(proposal.voting_deadline * 1000).toLocaleString()}
          </Text>
        </View>
      );
    });
  };

  const renderVote = () => (
    <View style={sharedStyles.card}>
      <Text style={sharedStyles.label}>Proposal ID</Text>
      <TextInput
        autoCapitalize="none"
        style={sharedStyles.input}
        placeholder="Paste proposal ID"
        placeholderTextColor={theme.textSecondary}
        value={proposalId}
        onChangeText={setProposalId}
      />
      <Text style={sharedStyles.label}>Voter Wallet Address</Text>
      <TextInput
        autoCapitalize="none"
        style={sharedStyles.input}
        value={voterAddress}
        onChangeText={setVoterAddress}
      />
      <View style={styles.voteToggle}>
        {["yes", "no"].map((choice) => (
          <Pressable
            key={choice}
            style={[styles.voteButton, vote === choice && styles.voteButtonActive]}
            onPress={() => setVote(choice)}
          >
            <Text style={[styles.voteText, vote === choice && styles.voteTextActive]}>{choice.toUpperCase()}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable style={sharedStyles.button} onPress={handleVote}>
        <Text style={sharedStyles.buttonText}>Cast Vote</Text>
      </Pressable>
      {!wallet ? <Text style={[sharedStyles.warningText, styles.marginTop]}>Create a wallet to vote with your VLQ balance.</Text> : null}
    </View>
  );

  const renderSettings = () => (
    <View>
      {Object.entries(settings).map(([key, value]) => (
        <View style={sharedStyles.card} key={key}>
          <Text style={sharedStyles.label}>{categoryLabel(key)}</Text>
          <Text style={styles.settingValue}>{String(value.current)}</Text>
          <Text style={sharedStyles.mutedText}>Default: {String(value.default)}</Text>
        </View>
      ))}
    </View>
  );

  return (
    <ScrollView style={sharedStyles.screen} contentContainerStyle={sharedStyles.content}>
      <Text style={sharedStyles.title}>Governance</Text>
      <Text style={sharedStyles.subtitle}>Vote on Vorliq network rules with your VLQ balance.</Text>

      <View style={styles.segmented}>
        {["Proposals", "Vote", "Settings"].map((segment) => (
          <Pressable
            key={segment}
            style={[styles.segmentButton, activeSegment === segment && styles.segmentButtonActive]}
            onPress={() => setActiveSegment(segment)}
          >
            <Text style={[styles.segmentText, activeSegment === segment && styles.segmentTextActive]}>{segment}</Text>
          </Pressable>
        ))}
      </View>

      {message ? <Text style={sharedStyles.successText}>{message}</Text> : null}
      {error ? <Text style={sharedStyles.errorText}>{error}</Text> : null}

      {loading ? (
        <ActivityIndicator size="large" color={theme.accent} />
      ) : (
        <>
          {activeSegment === "Proposals" && renderProposals()}
          {activeSegment === "Vote" && renderVote()}
          {activeSegment === "Settings" && renderSettings()}
        </>
      )}
    </ScrollView>
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
    color: theme.text,
  },
  headerRow: {
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  proposalTitle: {
    color: theme.text,
    fontSize: theme.fonts.heading,
    fontWeight: "800",
  },
  progressWrap: {
    backgroundColor: "#111122",
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
  voteToggle: {
    flexDirection: "row",
    marginBottom: theme.spacing.md,
  },
  voteButton: {
    alignItems: "center",
    borderColor: theme.border,
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    marginRight: theme.spacing.sm,
    minHeight: 50,
    justifyContent: "center",
  },
  voteButtonActive: {
    backgroundColor: theme.accent,
  },
  voteText: {
    color: theme.textSecondary,
    fontWeight: "800",
  },
  voteTextActive: {
    color: theme.text,
  },
  settingValue: {
    color: theme.accent,
    fontSize: theme.fonts.heading,
    fontWeight: "800",
  },
  marginTop: {
    marginTop: theme.spacing.md,
  },
});
