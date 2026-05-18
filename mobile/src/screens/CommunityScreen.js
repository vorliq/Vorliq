import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { getTopProfiles } from "../api";
import theme from "../theme";
import { shortText } from "../utils/format";
import sharedStyles from "./sharedStyles";

const destinations = [
  ["Faucet", "Starter VLQ", "Claim a treasury-backed starter amount when funds are available."],
  ["Lending", "Lending", "View loan votes, active loans, and your loan lifecycle."],
  ["Exchange", "Exchange", "Browse community VLQ offers and track trade states."],
  ["Governance", "Governance", "Vote on network settings and view rule-change history."],
  ["Treasury", "Treasury", "Read the public treasury summary and ledger."],
  ["Profile", "Profile", "Create or edit your public wallet-linked profile."],
  ["Notifications", "Notifications", "Review local phone alerts from Vorliq."],
];

export default function CommunityScreen({ navigation }) {
  const [profiles, setProfiles] = useState([]);

  useEffect(() => {
    async function load() {
      const result = await getTopProfiles(5);
      if (result.success) {
        setProfiles(result.data.profiles || result.data.data?.profiles || result.data.data || []);
      }
    }

    load();
  }, []);

  return (
    <ScrollView style={sharedStyles.screen} contentContainerStyle={sharedStyles.content}>
      <Text style={sharedStyles.title}>Community</Text>
      <Text style={sharedStyles.subtitle}>
        Mobile access to profiles, faucet, lending, exchange, governance, treasury, and notifications.
      </Text>

      {destinations.map(([route, title, copy]) => (
        <Pressable key={route} style={sharedStyles.card} onPress={() => navigation.navigate(route)}>
          <Text style={sharedStyles.sectionTitle}>{title}</Text>
          <Text style={sharedStyles.mutedText}>{copy}</Text>
          <Text style={[sharedStyles.linkText, styles.link]}>Open</Text>
        </Pressable>
      ))}

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.label}>Top Reputation</Text>
        {profiles.length ? (
          profiles.map((profile) => (
            <View style={styles.profileRow} key={profile.wallet_address || profile.address}>
              <Text style={sharedStyles.value}>{profile.display_name || shortText(profile.wallet_address)}</Text>
              <Text style={sharedStyles.mutedText}>{profile.reputation_score || 0} rep</Text>
            </View>
          ))
        ) : (
          <Text style={sharedStyles.mutedText}>Top profiles will appear after the node returns reputation data.</Text>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  link: {
    marginTop: theme.spacing.sm,
  },
  profileRow: {
    borderTopColor: theme.border,
    borderTopWidth: 1,
    paddingVertical: theme.spacing.sm,
  },
});
