import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { getBalance, getLendingSummary, getLoans, getMyLoans, repayLoan, submitLoan, voteLoan } from "../api";
import IdDisplay from "../components/IdDisplay";
import { loadWallet } from "../storage";
import theme from "../theme";
import { normalizeStatus, statusColor } from "../utils/format";
import sharedStyles from "./sharedStyles";

const segments = ["Active Votes", "Active Loans", "My Loans", "History", "Request"];

export default function LendingScreen({ navigation }) {
  const [segment, setSegment] = useState("Active Votes");
  const [wallet, setWallet] = useState(null);
  const [summary, setSummary] = useState(null);
  const [loans, setLoans] = useState([]);
  const [myLoans, setMyLoans] = useState([]);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [loanId, setLoanId] = useState("");
  const [vote, setVote] = useState("yes");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [repayTarget, setRepayTarget] = useState(null);
  const [repaying, setRepaying] = useState(false);
  const [lastRepaymentTxId, setLastRepaymentTxId] = useState("");

  const loadData = useCallback(async () => {
    setError("");
    const savedWallet = await loadWallet();
    setWallet(savedWallet);
    const [summaryResult, loansResult, myResult] = await Promise.all([
      getLendingSummary(),
      getLoans({ limit: 50 }),
      savedWallet?.address ? getMyLoans(savedWallet.address) : Promise.resolve({ success: true, data: { loans: [] } }),
    ]);
    if (summaryResult.success) setSummary(summaryResult.data.summary || summaryResult.data.data?.summary || summaryResult.data);
    if (loansResult.success) setLoans(loansResult.data.loans || loansResult.data.data?.loans || loansResult.data.data || []);
    if (myResult.success) setMyLoans(myResult.data.loans || myResult.data.data?.loans || myResult.data.data || []);
    if (!loansResult.success) setError(loansResult.error);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRequestLoan = async () => {
    setError("");
    setMessage("");
    if (!wallet?.address) return setError("Create a wallet before requesting a loan.");
    if (Number(amount) <= 0 || !reason.trim()) return setError("Enter a positive amount and a reason.");
    const result = await submitLoan({ requester_address: wallet.address, amount: Number(amount), reason: reason.trim() });
    if (result.success) {
      setMessage("Loan request submitted for community voting.");
      setAmount("");
      setReason("");
      setSegment("Active Votes");
      await loadData();
    } else {
      setError(result.error);
    }
  };

  const handleVote = async () => {
    setError("");
    setMessage("");
    if (!wallet?.address) return setError("Create a wallet before voting.");
    if (!loanId.trim()) return setError("Enter a loan ID.");
    const balanceResult = await getBalance(wallet.address);
    const voterBalance = Number(balanceResult.data?.balance ?? balanceResult.data?.data?.balance ?? 0);
    const result = await voteLoan({ loan_id: loanId.trim(), voter_address: wallet.address, voter_wallet_address: wallet.address, voter_balance: voterBalance, vote });
    if (result.success) {
      setMessage("Vote cast.");
      setLoanId("");
      await loadData();
    } else {
      setError(result.error);
    }
  };

  const handleRepayLoan = async () => {
    if (!repayTarget || !wallet?.address) return;
    setError("");
    setMessage("");
    setRepaying(true);
    const result = await repayLoan({
      loan_id: repayTarget.loan_id,
      repayer_address: wallet.address,
    });
    if (result.success) {
      const txId = result.data.repayment_tx_id || result.data.loan?.repayment_tx_id || result.data.data?.repayment_tx_id;
      setLastRepaymentTxId(txId || "");
      setMessage(txId ? `Repayment submitted. Transaction ${txId} is pending until mined.` : "Repayment submitted and waiting for mining confirmation.");
      setRepayTarget(null);
      await loadData();
      setSegment("My Loans");
    } else {
      setError(result.error);
    }
    setRepaying(false);
  };

  const visibleLoans =
    segment === "Active Votes"
      ? loans.filter((loan) => ["pending_vote", "pending"].includes(loan.status))
      : segment === "Active Loans"
        ? loans.filter((loan) => ["active", "approved_pending_issue", "repayment_pending", "overdue"].includes(loan.status))
        : segment === "My Loans"
          ? myLoans
          : loans.filter((loan) => ["repaid", "rejected", "expired"].includes(loan.status));

  return (
    <ScrollView style={sharedStyles.screen} contentContainerStyle={sharedStyles.content}>
      <Text style={sharedStyles.title}>Lending</Text>
      <Text style={sharedStyles.subtitle}>
        Community-governed loan requests with voting, issuance tracking, repayment state, and overdue visibility.
      </Text>

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.label}>Summary</Text>
        <Text style={sharedStyles.value}>Pending votes: {summary?.pending_vote_count ?? 0}</Text>
        <Text style={sharedStyles.value}>Active loans: {summary?.active_count ?? 0}</Text>
        <Text style={sharedStyles.mutedText}>Overdue: {summary?.overdue_count ?? 0} | Repaid: {summary?.repaid_count ?? 0}</Text>
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
      {lastRepaymentTxId ? (
        <Pressable style={[sharedStyles.button, sharedStyles.secondaryButton, styles.top]} onPress={() => navigation.navigate("Transaction", { txId: lastRepaymentTxId })}>
          <Text style={sharedStyles.buttonText}>Open Repayment Transaction</Text>
        </Pressable>
      ) : null}

      {repayTarget ? (
        <View style={sharedStyles.card}>
          <Text style={sharedStyles.label}>Confirm Loan Repayment</Text>
          <IdDisplay label="Loan ID" value={repayTarget.loan_id} copyLabel="Copy Loan ID" />
          <Text style={sharedStyles.value}>Repayment amount: {repayTarget.repayment_amount ?? "?"} VLQ</Text>
          <IdDisplay label="Borrower Wallet" value={wallet?.address} copyLabel="Copy Borrower" />
          <Text style={sharedStyles.mutedText}>Current status: {normalizeStatus(repayTarget.status)}</Text>
          <Text style={sharedStyles.warningText}>
            Repayment creates a pending blockchain transaction and is only confirmed after mining.
          </Text>
          <View style={styles.actionRow}>
            <Pressable style={[sharedStyles.button, styles.actionButton]} onPress={handleRepayLoan} disabled={repaying}>
              <Text style={sharedStyles.buttonText}>{repaying ? "Submitting..." : "Submit Repayment"}</Text>
            </Pressable>
            <Pressable style={[sharedStyles.button, sharedStyles.secondaryButton, styles.actionButton]} onPress={() => setRepayTarget(null)} disabled={repaying}>
              <Text style={sharedStyles.buttonText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {loading ? <ActivityIndicator color={theme.accent} /> : null}

      {segment === "Request" ? (
        <View style={sharedStyles.card}>
          <Text style={sharedStyles.label}>Amount</Text>
          <TextInput keyboardType="decimal-pad" style={sharedStyles.input} placeholder="500" placeholderTextColor={theme.textSecondary} value={amount} onChangeText={setAmount} />
          <Text style={sharedStyles.label}>Reason</Text>
          <TextInput multiline style={[sharedStyles.input, sharedStyles.textArea]} placeholder="Tell the community why this loan matters" placeholderTextColor={theme.textSecondary} value={reason} onChangeText={setReason} />
          <Text style={sharedStyles.mutedText}>Approval does not mean instant confirmed funds. Loan issuance is a pending transaction until mined.</Text>
          <Pressable style={[sharedStyles.button, styles.top]} onPress={handleRequestLoan}>
            <Text style={sharedStyles.buttonText}>Submit Request</Text>
          </Pressable>
        </View>
      ) : (
        <>
          {segment === "Active Votes" ? (
            <View style={sharedStyles.card}>
              <Text style={sharedStyles.label}>Cast Vote</Text>
              <TextInput autoCapitalize="none" style={sharedStyles.input} placeholder="Loan ID" placeholderTextColor={theme.textSecondary} value={loanId} onChangeText={setLoanId} />
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
            </View>
          ) : null}
          {visibleLoans.length ? visibleLoans.map((loan) => (
            <LoanCard
              key={loan.loan_id}
              loan={loan}
              navigation={navigation}
              wallet={wallet}
              onRepay={() => setRepayTarget(loan)}
            />
          )) : <Text style={sharedStyles.mutedText}>No loans returned for this view.</Text>}
        </>
      )}
    </ScrollView>
  );
}

function LoanCard({ loan, navigation, wallet, onRepay }) {
  const borrowerAddress = loan.borrower || loan.requester_address;
  const canRepay = wallet?.address && wallet.address === borrowerAddress && ["active", "overdue"].includes(loan.status);
  return (
    <View style={sharedStyles.card}>
      <View style={[sharedStyles.badge, { backgroundColor: statusColor(loan.status) }]}>
        <Text style={sharedStyles.badgeText}>{normalizeStatus(loan.status)}</Text>
      </View>
      <Text style={[sharedStyles.sectionTitle, styles.top]}>{loan.amount} VLQ</Text>
      <Text style={sharedStyles.mutedText}>Repayment: {loan.repayment_amount ?? "?"} VLQ</Text>
      <IdDisplay label="Borrower" value={loan.borrower || loan.requester_address} copyLabel="Copy Borrower" start={12} end={6} />
      <Text style={sharedStyles.value}>{loan.reason}</Text>
      <Text style={sharedStyles.mutedText}>Yes {loan.yes_vote_weight || 0} | No {loan.no_vote_weight || 0}</Text>
      <Text style={sharedStyles.mutedText}>Due block: {loan.due_block ?? "Not active"} | Blocks left: {loan.blocks_until_due ?? "n/a"}</Text>
      {loan.issuance_tx_id ? <TxButton txId={loan.issuance_tx_id} label="Issuance Tx" navigation={navigation} /> : null}
      {loan.repayment_tx_id ? <TxButton txId={loan.repayment_tx_id} label="Repayment Tx" navigation={navigation} /> : null}
      {canRepay ? (
        <Pressable style={[sharedStyles.button, styles.top]} onPress={onRepay}>
          <Text style={sharedStyles.buttonText}>Repay Loan</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function TxButton({ txId, label, navigation }) {
  return (
    <Pressable style={[sharedStyles.button, sharedStyles.secondaryButton, styles.top]} onPress={() => navigation.navigate("Transaction", { txId })}>
      <Text style={sharedStyles.buttonText}>{label}</Text>
    </Pressable>
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
    minHeight: 42,
    justifyContent: "center",
    paddingHorizontal: theme.spacing.sm,
    flexGrow: 1,
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
  top: {
    marginTop: theme.spacing.md,
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  actionButton: {
    flexGrow: 1,
  },
});
