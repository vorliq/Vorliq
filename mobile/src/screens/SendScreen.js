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
import { CameraView, Camera } from "expo-camera";
import * as Clipboard from "expo-clipboard";
import * as Crypto from "expo-crypto";
import elliptic from "elliptic";
import { getBalance, sendTransaction } from "../api";
import { validateTransactionReview } from "../address";
import IdDisplay from "../components/IdDisplay";
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

function parseVorliqPaymentUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "vorliq:" || url.hostname !== "pay") {
      return null;
    }

    const to = url.searchParams.get("to");
    if (!to) {
      return null;
    }

    return {
      to,
      amount: url.searchParams.get("amount") || "",
    };
  } catch {
    return null;
  }
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

export default function SendScreen({ navigation, route }) {
  const [wallet, setWallet] = useState(null);
  const [receiver, setReceiver] = useState("");
  const [amount, setAmount] = useState("");
  const [balance, setBalance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [submittedTx, setSubmittedTx] = useState(null);
  const [step, setStep] = useState("details");
  const [lastSubmitted, setLastSubmitted] = useState(null);
  const [duplicateOverride, setDuplicateOverride] = useState(false);

  useEffect(() => {
    async function load() {
      const savedWallet = await loadWallet();
      setWallet(savedWallet);
      if (savedWallet?.address) {
        const balanceResult = await getBalance(savedWallet.address);
        if (balanceResult.success) {
          setBalance(Number(balanceResult.data.balance ?? balanceResult.data.data?.balance ?? 0));
        }
      }
      setLoading(false);
    }

    load();
  }, []);

  useEffect(() => {
    if (route?.params?.receiver) {
      setReceiver(route.params.receiver);
    }
    if (route?.params?.amount) {
      setAmount(String(route.params.amount));
    }
  }, [route?.params?.receiver, route?.params?.amount]);

  const review = validateTransactionReview({
    senderAddress: wallet?.address || "",
    receiverAddress: receiver,
    amount,
    balance,
  });
  const transactionFingerprint = `${wallet?.address || ""}|${receiver.trim()}|${Number(amount)}`;
  const duplicateAttempt =
    lastSubmitted?.fingerprint === transactionFingerprint &&
    Date.now() - lastSubmitted.submittedAt < 60000;

  const continueToReview = () => {
    setError("");
    setMessage("");
    setSubmittedTx(null);

    if (!wallet) {
      setError("Create or restore a wallet before sending VLQ.");
      return;
    }

    if (!review.canSubmit) {
      setError(review.errors[0] || "Review the transaction details before continuing.");
      return;
    }

    setStep("review");
  };

  const handleSend = async () => {
    setError("");
    setMessage("");
    setSubmittedTx(null);

    if (sending) return;
    if (!review.canSubmit) {
      setError(review.errors[0] || "Review the transaction details before sending.");
      return;
    }
    if (duplicateAttempt && !duplicateOverride) {
      setError("This matches a transaction you just submitted. Confirm that you want to send the same details again.");
      return;
    }

    setSending(true);

    try {
      const transaction = await signVorliqTransaction(wallet, review.receiver.address, amount);
      const result = await sendTransaction(transaction);

      if (result.success) {
        const txId =
          result.data.tx_id ||
          result.data.transaction?.tx_id ||
          result.data.data?.tx_id ||
          result.data.data?.transaction?.tx_id;
        setSubmittedTx(txId || null);
        setMessage("Transaction signed locally and submitted as pending. It is confirmed after mining.");
        setLastSubmitted({ fingerprint: transactionFingerprint, txId, submittedAt: Date.now() });
        setReceiver("");
        setAmount("");
        setStep("result");
        setDuplicateOverride(false);
      } else {
        setError(result.error);
      }
    } catch (sendError) {
      setError(sendError.message || "Unable to sign and send this transaction.");
    }

    setSending(false);
  };

  const openScanner = async () => {
    setError("");
    const permission = await Camera.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError("Camera permission is required to scan Vorliq payment QR codes.");
      return;
    }
    setScannerOpen(true);
  };

  const handleBarcodeScanned = ({ data }) => {
    if (!cameraReady) return;
    const payment = parseVorliqPaymentUrl(data);
    if (!payment) {
      setError("This QR code is not a Vorliq payment request.");
      return;
    }

    setReceiver(payment.to);
    if (payment.amount) {
      setAmount(payment.amount);
    }
    setScannerOpen(false);
    setStep("details");
    setMessage("Payment QR code scanned.");
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
          <IdDisplay value={wallet.address} copyLabel="Copy Sender" />
        </View>
      )}

      {message ? <Text style={sharedStyles.successText}>{message}</Text> : null}
      {error ? <Text style={sharedStyles.errorText}>{error}</Text> : null}

      {submittedTx ? (
        <View style={sharedStyles.card}>
          <Text style={sharedStyles.label}>Pending Transaction</Text>
          <IdDisplay value={submittedTx} copyLabel="Copy Transaction ID" />
          <Text style={sharedStyles.mutedText}>Status is pending until a miner confirms this transaction in a block.</Text>
          <Pressable style={[sharedStyles.button, sharedStyles.secondaryButton, styles.scanButton]} onPress={() => Clipboard.setStringAsync(submittedTx)}>
            <Text style={sharedStyles.buttonText}>Copy Transaction ID</Text>
          </Pressable>
          <Pressable style={[sharedStyles.button, styles.scanButton]} onPress={() => navigation.navigate("Transaction", { txId: submittedTx })}>
            <Text style={sharedStyles.buttonText}>Open Transaction</Text>
          </Pressable>
          {route?.params?.returnToExchange ? (
            <Pressable style={[sharedStyles.button, sharedStyles.secondaryButton, styles.scanButton]} onPress={() => navigation.navigate("Exchange")}>
              <Text style={sharedStyles.buttonText}>Use for Exchange</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {step === "details" ? (
        <>
          <View style={sharedStyles.card}>
            <Text style={sharedStyles.label}>Step 1 of 3</Text>
            <Text style={sharedStyles.mutedText}>Enter transaction details. Your private key remains on this phone and is used only for local signing.</Text>
          </View>

          <Pressable style={[sharedStyles.button, styles.scanButton]} onPress={scannerOpen ? () => setScannerOpen(false) : openScanner}>
            <Text style={sharedStyles.buttonText}>{scannerOpen ? "Close Scanner" : "Scan QR Code"}</Text>
          </Pressable>

          {scannerOpen ? (
            <View style={styles.cameraWrap}>
              <CameraView
                style={styles.camera}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                onCameraReady={() => setCameraReady(true)}
                onBarcodeScanned={handleBarcodeScanned}
              />
              <Text style={sharedStyles.mutedText}>Point your camera at a Vorliq payment QR code.</Text>
            </View>
          ) : null}

          <Text style={sharedStyles.label}>Receiver Address</Text>
          <TextInput
            autoCapitalize="none"
            style={sharedStyles.input}
            placeholder="Paste receiver wallet address"
            placeholderTextColor={theme.textSecondary}
            value={receiver}
            onChangeText={(value) => {
              setReceiver(value);
              setDuplicateOverride(false);
            }}
          />
          {receiver.trim() ? (
            <Text style={review.receiver.looksValid ? sharedStyles.mutedText : sharedStyles.errorText}>
              Receiver address {review.receiver.looksValid ? "looks valid." : "needs careful review."}
            </Text>
          ) : null}

          <Text style={sharedStyles.label}>Amount of VLQ</Text>
          <TextInput
            keyboardType="decimal-pad"
            style={sharedStyles.input}
            placeholder="10"
            placeholderTextColor={theme.textSecondary}
            value={amount}
            onChangeText={(value) => {
              setAmount(value);
              setDuplicateOverride(false);
            }}
          />
          {balance !== null ? <Text style={sharedStyles.mutedText}>Confirmed balance available for review: {balance} VLQ</Text> : null}
          {review.errors.map((item) => <Text style={sharedStyles.errorText} key={item}>{item}</Text>)}
          {review.warnings.map((item) => <Text style={sharedStyles.errorText} key={item}>{item}</Text>)}

          <Pressable style={sharedStyles.button} onPress={continueToReview}>
            <Text style={sharedStyles.buttonText}>Review Transaction</Text>
          </Pressable>
        </>
      ) : null}

      {step === "review" ? (
        <View style={sharedStyles.card}>
          <Text style={sharedStyles.label}>Step 2 of 3 - Review Transaction</Text>
          <Text style={sharedStyles.errorText}>Transactions cannot be reversed. Verify the receiver address before confirming.</Text>
          <IdDisplay label="Sender" value={wallet?.address} copyLabel="Copy Sender" />
          <IdDisplay label="Receiver" value={review.receiver.address} copyLabel="Copy Receiver" />
          <Text style={sharedStyles.label}>Amount</Text>
          <Text style={sharedStyles.value}>{review.amount} VLQ</Text>
          <Text style={sharedStyles.label}>Estimated Status</Text>
          <Text style={sharedStyles.value}>Pending until mined</Text>
          <Text style={sharedStyles.label}>Receiver Validation</Text>
          <Text style={sharedStyles.value}>{review.receiver.looksValid ? "Looks valid" : "Warnings present"}</Text>
          <Text style={sharedStyles.mutedText}>The private key stays on this phone and is not sent to the backend.</Text>
          {review.errors.map((item) => <Text style={sharedStyles.errorText} key={item}>{item}</Text>)}
          {review.warnings.map((item) => <Text style={sharedStyles.errorText} key={item}>{item}</Text>)}
          {duplicateAttempt ? (
            <Pressable style={styles.confirmRow} onPress={() => setDuplicateOverride((current) => !current)}>
              <View style={[styles.checkbox, duplicateOverride && styles.checkboxChecked]}>
                {duplicateOverride ? <Text style={styles.checkboxMark}>OK</Text> : null}
              </View>
              <Text style={styles.confirmText}>I understand this repeats the same send details submitted moments ago.</Text>
            </Pressable>
          ) : null}
          <Pressable style={[sharedStyles.button, sharedStyles.secondaryButton, styles.scanButton]} onPress={() => setStep("details")} disabled={sending}>
            <Text style={sharedStyles.buttonText}>Back</Text>
          </Pressable>
          <Pressable style={sharedStyles.button} onPress={handleSend} disabled={sending || !review.canSubmit || (duplicateAttempt && !duplicateOverride)}>
            <Text style={sharedStyles.buttonText}>{sending ? "Sending..." : "Confirm and Send"}</Text>
          </Pressable>
        </View>
      ) : null}
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
  scanButton: {
    marginBottom: theme.spacing.md,
  },
  cameraWrap: {
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.card,
    marginBottom: theme.spacing.md,
  },
  camera: {
    height: 280,
    width: "100%",
  },
  confirmRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: theme.spacing.sm,
    marginVertical: theme.spacing.md,
  },
  checkbox: {
    alignItems: "center",
    borderColor: theme.border,
    borderRadius: 6,
    borderWidth: 1,
    height: 26,
    justifyContent: "center",
    width: 26,
  },
  checkboxChecked: {
    backgroundColor: theme.accent,
    borderColor: theme.accent,
  },
  checkboxMark: {
    color: theme.background,
    fontSize: 10,
    fontWeight: "800",
  },
  confirmText: {
    color: theme.text,
    flex: 1,
    fontSize: theme.fonts.small,
    lineHeight: 18,
  },
});
