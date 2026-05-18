import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { getProfile, saveProfile } from "../api";
import { loadWallet } from "../storage";
import theme from "../theme";
import { shortText } from "../utils/format";
import sharedStyles from "./sharedStyles";

export default function ProfileScreen() {
  const [wallet, setWallet] = useState(null);
  const [address, setAddress] = useState("");
  const [profile, setProfile] = useState(null);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [location, setLocation] = useState("");
  const [country, setCountry] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      const savedWallet = await loadWallet();
      setWallet(savedWallet);
      setAddress(savedWallet?.address || "");
      if (savedWallet?.address) {
        await loadProfile(savedWallet.address);
      }
    }
    load();
  }, []);

  const loadProfile = async (target = address) => {
    setError("");
    setMessage("");
    if (!target.trim()) {
      setError("Enter a wallet address.");
      return;
    }
    const result = await getProfile(target.trim());
    if (result.success) {
      const nextProfile = result.data.profile || result.data.data?.profile || result.data;
      setProfile(nextProfile);
      setDisplayName(nextProfile.display_name || "");
      setBio(nextProfile.bio || "");
      setLocation(nextProfile.location || "");
      setCountry(nextProfile.country || "");
    } else {
      setProfile(null);
      setError(result.error);
    }
  };

  const handleSave = async () => {
    setError("");
    setMessage("");
    if (!wallet?.address || address.trim() !== wallet.address) {
      setError("You can only edit the public profile for the wallet saved on this phone.");
      return;
    }
    if (displayName.trim().length < 3) {
      setError("Display name must be at least 3 characters.");
      return;
    }
    const result = await saveProfile({
      wallet_address: wallet.address,
      display_name: displayName.trim(),
      bio: bio.trim(),
      location: location.trim(),
      country: country.trim(),
      avatar_style: profile?.avatar_style || "gradient",
    });
    if (result.success) {
      setMessage("Profile saved. It is public and linked to this wallet address.");
      await loadProfile(wallet.address);
    } else {
      setError(result.error);
    }
  };

  const canEdit = wallet?.address && address.trim() === wallet.address;

  return (
    <ScrollView style={sharedStyles.screen} contentContainerStyle={sharedStyles.content}>
      <Text style={sharedStyles.title}>Profile</Text>
      <Text style={sharedStyles.subtitle}>
        Vorliq profiles are public wallet-linked community profiles. They are not verified legal identities.
      </Text>

      {message ? <Text style={sharedStyles.successText}>{message}</Text> : null}
      {error ? <Text style={sharedStyles.errorText}>{error}</Text> : null}

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.label}>Wallet Address</Text>
        <TextInput
          autoCapitalize="none"
          style={sharedStyles.input}
          value={address}
          onChangeText={setAddress}
          placeholder="Wallet address"
          placeholderTextColor={theme.textSecondary}
        />
        <Pressable style={sharedStyles.button} onPress={() => loadProfile(address)}>
          <Text style={sharedStyles.buttonText}>View Profile</Text>
        </Pressable>
      </View>

      <View style={sharedStyles.card}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{(profile?.display_name || "V").slice(0, 1).toUpperCase()}</Text>
        </View>
        <Text style={sharedStyles.sectionTitle}>{profile?.display_name || "No public profile yet"}</Text>
        <Text style={sharedStyles.mutedText}>{shortText(profile?.wallet_address || address)}</Text>
        <Text style={sharedStyles.value}>Reputation: {profile?.reputation_score || 0}</Text>
        <Text style={sharedStyles.mutedText}>{[profile?.location, profile?.country].filter(Boolean).join(", ") || "No location shared"}</Text>
        <Text style={[sharedStyles.value, styles.bio]}>{profile?.bio || "No bio shared."}</Text>
        {profile?.badges?.length ? <Text style={sharedStyles.mutedText}>Badges: {profile.badges.join(", ")}</Text> : null}
      </View>

      {canEdit ? (
        <View style={sharedStyles.card}>
          <Text style={sharedStyles.label}>Edit Public Profile</Text>
          <TextInput style={sharedStyles.input} value={displayName} onChangeText={setDisplayName} placeholder="Display name" placeholderTextColor={theme.textSecondary} />
          <TextInput multiline style={[sharedStyles.input, sharedStyles.textArea]} value={bio} onChangeText={setBio} placeholder="Bio" placeholderTextColor={theme.textSecondary} />
          <TextInput style={sharedStyles.input} value={location} onChangeText={setLocation} placeholder="Region or city" placeholderTextColor={theme.textSecondary} />
          <TextInput style={sharedStyles.input} value={country} onChangeText={setCountry} placeholder="Country" placeholderTextColor={theme.textSecondary} />
          <Pressable style={sharedStyles.button} onPress={handleSave}>
            <Text style={sharedStyles.buttonText}>Save Profile</Text>
          </Pressable>
        </View>
      ) : (
        <Text style={sharedStyles.mutedText}>Load the wallet saved on this phone to edit its profile.</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: "center",
    backgroundColor: theme.accentBlue,
    borderColor: theme.borderStrong,
    borderRadius: 28,
    borderWidth: 1,
    height: 56,
    justifyContent: "center",
    marginBottom: theme.spacing.md,
    width: 56,
  },
  avatarText: {
    color: theme.text,
    fontSize: theme.fonts.heading,
    fontWeight: "900",
  },
  bio: {
    marginTop: theme.spacing.md,
  },
});
