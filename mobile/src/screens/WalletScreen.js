import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import * as LocalAuthentication from "expo-local-authentication";
import QRCode from "react-native-qrcode-svg";
import { createWallet, getAddressHistory, getBalance, getFaucetSummary } from "../api";
import IdDisplay from "../components/IdDisplay";
import { scheduleLocalNotification } from "../notifications";
import { clearWallet, loadWallet, saveWallet } from "../storage";
import theme from "../theme";
import sharedStyles from "./sharedStyles";

export default function WalletScreen({ navigation }) {
  const [wallet, setWallet] = useState(null);
  const [balance, setBalance] = useState("0");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [privateKeyUnlocked, setPrivateKeyUnlocked] = useState(false);
  const [safetyConfirmed, setSafetyConfirmed] = useState(false);
  const [receiveAmount, setReceiveAmount] = useState("");
  const [history, setHistory] = useState(null);
  const [faucetSummary, setFaucetSummary] = useState(null);
  const previousBalanceRef = useRef(null);

  const loadSavedWallet = useCallback(async () => {
    setLoading(true);
    const savedWallet = await loadWallet();
    setWallet(savedWallet);
    setLoading(false);
  }, []);

  const loadBalance = useCallback(async (address) => {
    if (!address) return;
    const result = await getBalance(address);
    if (result.success) {
      const nextBalance = Number(result.data.balance ?? result.data.data?.balance ?? 0);

      if (previousBalanceRef.current !== null && nextBalance > previousBalanceRef.current) {
        await scheduleLocalNotification(
          "You received VLQ",
          `Your new balance is ${nextBalance} VLQ.`
        );
      }

      previousBalanceRef.current = nextBalance;
      setBalance(String(nextBalance));
    }

    const historyResult = await getAddressHistory(address, { limit: 10 });
    if (historyResult.success) {
      setHistory(historyResult.data.history || historyResult.data.data?.history || historyResult.data);
    }

    const faucetResult = await getFaucetSummary();
    if (faucetResult.success) {
      setFaucetSummary(faucetResult.data.summary || faucetResult.data.data?.summary || faucetResult.data);
    }
  }, []);

  useEffect(() => {
    loadSavedWallet();
  }, [loadSavedWallet]);

  useEffect(() => {
    if (wallet?.address) {
      loadBalance(wallet.address);
      const interval = setInterval(() => loadBalance(wallet.address), 30000);
      return () => clearInterval(interval);
    }

    return undefined;
  }, [wallet, loadBalance]);

  const handleCreateWallet = async () => {
    if (!safetyConfirmed) {
      setError("Confirm that you understand Vorliq cannot recover your private key.");
      return;
    }

    setCreating(true);
    setError("");
    setMessage("");
    const result = await createWallet();

    if (result.success) {
      const walletData = result.data.wallet || result.data;
      await saveWallet(walletData);
      setWallet(walletData);
      setMessage("Wallet created and saved on this device.");
    } else {
      setError(result.error);
    }

    setCreating(false);
  };

  const copyAddress = async () => {
    await Clipboard.setStringAsync(wallet.address);
    setMessage("Address copied.");
  };

  const unlockPrivateKey = async () => {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();

    if (hasHardware && enrolled) {
      const auth = await LocalAuthentication.authenticateAsync({
        promptMessage: "Unlock Vorliq private key backup",
      });

      if (!auth.success) {
        setError("Biometric check was not completed.");
        return;
      }
    }

    setPrivateKeyUnlocked(true);
  };

  const copyPrivateKey = async () => {
    if (!wallet?.private_key) return;
    await Clipboard.setStringAsync(wallet.private_key);
    setMessage("Private key copied. Store it somewhere safe and clear your clipboard when finished.");
  };

  const confirmDelete = () => {
    Alert.alert("Delete Wallet", "This removes the wallet from this phone. Make sure your private key is backed up first.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await clearWallet();
          setWallet(null);
          setPrivateKeyUnlocked(false);
          setMessage("Wallet deleted from this device.");
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={[sharedStyles.screen, styles.center]}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  if (!wallet) {
    return (
      <View style={[sharedStyles.screen, styles.center]}>
        <Text style={sharedStyles.title}>Create Your Wallet</Text>
        <Text style={[sharedStyles.subtitle, styles.centerText]}>Generate a Vorliq wallet on this phone so you can receive, send, and vote with VLQ.</Text>
        <View style={[sharedStyles.card, styles.safetyCard]}>
          <Text style={sharedStyles.label}>Wallet Safety</Text>
          <Text style={sharedStyles.mutedText}>
            Vorliq cannot recover your private key. Anyone with your private key can control
            your wallet. After creating a wallet, save the private key somewhere safe before
            storing meaningful VLQ on it.
          </Text>
          <Pressable style={styles.confirmRow} onPress={() => setSafetyConfirmed((confirmed) => !confirmed)}>
            <View style={[styles.checkbox, safetyConfirmed && styles.checkboxChecked]}>
              {safetyConfirmed ? <Text style={styles.checkboxMark}>OK</Text> : null}
            </View>
            <Text style={styles.confirmText}>I understand that my private key cannot be recovered by Vorliq.</Text>
          </Pressable>
        </View>
        {error ? <Text style={sharedStyles.errorText}>{error}</Text> : null}
        <Pressable
          style={[sharedStyles.button, styles.wideButton, (!safetyConfirmed || creating) && styles.disabledButton]}
          onPress={handleCreateWallet}
          disabled={creating || !safetyConfirmed}
        >
          <Text style={sharedStyles.buttonText}>{creating ? "Creating..." : "Create Wallet"}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView style={sharedStyles.screen} contentContainerStyle={sharedStyles.content}>
      <Text style={sharedStyles.title}>Wallet</Text>
      <Text style={sharedStyles.subtitle}>Your VLQ wallet is saved locally on this phone.</Text>

      {message ? <Text style={sharedStyles.successText}>{message}</Text> : null}
      {error ? <Text style={sharedStyles.errorText}>{error}</Text> : null}

      <View style={sharedStyles.card}>
        <IdDisplay label="Address" value={wallet.address} copyLabel="Copy Address" />
        <Pressable style={[sharedStyles.button, styles.marginTop]} onPress={copyAddress}>
          <Text style={sharedStyles.buttonText}>Copy Address</Text>
        </Pressable>
      </View>

      <View style={[sharedStyles.card, styles.qrCard]}>
        <QRCode
          value={`vorliq://pay?to=${encodeURIComponent(wallet.address)}${
            receiveAmount.trim() ? `&amount=${encodeURIComponent(receiveAmount.trim())}` : ""
          }`}
          size={190}
          backgroundColor={theme.card}
          color={theme.text}
        />
        <Text style={[sharedStyles.mutedText, styles.marginTop]}>Scan to receive VLQ</Text>
        <TextInput
          keyboardType="decimal-pad"
          style={[sharedStyles.input, styles.amountInput]}
          placeholder="Optional requested amount"
          placeholderTextColor={theme.textSecondary}
          value={receiveAmount}
          onChangeText={setReceiveAmount}
        />
      </View>

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.label}>Balance</Text>
        <Text style={styles.balance}>{balance} VLQ</Text>
        <Text style={sharedStyles.mutedText}>Pending incoming: {history?.pending_incoming_total ?? history?.pending_incoming ?? 0} VLQ</Text>
        <Text style={sharedStyles.mutedText}>Pending outgoing: {history?.pending_outgoing_total ?? history?.pending_outgoing ?? 0} VLQ</Text>
      </View>

      {Number(balance) === 0 ? (
        <View style={sharedStyles.card}>
          <Text style={sharedStyles.label}>New Wallet Activation</Text>
          <Text style={sharedStyles.mutedText}>
            Need starter VLQ? The faucet can send a small treasury-backed pending transaction when treasury funds are available.
          </Text>
          <Text style={sharedStyles.mutedText}>Faucet treasury balance: {faucetSummary?.treasury_balance ?? "Unknown"} VLQ</Text>
          <Pressable style={[sharedStyles.button, styles.marginTop]} onPress={() => navigation.navigate("Faucet")}>
            <Text style={sharedStyles.buttonText}>Open Faucet</Text>
          </Pressable>
          <Pressable style={[sharedStyles.button, sharedStyles.secondaryButton, styles.marginTop]} onPress={() => navigation.navigate("Mine")}>
            <Text style={sharedStyles.buttonText}>Open Mining</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.label}>Recent Transactions</Text>
        {(history?.transactions || history?.recent_transactions || []).length ? (
          (history.transactions || history.recent_transactions).slice(0, 10).map((tx, index) => (
            <View key={tx.tx_id || index} style={styles.txRow}>
              <Text style={sharedStyles.value}>{tx.amount ?? 0} VLQ - {tx.status || "confirmed"}</Text>
              <IdDisplay value={tx.tx_id} copyLabel="Copy Tx ID" emptyLabel="No transaction id" />
              {tx.tx_id ? (
                <Pressable
                  style={[sharedStyles.button, sharedStyles.secondaryButton, sharedStyles.smallButton]}
                  onPress={() => navigation.navigate("Transaction", { txId: tx.tx_id })}
                >
                  <Text style={sharedStyles.buttonText}>Open Transaction</Text>
                </Pressable>
              ) : null}
            </View>
          ))
        ) : (
          <Text style={sharedStyles.mutedText}>No transaction history returned yet.</Text>
        )}
      </View>

      <View style={sharedStyles.card}>
        <IdDisplay label="Public Key" value={wallet.public_key} copyLabel="Copy Public Key" start={18} end={10} />
      </View>

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.label}>Private Key Backup</Text>
        {privateKeyUnlocked ? (
          <>
            <Text style={styles.keyText}>{wallet.private_key}</Text>
            <Pressable style={[sharedStyles.button, styles.marginTop]} onPress={copyPrivateKey}>
              <Text style={sharedStyles.buttonText}>Copy Private Key</Text>
            </Pressable>
          </>
        ) : (
          <Pressable style={sharedStyles.button} onPress={unlockPrivateKey}>
            <Text style={sharedStyles.buttonText}>Unlock Private Key Backup</Text>
          </Pressable>
        )}
        <Text style={[sharedStyles.errorText, styles.marginTop]}>Backup Warning: save your private key securely. If you lose it, it cannot be recovered.</Text>
      </View>

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.label}>Backup Instructions</Text>
        <Text style={sharedStyles.mutedText}>
          Mobile encrypted file export and import are not enabled in this release. To back up
          this mobile wallet, unlock the private key on a trusted device, copy it only long
          enough to save it in a secure password manager or offline backup, and keep your node
          URL from Settings with the backup. Never send the private key through chat, email, or
          screenshots.
        </Text>
      </View>

      <Pressable style={[sharedStyles.button, sharedStyles.dangerButton]} onPress={confirmDelete}>
        <Text style={sharedStyles.buttonText}>Delete Wallet</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.lg,
  },
  centerText: {
    textAlign: "center",
  },
  wideButton: {
    marginTop: theme.spacing.lg,
    width: "100%",
  },
  address: {
    color: theme.text,
    fontSize: theme.fonts.body,
    lineHeight: 24,
  },
  marginTop: {
    marginTop: theme.spacing.md,
  },
  qrCard: {
    alignItems: "center",
  },
  amountInput: {
    alignSelf: "stretch",
    marginTop: theme.spacing.md,
  },
  balance: {
    color: theme.success,
    fontSize: theme.fonts.title,
    fontWeight: "800",
  },
  keyText: {
    color: theme.text,
    fontSize: theme.fonts.small,
    lineHeight: 18,
  },
  safetyCard: {
    alignSelf: "stretch",
    marginTop: theme.spacing.lg,
  },
  confirmRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  checkbox: {
    alignItems: "center",
    borderColor: theme.border,
    borderRadius: 6,
    borderWidth: 1,
    height: 24,
    justifyContent: "center",
    width: 24,
  },
  checkboxChecked: {
    backgroundColor: theme.accent,
    borderColor: theme.accent,
  },
  checkboxMark: {
    color: theme.text,
    fontWeight: "900",
  },
  confirmText: {
    color: theme.text,
    flex: 1,
    fontSize: theme.fonts.body,
    lineHeight: 22,
  },
  disabledButton: {
    opacity: 0.55,
  },
  txRow: {
    borderTopColor: theme.border,
    borderTopWidth: 1,
    paddingVertical: theme.spacing.sm,
  },
});
