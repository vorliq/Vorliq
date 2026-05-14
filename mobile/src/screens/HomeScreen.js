import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { getDiagnostics } from "../api";
import { scheduleLocalNotification } from "../notifications";
import theme from "../theme";
import sharedStyles from "./sharedStyles";

const logo = require("../../assets/logo.png");

export default function HomeScreen() {
  const [diagnostics, setDiagnostics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [online, setOnline] = useState(false);
  const previousBlockHeightRef = useRef(null);

  const loadDashboard = useCallback(async () => {
    setError("");
    const result = await getDiagnostics();

    if (result.success) {
      const currentHeight = Number(result.data.current_block_height ?? result.data.block_height ?? 0);

      if (previousBlockHeightRef.current !== null && currentHeight > previousBlockHeightRef.current) {
        await scheduleLocalNotification(
          "New Block Mined",
          `Block number ${currentHeight} has been added to the Vorliq network.`
        );
      }

      previousBlockHeightRef.current = currentHeight;
      setDiagnostics(result.data);
      setOnline(true);
    } else {
      setDiagnostics(null);
      setOnline(false);
      setError("Unable to reach your Vorliq node. Check the node URL in Settings and make sure the backend is running.");
    }

    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (loading) {
      return undefined;
    }

    const interval = setInterval(loadDashboard, 60000);
    return () => clearInterval(interval);
  }, [loading, loadDashboard]);

  const handleRefresh = () => {
    setRefreshing(true);
    loadDashboard();
  };

  const chainStatus =
    diagnostics?.chain_validity_status ||
    (diagnostics?.chain_valid === false ? "Invalid" : "Valid");
  const stats = [
    ["Block Height", diagnostics?.current_block_height ?? diagnostics?.block_height ?? "0"],
    ["Chain Status", chainStatus],
    ["VLQ Circulation", `${diagnostics?.total_vlq_in_circulation ?? diagnostics?.total_vlq_issued ?? 0} VLQ`],
    ["Mining Reward", `${diagnostics?.current_mining_reward ?? 50} VLQ`],
  ];

  return (
    <ScrollView
      style={sharedStyles.screen}
      contentContainerStyle={sharedStyles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.accent} />}
    >
      <View style={sharedStyles.headerRow}>
        <View>
          <Text style={sharedStyles.title}>Vorliq</Text>
          <Text style={sharedStyles.subtitle}>Your Community Your Coin</Text>
        </View>
        <View style={[styles.statusDot, { backgroundColor: online ? theme.success : theme.error }]} />
      </View>

      <View style={styles.logoWrap}>
        <Image source={logo} style={styles.logo} resizeMode="contain" />
        <Text style={styles.welcome}>Welcome to your community savings bank on its own blockchain.</Text>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={theme.accent} />
      ) : error ? (
        <View style={sharedStyles.card}>
          <Text style={sharedStyles.errorText}>{error}</Text>
        </View>
      ) : (
        <View style={styles.grid}>
          {stats.map(([label, value]) => (
            <View style={styles.statCard} key={label}>
              <Text style={sharedStyles.label}>{label}</Text>
              <Text
                style={[
                  styles.statValue,
                  label === "Chain Status" && {
                    color: String(value).toLowerCase() === "valid" ? theme.success : theme.error,
                  },
                ]}
              >
                {String(value)}
              </Text>
            </View>
          ))}
        </View>
      )}

      <Pressable style={sharedStyles.button} onPress={handleRefresh}>
        <Text style={sharedStyles.buttonText}>Refresh</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  statusDot: {
    borderRadius: 9,
    height: 18,
    width: 18,
  },
  logoWrap: {
    alignItems: "center",
    marginBottom: theme.spacing.lg,
  },
  logo: {
    height: 104,
    width: 104,
  },
  welcome: {
    color: theme.textSecondary,
    fontSize: theme.fonts.body,
    lineHeight: 24,
    marginTop: theme.spacing.md,
    textAlign: "center",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginBottom: theme.spacing.md,
  },
  statCard: {
    backgroundColor: theme.card,
    borderColor: theme.border,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: theme.spacing.md,
    padding: theme.spacing.md,
    width: "48%",
  },
  statValue: {
    color: theme.text,
    fontSize: theme.fonts.heading,
    fontWeight: "800",
  },
});
