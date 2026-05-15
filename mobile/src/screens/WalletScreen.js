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
import { createWallet, getBalance } from "../api";
import { scheduleLocalNotification } from "../notifications";
import { clearWallet, loadWallet, saveWallet } from "../storage";
import theme from "../theme";
import sharedStyles from "./sharedStyles";

export default function WalletScreen() {
  const [wallet, setWallet] = useState(null);
  const [balance, setBalance] = useState("0");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [privateKeyUnlocked, setPrivateKeyUnlocked] = useState(false);
  const [receiveAmount, setReceiveAmount] = useState("");
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
        {error ? <Text style={sharedStyles.errorText}>{error}</Text> : null}
        <Pressable style={[sharedStyles.button, styles.wideButton]} onPress={handleCreateWallet} disabled={creating}>
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
        <Text style={sharedStyles.label}>Address</Text>
        <Text style={styles.address}>{wallet.address}</Text>
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
      </View>

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.label}>Public Key</Text>
        <Text style={styles.keyText}>{wallet.public_key}</Text>
      </View>

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.label}>Private Key Backup</Text>
        {privateKeyUnlocked ? (
          <Text style={styles.keyText}>{wallet.private_key}</Text>
        ) : (
          <Pressable style={sharedStyles.button} onPress={unlockPrivateKey}>
            <Text style={sharedStyles.buttonText}>Unlock Private Key Backup</Text>
          </Pressable>
        )}
        <Text style={[sharedStyles.errorText, styles.marginTop]}>Backup Warning: save your private key securely. If you lose it, it cannot be recovered.</Text>
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
});
