import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { getMiningHistory, getMiningStatus, mineBlock } from "../api";
import { useNotifications } from "../context/NotificationContext";
import { scheduleLocalNotification } from "../notifications";
import { loadWallet } from "../storage";
import theme from "../theme";
import sharedStyles from "./sharedStyles";

export default function MineScreen({ navigation }) {
  const { addNotification } = useNotifications();
  const [minerAddress, setMinerAddress] = useState("");
  const [mining, setMining] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [minedBlock, setMinedBlock] = useState(null);
  const [sessionMinedBlocks, setSessionMinedBlocks] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState(null);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    async function loadSavedMinerAddress() {
      const wallet = await loadWallet();
      if (wallet?.address) {
        setMinerAddress(wallet.address);
      }
    }

    loadSavedMinerAddress();
    loadMiningData();
  }, []);

  async function loadMiningData() {
    const [statusResult, historyResult] = await Promise.all([
      getMiningStatus(),
      getMiningHistory({ limit: 8 }),
    ]);
    if (statusResult.success) {
      setStatus(statusResult.data.status || statusResult.data.data?.status || statusResult.data);
      const waitSeconds = Number((statusResult.data.status || statusResult.data).seconds_until_next_allowed_block);
      if (Number.isFinite(waitSeconds) && waitSeconds > 0) {
        setCooldownSeconds(Math.ceil(waitSeconds));
      }
    }
    if (historyResult.success) {
      setHistory(historyResult.data.blocks || historyResult.data.history || historyResult.data.data?.blocks || historyResult.data.data || []);
    }
  }

  useEffect(() => {
    if (cooldownSeconds <= 0) {
      return undefined;
    }

    const interval = setInterval(() => {
      setCooldownSeconds((seconds) => Math.max(seconds - 1, 0));
    }, 1000);

    return () => clearInterval(interval);
  }, [cooldownSeconds]);

  async function handleMine() {
    if (!minerAddress.trim()) {
      setError("Enter your miner wallet address.");
      return;
    }

    setMining(true);
    setError("");
    setMessage("");
    setMinedBlock(null);

    const result = await mineBlock(minerAddress.trim());

    if (result.success) {
      const block = result.data.block;
      setMinedBlock(block);
      setSessionMinedBlocks((current) => current + 1);
      setMessage("Block mined successfully.");
      addNotification("info", "Block Mined", `Block #${block.index} was mined.`);
      await scheduleLocalNotification("Block Mined", `Block #${block.index} was added to Vorliq.`);
      await loadMiningData();
    } else {
      setError(result.error || "Unable to mine block.");
      const waitSeconds = Number(result.wait_seconds);
      if (Number.isFinite(waitSeconds) && waitSeconds > 0) {
        setCooldownSeconds(Math.ceil(waitSeconds));
      }
    }

    setMining(false);
  }

  return (
    <ScrollView style={sharedStyles.screen} contentContainerStyle={sharedStyles.content}>
      <Text style={sharedStyles.title}>Mine</Text>
      <Text style={sharedStyles.subtitle}>
        Mining confirms pending transactions using Vorliq proof of work. Fair mining rules prevent blocks from being mined too quickly or by the same address twice in a row.
      </Text>

      {message ? <Text style={sharedStyles.successText}>{message}</Text> : null}
      {error ? <Text style={sharedStyles.errorText}>{error}</Text> : null}

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.label}>Miner Address</Text>
        <TextInput
          style={sharedStyles.input}
          value={minerAddress}
          onChangeText={setMinerAddress}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Your VLQ wallet address"
          placeholderTextColor={theme.textSecondary}
        />

        <View style={styles.statusPanel}>
          <Text style={sharedStyles.label}>Mining Status</Text>
          <Text style={sharedStyles.value}>Height: {status?.current_block_height ?? "Unknown"}</Text>
          <Text style={sharedStyles.value}>Difficulty: {status?.current_difficulty ?? "Unknown"}</Text>
          <Text style={sharedStyles.value}>Pending transactions: {status?.pending_transaction_count ?? 0}</Text>
          <Text style={sharedStyles.mutedText}>
            Miner reward: {status?.miner_reward_after_treasury ?? "?"} VLQ | Treasury: {status?.treasury_reward_per_block ?? "?"} VLQ
          </Text>
        </View>

        {cooldownSeconds > 0 || status?.can_mine_now === false ? (
          <Text style={sharedStyles.warningText}>
            {status?.reason_if_not || `Cooling down. Ready in ${cooldownSeconds} seconds.`}
          </Text>
        ) : (
          <Text style={sharedStyles.successText}>Ready to mine.</Text>
        )}

        <Pressable
          style={[sharedStyles.button, styles.buttonSpacing, (mining || cooldownSeconds > 0) && styles.disabledButton]}
          onPress={handleMine}
          disabled={mining || cooldownSeconds > 0}
        >
          {mining ? (
            <ActivityIndicator color={theme.text} />
          ) : (
            <Text style={sharedStyles.buttonText}>
              {cooldownSeconds > 0 ? `Cooling Down (${cooldownSeconds}s)` : "Mine Block"}
            </Text>
          )}
        </Pressable>

        <Text style={[sharedStyles.mutedText, styles.buttonSpacing]}>
          Blocks mined this session: {sessionMinedBlocks}
        </Text>
      </View>

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.label}>Mining Result</Text>
        {minedBlock ? (
          <>
            <Text style={sharedStyles.value}>Block #{minedBlock.index}</Text>
            <Text style={styles.hashText}>{minedBlock.hash}</Text>
            <Pressable style={[sharedStyles.button, styles.buttonSpacing]} onPress={() => navigation.navigate("Block", { blockId: String(minedBlock.index) })}>
              <Text style={sharedStyles.buttonText}>Open Block</Text>
            </Pressable>
            <Text style={[sharedStyles.mutedText, styles.buttonSpacing]}>
              Reward split follows current network policy. If rewards are queued by chain rules, they become visible after the next mined block.
            </Text>
          </>
        ) : (
          <Text style={sharedStyles.mutedText}>Mine a block to see the result here.</Text>
        )}
      </View>

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.label}>Recent Mining History</Text>
        {history.length ? (
          history.map((block) => (
            <Pressable key={block.block_hash || block.hash || block.block_index} style={styles.historyRow} onPress={() => navigation.navigate("Block", { blockId: String(block.block_index ?? block.index) })}>
              <Text style={sharedStyles.value}>Block #{block.block_index ?? block.index}</Text>
              <Text style={sharedStyles.mutedText}>{block.transaction_count ?? block.transactions?.length ?? 0} transactions | Difficulty {block.difficulty ?? "?"}</Text>
            </Pressable>
          ))
        ) : (
          <Text style={sharedStyles.mutedText}>No mining history returned yet.</Text>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  buttonSpacing: {
    marginTop: theme.spacing.md,
  },
  disabledButton: {
    opacity: 0.6,
  },
  hashText: {
    color: theme.textSecondary,
    fontSize: theme.fonts.small,
    lineHeight: 20,
    marginTop: theme.spacing.xs,
  },
  statusPanel: {
    marginBottom: theme.spacing.md,
  },
  historyRow: {
    borderTopColor: theme.border,
    borderTopWidth: 1,
    paddingVertical: theme.spacing.sm,
  },
});
