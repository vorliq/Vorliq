import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { mineBlock } from "../api";
import { useNotifications } from "../context/NotificationContext";
import { scheduleLocalNotification } from "../notifications";
import { loadWallet } from "../storage";
import theme from "../theme";
import sharedStyles from "./sharedStyles";

export default function MineScreen() {
  const { addNotification } = useNotifications();
  const [minerAddress, setMinerAddress] = useState("");
  const [mining, setMining] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [minedBlock, setMinedBlock] = useState(null);
  const [sessionMinedBlocks, setSessionMinedBlocks] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadSavedMinerAddress() {
      const wallet = await loadWallet();
      if (wallet?.address) {
        setMinerAddress(wallet.address);
      }
    }

    loadSavedMinerAddress();
  }, []);

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
        Mining confirms pending transactions and queues a VLQ reward for the next block. Fair
        mining rules prevent blocks from being mined too quickly or by the same address twice in a row.
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

        {cooldownSeconds > 0 ? (
          <Text style={sharedStyles.warningText}>Cooling down. Ready in {cooldownSeconds} seconds.</Text>
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
            <Text style={[sharedStyles.mutedText, styles.buttonSpacing]}>
              The 50 VLQ reward will appear after the next block because mining rewards are added
              as pending transactions first.
            </Text>
          </>
        ) : (
          <Text style={sharedStyles.mutedText}>Mine a block to see the result here.</Text>
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
});
