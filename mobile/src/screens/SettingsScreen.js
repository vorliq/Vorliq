import React, { useEffect, useState } from "react";
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { clearWallet, loadNodeUrl, saveNodeUrl } from "../storage";
import theme from "../theme";
import sharedStyles from "./sharedStyles";

const links = [
  ["Discord", "https://discord.gg/qpX5sHD4pC"],
  ["Telegram", "https://t.me/Vorliq"],
  ["Reddit", "https://www.reddit.com/u/Vorliq/s/PbPMGkrGVS"],
  ["GitHub", "https://github.com/vorliq/Vorliq"],
  ["X", "https://x.com/vorliq"],
];

export default function SettingsScreen() {
  const [nodeUrl, setNodeUrl] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      setNodeUrl(await loadNodeUrl());
    }

    load();
  }, []);

  const handleSave = async () => {
    setError("");
    setMessage("");

    try {
      await saveNodeUrl(nodeUrl);
      setMessage("Node URL saved.");
    } catch (saveError) {
      setError(saveError.message);
    }
  };

  const confirmDeleteWallet = () => {
    Alert.alert("Delete Wallet", "This removes the saved wallet from this phone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await clearWallet();
          setMessage("Wallet deleted from this phone.");
        },
      },
    ]);
  };

  return (
    <ScrollView style={sharedStyles.screen} contentContainerStyle={sharedStyles.content}>
      <Text style={sharedStyles.title}>Settings</Text>
      <Text style={sharedStyles.subtitle}>Choose the Vorliq node your phone connects to and find the community.</Text>

      {message ? <Text style={sharedStyles.successText}>{message}</Text> : null}
      {error ? <Text style={sharedStyles.errorText}>{error}</Text> : null}

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.label}>Node URL</Text>
        <TextInput
          autoCapitalize="none"
          style={sharedStyles.input}
          placeholder="http://192.168.1.1:5000"
          placeholderTextColor={theme.textSecondary}
          value={nodeUrl}
          onChangeText={setNodeUrl}
        />
        <Pressable style={sharedStyles.button} onPress={handleSave}>
          <Text style={sharedStyles.buttonText}>Save</Text>
        </Pressable>
      </View>

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.label}>App Version</Text>
        <Text style={sharedStyles.value}>1.0.0</Text>
      </View>

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.label}>Community</Text>
        {links.map(([label, url]) => (
          <Pressable key={url} style={styles.linkRow} onPress={() => Linking.openURL(url)}>
            <Text style={styles.linkLabel}>{label}</Text>
            <Text style={styles.linkUrl}>{url}</Text>
          </Pressable>
        ))}
      </View>

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.label}>About</Text>
        <Text style={styles.aboutTitle}>Vorliq</Text>
        <Text style={sharedStyles.value}>Your Community Your Coin</Text>
        <Text style={[sharedStyles.mutedText, styles.marginTop]}>Vorliq is released under the MIT License.</Text>
      </View>

      <Pressable style={[sharedStyles.button, sharedStyles.dangerButton]} onPress={confirmDeleteWallet}>
        <Text style={sharedStyles.buttonText}>Delete Wallet</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  linkRow: {
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
    minHeight: 56,
    paddingVertical: theme.spacing.sm,
  },
  linkLabel: {
    color: theme.text,
    fontSize: theme.fonts.body,
    fontWeight: "800",
  },
  linkUrl: {
    color: theme.textSecondary,
    fontSize: theme.fonts.small,
    marginTop: theme.spacing.xs,
  },
  aboutTitle: {
    color: theme.text,
    fontSize: theme.fonts.heading,
    fontWeight: "800",
  },
  marginTop: {
    marginTop: theme.spacing.md,
  },
});
