import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { getBalance, getLoans, submitLoan, voteLoan } from "../api";
import { loadWallet } from "../storage";
import theme from "../theme";
import sharedStyles from "./sharedStyles";

function shortAddress(address) {
  if (!address) return "";
  return address.length > 12 ? `${address.slice(0, 12)}...` : address;
}

function statusColor(status) {
  if (status === "approved") return theme.success;
  if (status === "rejected") return theme.error;
  if (status === "repaid") return theme.accent;
  return theme.warning;
}

function normalizeLoans(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.loans)) return raw.loans;
  if (Array.isArray(raw?.data)) return raw.data;
  return [];
}

export default function LendingScreen() {
  const [activeSegment, setActiveSegment] = useState("Loans");
  const [wallet, setWallet] = useState(null);
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [loanId, setLoanId] = useState("");
  const [vote, setVote] = useState("yes");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    setError("");
    const savedWallet = await loadWallet();
    setWallet(savedWallet);
    const result = await getLoans();

    if (result.success) {
      setLoans(normalizeLoans(result.data));
    } else {
      setError(result.error);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRequestLoan = async () => {
    setError("");
    setMessage("");

    if (!wallet?.address) {
      setError("Create a wallet before requesting a loan.");
      return;
    }

    if (Number(amount) <= 0 || Number(amount) > 10000 || !reason.trim()) {
      setError("Enter a reason and an amount from 1 to 10000 VLQ.");
      return;
    }

    const result = await submitLoan({
      requester_address: wallet.address,
      amount: Number(amount),
      reason: reason.trim(),
    });

    if (result.success) {
      setMessage(`Loan request submitted: ${result.data.loan_id || result.data.loan?.loan_id || "created"}`);
      setAmount("");
      setReason("");
      await loadData();
      setActiveSegment("Loans");
    } else {
      setError(result.error);
    }
  };

  const handleVote = async () => {
    setError("");
    setMessage("");

    if (!wallet?.address) {
      setError("Create a wallet before voting on loans.");
      return;
    }

    if (!loanId.trim()) {
      setError("Enter a loan ID.");
      return;
    }

    const balanceResult = await getBalance(wallet.address);
    if (!balanceResult.success) {
      setError(balanceResult.error);
      return;
    }

    const voterBalance = Number(balanceResult.data?.balance ?? balanceResult.data?.data?.balance ?? 0);
    const result = await voteLoan({
      loan_id: loanId.trim(),
      voter_address: wallet.address,
      voter_wallet_address: wallet.address,
      voter_balance: voterBalance,
      vote,
    });

    if (result.success) {
      setMessage("Vote cast successfully.");
      setLoanId("");
      await loadData();
      setActiveSegment("Loans");
    } else {
      setError(result.error);
    }
  };

  const activeLoans = useMemo(() => loans.filter((loan) => loan.status !== "repaid"), [loans]);

  const renderSegment = () => {
    if (activeSegment === "Request") {
      return (
        <View style={sharedStyles.card}>
          <Text style={sharedStyles.label}>Amount</Text>
          <TextInput
            keyboardType="decimal-pad"
            maxLength={8}
            style={sharedStyles.input}
            placeholder="500"
            placeholderTextColor={theme.textSecondary}
            value={amount}
            onChangeText={setAmount}
          />
          <Text style={sharedStyles.label}>Reason</Text>
          <TextInput
            multiline
            style={[sharedStyles.input, sharedStyles.textArea]}
            placeholder="Tell the community why this loan matters"
            placeholderTextColor={theme.textSecondary}
            value={reason}
            onChangeText={setReason}
          />
          <Pressable style={sharedStyles.button} onPress={handleRequestLoan}>
            <Text style={sharedStyles.buttonText}>Submit</Text>
          </Pressable>
        </View>
      );
    }

    if (activeSegment === "Vote") {
      return (
        <View style={sharedStyles.card}>
          <Text style={sharedStyles.label}>Loan ID</Text>
          <TextInput
            autoCapitalize="none"
            style={sharedStyles.input}
            placeholder="Paste loan ID"
            placeholderTextColor={theme.textSecondary}
            value={loanId}
            onChangeText={setLoanId}
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
        </View>
      );
    }

    return activeLoans.map((loan) => {
      const yesWeight = Number(loan.yes_vote_weight || 0);
      const noWeight = Number(loan.no_vote_weight || 0);
      const total = Math.max(yesWeight + noWeight, 1);

      return (
        <View style={sharedStyles.card} key={loan.loan_id}>
          <View style={styles.loanHeader}>
            <Text style={styles.loanAmount}>{loan.amount} VLQ</Text>
            <View style={[sharedStyles.badge, { backgroundColor: statusColor(loan.status) }]}>
              <Text style={sharedStyles.badgeText}>{loan.status}</Text>
            </View>
          </View>
          <Text style={sharedStyles.label}>Requester</Text>
          <Text style={sharedStyles.value}>{shortAddress(loan.requester_address)}</Text>
          <Text style={[sharedStyles.label, styles.marginTop]}>Reason</Text>
          <Text style={sharedStyles.value}>{loan.reason}</Text>
          <View style={styles.progressWrap}>
            <View style={[styles.yesBar, { flex: yesWeight / total }]} />
            <View style={[styles.noBar, { flex: noWeight / total }]} />
          </View>
          <Text style={sharedStyles.mutedText}>Yes {yesWeight} VLQ | No {noWeight} VLQ</Text>
        </View>
      );
    });
  };

  return (
    <ScrollView style={sharedStyles.screen} contentContainerStyle={sharedStyles.content}>
      <Text style={sharedStyles.title}>Lending</Text>
      <Text style={sharedStyles.subtitle}>Request community-backed VLQ loans and vote using your wallet balance.</Text>

      <View style={styles.segmented}>
        {["Loans", "Request", "Vote"].map((segment) => (
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

      {loading ? <ActivityIndicator size="large" color={theme.accent} /> : renderSegment()}
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
  loanHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: theme.spacing.md,
  },
  loanAmount: {
    color: theme.text,
    fontSize: theme.fonts.heading,
    fontWeight: "800",
  },
  marginTop: {
    marginTop: theme.spacing.md,
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
});
