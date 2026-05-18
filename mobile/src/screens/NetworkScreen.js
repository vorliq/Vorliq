import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { getActiveNodes, getMiningStatus, getNodeDetails, getRegistrySummary } from "../api";
import { DEFAULT_NODE_URL, loadNodeUrl, saveNodeUrl } from "../storage";
import theme from "../theme";
import { formatTimestamp, normalizeStatus, shortText, statusColor } from "../utils/format";
import sharedStyles from "./sharedStyles";

export default function NetworkScreen({ navigation }) {
  const [nodeUrl, setNodeUrl] = useState("");
  const [searchUrl, setSearchUrl] = useState("https://node.vorliq.org");
  const [summary, setSummary] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [nodeDetails, setNodeDetails] = useState(null);
  const [mining, setMining] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    setNodeUrl(await loadNodeUrl());
    const [summaryResult, nodesResult, miningResult] = await Promise.all([
      getRegistrySummary(),
      getActiveNodes(),
      getMiningStatus(),
    ]);
    if (summaryResult.success) setSummary(summaryResult.data.summary || summaryResult.data.data?.summary || summaryResult.data);
    if (nodesResult.success) setNodes(nodesResult.data.nodes || nodesResult.data.data?.nodes || nodesResult.data.data || []);
    if (miningResult.success) setMining(miningResult.data.status || miningResult.data.data?.status || miningResult.data);
    if (!summaryResult.success) setError(summaryResult.error);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const resetNode = async () => {
    await saveNodeUrl(DEFAULT_NODE_URL);
    setNodeUrl(DEFAULT_NODE_URL);
    setMessage("Reset to the official Vorliq API endpoint.");
  };

  const loadNode = async () => {
    setError("");
    const result = await getNodeDetails(searchUrl.trim());
    if (result.success) {
      setNodeDetails(result.data.node || result.data.data?.node || result.data);
    } else {
      setNodeDetails(null);
      setError(result.error);
    }
  };

  return (
    <ScrollView style={sharedStyles.screen} contentContainerStyle={sharedStyles.content}>
      <Text style={sharedStyles.title}>Network</Text>
      <Text style={sharedStyles.subtitle}>Registry, mining status, node reliability, and block tools for the live Vorliq network.</Text>

      {loading ? <ActivityIndicator color={theme.accent} /> : null}
      {message ? <Text style={sharedStyles.successText}>{message}</Text> : null}
      {error ? <Text style={sharedStyles.errorText}>{error}</Text> : null}

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.label}>Configured API</Text>
        <Text style={sharedStyles.codeText}>{nodeUrl}</Text>
        <Pressable style={[sharedStyles.button, styles.top]} onPress={resetNode}>
          <Text style={sharedStyles.buttonText}>Reset to Community Node</Text>
        </Pressable>
      </View>

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.label}>Registry Summary</Text>
        <Text style={sharedStyles.value}>Active nodes: {summary?.active_node_count ?? summary?.active_nodes ?? 0}</Text>
        <Text style={sharedStyles.value}>Synced nodes: {summary?.synced_node_count ?? summary?.synced_nodes ?? 0}</Text>
        <Text style={sharedStyles.value}>Highest height: {summary?.highest_chain_height ?? 0}</Text>
        <Text style={sharedStyles.mutedText}>Average reliability: {summary?.average_reliability_score ?? summary?.average_reliability ?? 0}%</Text>
      </View>

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.label}>Mining</Text>
        <Text style={sharedStyles.value}>Height: {mining?.current_block_height ?? "Unknown"}</Text>
        <Text style={sharedStyles.value}>Can mine now: {mining?.can_mine_now ? "Yes" : "No"}</Text>
        <Text style={sharedStyles.mutedText}>{mining?.reason_if_not || "Mining status is available."}</Text>
        <Pressable style={[sharedStyles.button, styles.top]} onPress={() => navigation.navigate("Mine")}>
          <Text style={sharedStyles.buttonText}>Open Mining</Text>
        </Pressable>
      </View>

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.label}>Active Nodes</Text>
        {nodes.length ? nodes.map((node) => <NodeRow key={node.node_url} node={node} />) : <Text style={sharedStyles.mutedText}>No active nodes returned by this endpoint.</Text>}
      </View>

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.label}>Node Details</Text>
        <TextInput autoCapitalize="none" style={sharedStyles.input} value={searchUrl} onChangeText={setSearchUrl} placeholder="https://node.vorliq.org" placeholderTextColor={theme.textSecondary} />
        <Pressable style={sharedStyles.button} onPress={loadNode}>
          <Text style={sharedStyles.buttonText}>Search Node</Text>
        </Pressable>
        {nodeDetails ? <NodeRow node={nodeDetails} detailed /> : null}
      </View>
    </ScrollView>
  );
}

function NodeRow({ node, detailed = false }) {
  return (
    <View style={styles.nodeRow}>
      <View style={[sharedStyles.badge, { backgroundColor: statusColor(node.sync_status || node.status) }]}>
        <Text style={sharedStyles.badgeText}>{normalizeStatus(node.sync_status || node.status)}</Text>
      </View>
      <Text style={[sharedStyles.value, styles.top]}>{node.display_name || node.node_url}</Text>
      <Text style={sharedStyles.codeText}>{shortText(node.node_url, 20, 10)}</Text>
      <Text style={sharedStyles.mutedText}>{[node.region, node.country].filter(Boolean).join(", ") || "Region not shared"}</Text>
      <Text style={sharedStyles.mutedText}>Height {node.last_chain_height ?? "?"} | Reliability {node.reliability_score ?? 0}% | Uptime {node.uptime_score ?? 0}%</Text>
      {detailed ? <Text style={sharedStyles.mutedText}>Last seen {formatTimestamp(node.last_seen)}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  top: {
    marginTop: theme.spacing.md,
  },
  nodeRow: {
    borderTopColor: theme.border,
    borderTopWidth: 1,
    paddingVertical: theme.spacing.sm,
  },
});
