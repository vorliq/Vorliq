import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Crypto from "expo-crypto";
import elliptic from "elliptic";
import { sendTransaction } from "../api";
import { loadWallet } from "../storage";
import theme from "../theme";
import sharedStyles from "./sharedStyles";

const ec = new elliptic.ec("secp256k1");

function pythonFloatString(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    throw new Error("Amount must be a valid number.");
  }
  return Number.isInteger(numericValue) ? `${numericValue}.0` : String(numericValue);
}

function base64ToBytes(base64) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = base64.replace(/[^A-Za-z0-9+/=]/g, "");
  const bytes = [];

  for (let index = 0; index < clean.length; index += 4) {
    const chunk = clean.slice(index, index + 4);
    const encoded = chunk.split("").map((char) => (char === "=" ? 0 : chars.indexOf(char)));
    const buffer = (encoded[0] << 18) | (encoded[1] << 12) | (encoded[2] << 6) | encoded[3];

    bytes.push((buffer >> 16) & 255);
    if (chunk[2] !== "=") bytes.push((buffer >> 8) & 255);
    if (chunk[3] !== "=") bytes.push(buffer & 255);
  }

  return bytes;
}

function extractPrivateKeyHex(privateKeyPem) {
  const base64 = privateKeyPem.replace(/-----BEGIN EC PRIVATE KEY-----|-----END EC PRIVATE KEY-----|\s/g, "");
  const bytes = base64ToBytes(base64);

  for (let index = 0; index < bytes.length - 34; index += 1) {
    if (bytes[index] === 0x04 && bytes[index + 1] === 0x20) {
      return bytes
        .slice(index + 2, index + 34)
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    }
  }

  throw new Error("Unable to read private key.");
}

async function signVorliqTransaction(wallet, receiverAddress, amount) {
  const timestamp = Date.now() / 1000;
  const payload =
    `{"amount":${pythonFloatString(amount)},` +
    `"receiver_address":"${receiverAddress}",` +
    `"sender_address":"${wallet.address}",` +
    `"timestamp":${timestamp}}`;
  const digestHex = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, payload, {
    encoding: Crypto.CryptoEncoding.HEX,
  });
  const key = ec.keyFromPrivate(extractPrivateKeyHex(wallet.private_key), "hex");
  const signature = key.sign(digestHex, { canonical: true }).toDER("hex");

  return {
    sender_address: wallet.address,
    sender_public_key: wallet.public_key,
    receiver_address: receiverAddress,
    amount: Number(amount),
    timestamp,
    signature,
  };
}

export default function SendScreen() {
  const [wallet, setWallet] = useState(null);
  const [receiver, setReceiver] = useState("");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      setWallet(await loadWallet());
      setLoading(false);
    }

    load();
  }, []);

  const handleSend = async () => {
    setError("");
    setMessage("");

    if (!wallet) {
      setError("Create or restore a wallet before sending VLQ.");
      return;
    }

    if (!receiver.trim() || Number(amount) <= 0) {
      setError("Enter a receiver address and a positive VLQ amount.");
      return;
    }

    setSending(true);

    try {
      const transaction = await signVorliqTransaction(wallet, receiver.trim(), amount);
      const result = await sendTransaction(transaction);

      if (result.success) {
        setMessage("Transaction signed on this device and submitted to your Vorliq node.");
        setReceiver("");
        setAmount("");
      } else {
        setError(result.error);
      }
    } catch (sendError) {
      setError(sendError.message || "Unable to sign and send this transaction.");
    }

    setSending(false);
  };

  if (loading) {
    return (
      <View style={[sharedStyles.screen, styles.center]}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  return (
    <ScrollView style={sharedStyles.screen} contentContainerStyle={sharedStyles.content}>
      <Text style={sharedStyles.title}>Send VLQ</Text>
      <Text style={sharedStyles.subtitle}>Transactions are signed locally on this phone before they are sent to your Vorliq node.</Text>

      {!wallet ? (
        <View style={sharedStyles.card}>
          <Text style={sharedStyles.errorText}>No wallet is saved on this phone. Create a wallet in the Wallet tab first.</Text>
        </View>
      ) : (
        <View style={sharedStyles.card}>
          <Text style={sharedStyles.label}>Sender</Text>
          <Text style={styles.sender}>{wallet.address}</Text>
        </View>
      )}

      {message ? <Text style={sharedStyles.successText}>{message}</Text> : null}
      {error ? <Text style={sharedStyles.errorText}>{error}</Text> : null}

      <Text style={sharedStyles.label}>Receiver Address</Text>
      <TextInput
        autoCapitalize="none"
        style={sharedStyles.input}
        placeholder="Paste receiver wallet address"
        placeholderTextColor={theme.textSecondary}
        value={receiver}
        onChangeText={setReceiver}
      />

      <Text style={sharedStyles.label}>Amount of VLQ</Text>
      <TextInput
        keyboardType="decimal-pad"
        style={sharedStyles.input}
        placeholder="10"
        placeholderTextColor={theme.textSecondary}
        value={amount}
        onChangeText={setAmount}
      />

      <Pressable style={sharedStyles.button} onPress={handleSend} disabled={sending}>
        <Text style={sharedStyles.buttonText}>{sending ? "Sending..." : "Send VLQ"}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: "center",
    justifyContent: "center",
  },
  sender: {
    color: theme.text,
    fontSize: theme.fonts.small,
    lineHeight: 18,
  },
});
