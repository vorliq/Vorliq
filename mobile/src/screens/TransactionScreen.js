import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { getTransaction } from "../api";
import IdDisplay from "../components/IdDisplay";
import theme from "../theme";
import { formatTimestamp, normalizeStatus, statusColor } from "../utils/format";
import sharedStyles from "./sharedStyles";

export default function TransactionScreen({ navigation, route }) {
  const [txId, setTxId] = useState(route?.params?.txId || "");
  const [transaction, setTransaction] = useState(null);
  const [showRaw, setShowRaw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async (target = txId) => {
    setError("");
    if (!target.trim()) {
      setError("Enter a transaction ID.");
      return;
    }
    setLoading(true);
    const result = await getTransaction(target.trim());
    if (result.success) {
      setTransaction(result.data.transaction || result.data.data?.transaction || result.data);
    } else {
      setTransaction(null);
      setError(result.error || "Transaction not found. Check the full transaction ID and try again.");
    }
    setLoading(false);
  };

  useEffect(() => {
    if (route?.params?.txId) {
      load(route.params.txId);
    }
  }, [route?.params?.txId]);

  return (
    <ScrollView style={sharedStyles.screen} contentContainerStyle={sharedStyles.content}>
      <Text style={sharedStyles.title}>Transaction</Text>
      <Text style={sharedStyles.subtitle}>Inspect pending or confirmed VLQ transaction state.</Text>

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.label}>Transaction ID</Text>
        <TextInput autoCapitalize="none" style={sharedStyles.input} value={txId} onChangeText={setTxId} placeholder="tx id" placeholderTextColor={theme.textSecondary} />
        <Pressable style={sharedStyles.button} onPress={() => load(txId)}>
          <Text style={sharedStyles.buttonText}>Load Transaction</Text>
        </Pressable>
      </View>

      {loading ? <ActivityIndicator color={theme.accent} /> : null}
      {error ? <Text style={sharedStyles.errorText}>{error}</Text> : null}

      {transaction ? (
        <View style={sharedStyles.card}>
          <View style={[sharedStyles.badge, { backgroundColor: statusColor(transaction.status) }]}>
            <Text style={sharedStyles.badgeText}>{normalizeStatus(transaction.status || "unknown")}</Text>
          </View>
          <Text style={[sharedStyles.label, styles.top]}>Amount</Text>
          <Text style={sharedStyles.value}>{transaction.amount ?? 0} VLQ</Text>
          <IdDisplay label="Transaction ID" value={transaction.tx_id || txId} copyLabel="Copy Tx ID" />
          <IdDisplay label="Sender" value={transaction.sender || transaction.sender_address} copyLabel="Copy Sender" />
          <IdDisplay label="Recipient" value={transaction.recipient || transaction.receiver_address} copyLabel="Copy Recipient" />
          <IdDisplay label="Block Hash" value={transaction.block_hash} copyLabel="Copy Block Hash" />
          <Text style={sharedStyles.label}>Type</Text>
          <Text style={sharedStyles.value}>{transaction.type || transaction.category || "transfer"}</Text>
          <Text style={sharedStyles.label}>Timestamp</Text>
          <Text style={sharedStyles.value}>{formatTimestamp(transaction.timestamp)}</Text>
          <Text style={sharedStyles.label}>Confirmations</Text>
          <Text style={sharedStyles.value}>{transaction.confirmations ?? 0}</Text>
          {(transaction.status || "").toLowerCase() === "pending" ? (
            <Text style={[sharedStyles.errorText, styles.top]}>
              This transaction is pending until a miner includes it in a valid block. It is not final yet.
            </Text>
          ) : null}
          {transaction.block_index !== undefined && transaction.block_index !== null ? (
            <Pressable style={[sharedStyles.button, styles.top]} onPress={() => navigation.navigate("Block", { blockId: String(transaction.block_index) })}>
              <Text style={sharedStyles.buttonText}>Open Block #{transaction.block_index}</Text>
            </Pressable>
          ) : null}
          <Text style={[sharedStyles.mutedText, styles.top]}>
            Signature present: {transaction.signature_present ? "Yes" : "No"} | Public key present: {transaction.public_key_present ? "Yes" : "No"}
          </Text>
          <Pressable style={[sharedStyles.button, sharedStyles.secondaryButton, styles.top]} onPress={() => setShowRaw((current) => !current)}>
            <Text style={sharedStyles.buttonText}>{showRaw ? "Hide Safe JSON" : "Show Safe JSON"}</Text>
          </Pressable>
          {showRaw ? <Text style={[sharedStyles.codeText, styles.raw]}>{JSON.stringify(transaction, null, 2)}</Text> : null}
        </View>
      ) : null}

      {!loading && !transaction && error ? (
        <View style={sharedStyles.card}>
          <Text style={sharedStyles.label}>Transaction not found</Text>
          <Text style={sharedStyles.mutedText}>No pending or confirmed transaction matched that ID.</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  top: {
    marginTop: theme.spacing.md,
  },
  raw: {
    marginTop: theme.spacing.md,
  },
});
