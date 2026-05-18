import React, { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
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
import {
  getActiveIncidents,
  getChainSummary,
  getDiagnostics,
  getMiningStatus,
  getRegistrySummary,
  getTreasurySummary,
} from "../api";
import { scheduleLocalNotification } from "../notifications";
import theme from "../theme";
import sharedStyles from "./sharedStyles";

const logo = require("../../assets/logo.png");
const COMMUNITY_BANNER_KEY = "vorliq_community_node_banner_dismissed";

export default function HomeScreen({ navigation }) {
  const [dashboard, setDashboard] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [online, setOnline] = useState(false);
  const [showCommunityBanner, setShowCommunityBanner] = useState(false);
  const previousBlockHeightRef = useRef(null);

  const loadDashboard = useCallback(async () => {
    setError("");
    const [diagnostics, chain, mining, treasury, registry, incidents] = await Promise.all([
      getDiagnostics(),
      getChainSummary(),
      getMiningStatus(),
      getTreasurySummary(),
      getRegistrySummary(),
      getActiveIncidents(),
    ]);

    if (diagnostics.success || chain.success) {
      const diagnosticsData = diagnostics.data || {};
      const chainData = chain.data?.summary || chain.data?.data?.summary || chain.data || {};
      const miningData = mining.data?.status || mining.data?.data?.status || mining.data || {};
      const treasuryData = treasury.data?.summary || treasury.data?.data?.summary || treasury.data || {};
      const registryData = registry.data?.summary || registry.data?.data?.summary || registry.data || {};
      const incidentsData = incidents.data?.incidents || incidents.data?.data?.incidents || [];
      const currentHeight = Number(
        miningData.current_block_height ??
          chainData.current_block_height ??
          diagnosticsData.current_block_height ??
          diagnosticsData.block_height ??
          0
      );

      if (previousBlockHeightRef.current !== null && currentHeight > previousBlockHeightRef.current) {
        await scheduleLocalNotification("New Block Mined", `Block number ${currentHeight} has been added to Vorliq.`);
      }

      previousBlockHeightRef.current = currentHeight;
      setDashboard({ diagnostics: diagnosticsData, chain: chainData, mining: miningData, treasury: treasuryData, registry: registryData, incidents: incidentsData });
      setOnline(true);
    } else {
      setDashboard({});
      setOnline(false);
      setError("Unable to reach your Vorliq node. Check the node URL in Settings.");
    }

    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    async function loadBannerState() {
      const dismissed = await AsyncStorage.getItem(COMMUNITY_BANNER_KEY);
      setShowCommunityBanner(dismissed !== "true");
    }
    loadBannerState();
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    loadDashboard();
  };

  const dismissCommunityBanner = async () => {
    await AsyncStorage.setItem(COMMUNITY_BANNER_KEY, "true");
    setShowCommunityBanner(false);
  };

  const mining = dashboard.mining || {};
  const chain = dashboard.chain || {};
  const diagnostics = dashboard.diagnostics || {};
  const treasury = dashboard.treasury || {};
  const registry = dashboard.registry || {};
  const incidents = dashboard.incidents || [];

  const stats = [
    ["Block Height", mining.current_block_height ?? chain.current_block_height ?? diagnostics.current_block_height ?? diagnostics.block_height ?? "0"],
    ["Chain Valid", mining.chain_valid === false || diagnostics.chain_valid === false ? "No" : "Yes"],
    ["Can Mine", mining.can_mine_now ? "Yes" : "No"],
    ["Treasury", `${treasury.current_balance ?? treasury.treasury_balance ?? 0} VLQ`],
    ["Active Nodes", registry.active_node_count ?? registry.active_nodes ?? 0],
    ["Incidents", incidents.length],
  ];

  const actions = [
    ["Wallet", "Wallet"],
    ["Send", "Send"],
    ["Mine", "Mine"],
    ["Faucet", "Faucet"],
    ["Lending", "Lending"],
    ["Exchange", "Exchange"],
    ["Governance", "Governance"],
    ["Profile", "Profile"],
  ];

  return (
    <ScrollView
      style={sharedStyles.screen}
      contentContainerStyle={sharedStyles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.accent} />}
    >
      {showCommunityBanner ? (
        <View style={styles.communityBanner}>
          <Text style={styles.communityBannerText}>
            Connected to the official Vorliq API by default. You can switch nodes in Settings.
          </Text>
          <Pressable style={styles.dismissButton} onPress={dismissCommunityBanner}>
            <Text style={styles.dismissButtonText}>Dismiss</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={sharedStyles.headerRow}>
        <View style={styles.brandRow}>
          <Image source={logo} style={styles.logo} resizeMode="contain" />
          <View>
            <Text style={sharedStyles.title}>Vorliq</Text>
            <Text style={sharedStyles.subtitle}>Mobile community blockchain access</Text>
          </View>
        </View>
        <View style={[styles.statusDot, { backgroundColor: online ? theme.success : theme.error }]} />
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
              <Text style={styles.statValue}>{String(value)}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.label}>Mining Status</Text>
        <Text style={sharedStyles.value}>{mining.can_mine_now ? "Ready for the next block." : mining.reason_if_not || "Waiting for mining status."}</Text>
        <Text style={sharedStyles.mutedText}>Pending transactions: {mining.pending_transaction_count ?? 0}</Text>
      </View>

      <Text style={sharedStyles.sectionTitle}>Quick Actions</Text>
      <View style={styles.actionGrid}>
        {actions.map(([label, route]) => (
          <Pressable key={route} style={styles.actionButton} onPress={() => navigation.navigate(route)}>
            <Text style={styles.actionText}>{label}</Text>
          </Pressable>
        ))}
      </View>

      <Pressable style={[sharedStyles.button, styles.refresh]} onPress={handleRefresh}>
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
  brandRow: {
    alignItems: "center",
    flexDirection: "row",
    flex: 1,
    gap: theme.spacing.md,
  },
  logo: {
    height: 44,
    width: 44,
  },
  communityBanner: {
    backgroundColor: theme.card,
    borderColor: theme.accent,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: theme.spacing.md,
    padding: theme.spacing.md,
  },
  communityBannerText: {
    color: theme.text,
    fontSize: theme.fonts.body,
    lineHeight: 24,
  },
  dismissButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: theme.accent,
    borderRadius: 10,
    marginTop: theme.spacing.md,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: theme.spacing.md,
  },
  dismissButtonText: {
    color: theme.background,
    fontWeight: "800",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  statCard: {
    backgroundColor: theme.cardSoft,
    borderColor: theme.border,
    borderRadius: 14,
    borderWidth: 1,
    flexGrow: 1,
    minWidth: "46%",
    padding: theme.spacing.md,
  },
  statValue: {
    color: theme.text,
    fontSize: theme.fonts.heading,
    fontWeight: "800",
  },
  actionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
  },
  actionButton: {
    alignItems: "center",
    backgroundColor: theme.card,
    borderColor: theme.border,
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 48,
    justifyContent: "center",
    padding: theme.spacing.sm,
    width: "48%",
  },
  actionText: {
    color: theme.text,
    fontWeight: "800",
  },
  refresh: {
    marginTop: theme.spacing.lg,
  },
});
