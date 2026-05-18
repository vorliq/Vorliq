import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { getBlock } from "../api";
import theme from "../theme";
import { formatTimestamp, shortText } from "../utils/format";
import sharedStyles from "./sharedStyles";

export default function BlockScreen({ navigation, route }) {
  const [blockId, setBlockId] = useState(route?.params?.blockId || "0");
  const [block, setBlock] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async (target = blockId) => {
    setError("");
    setLoading(true);
    const result = await getBlock(target);
    if (result.success) {
      setBlock(result.data.block || result.data.data?.block || result.data);
    } else {
      setBlock(null);
      setError(result.error);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (route?.params?.blockId) load(route.params.blockId);
  }, [route?.params?.blockId]);

  return (
    <ScrollView style={sharedStyles.screen} contentContainerStyle={sharedStyles.content}>
      <Text style={sharedStyles.title}>Block</Text>
      <Text style={sharedStyles.subtitle}>View block metadata and included transactions.</Text>

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.label}>Block Index or Hash</Text>
        <TextInput autoCapitalize="none" style={sharedStyles.input} value={blockId} onChangeText={setBlockId} placeholder="0 or block hash" placeholderTextColor={theme.textSecondary} />
        <Pressable style={sharedStyles.button} onPress={() => load(blockId)}>
          <Text style={sharedStyles.buttonText}>Load Block</Text>
        </Pressable>
      </View>

      {loading ? <ActivityIndicator color={theme.accent} /> : null}
      {error ? <Text style={sharedStyles.errorText}>{error}</Text> : null}

      {block ? (
        <View style={sharedStyles.card}>
          <Text style={sharedStyles.label}>Index</Text>
          <Text style={sharedStyles.value}>#{block.index}</Text>
          <Text style={sharedStyles.label}>Hash</Text>
          <Text style={sharedStyles.codeText}>{shortText(block.hash, 16, 10)}</Text>
          <Text style={sharedStyles.label}>Previous Hash</Text>
          <Text style={sharedStyles.codeText}>{shortText(block.previous_hash, 16, 10)}</Text>
          <Text style={sharedStyles.label}>Timestamp</Text>
          <Text style={sharedStyles.value}>{formatTimestamp(block.timestamp)}</Text>
          <Text style={sharedStyles.label}>Nonce</Text>
          <Text style={sharedStyles.value}>{block.nonce ?? "Unknown"}</Text>
          <Text style={sharedStyles.label}>Transactions</Text>
          <Text style={sharedStyles.value}>{block.transaction_count ?? block.transactions?.length ?? 0}</Text>
          <Text style={sharedStyles.label}>Confirmations</Text>
          <Text style={sharedStyles.value}>{block.confirmations ?? 0}</Text>
          {(block.transactions || []).map((tx, index) => (
            <Pressable key={tx.tx_id || index} style={styles.txRow} onPress={() => tx.tx_id && navigation.navigate("Transaction", { txId: tx.tx_id })}>
              <Text style={sharedStyles.value}>{tx.amount ?? 0} VLQ</Text>
              <Text style={sharedStyles.linkText}>{shortText(tx.tx_id || "No transaction id")}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  txRow: {
    borderTopColor: theme.border,
    borderTopWidth: 1,
    paddingVertical: theme.spacing.sm,
  },
});
