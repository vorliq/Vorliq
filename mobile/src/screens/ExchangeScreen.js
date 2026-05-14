import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  acceptExchangeOffer,
  cancelExchangeOffer,
  completeExchangeOffer,
  createExchangeOffer,
  getExchangeOffers,
  getMyExchangeOffers,
} from "../api";
import { loadWallet } from "../storage";
import theme from "../theme";
import sharedStyles from "./sharedStyles";

function shortAddress(address) {
  if (!address) return "None";
  return address.length > 12 ? `${address.slice(0, 12)}...` : address;
}

function statusColor(status) {
  if (status === "open") return theme.success;
  if (status === "accepted") return theme.warning;
  if (status === "completed") return theme.accent;
  return theme.error;
}

function typeColor(type) {
  return type === "buy" ? theme.success : theme.warning;
}

function normalizeOffers(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.offers)) return raw.offers;
  if (Array.isArray(raw?.data)) return raw.data;
  return [];
}

export default function ExchangeScreen() {
  const [activeSegment, setActiveSegment] = useState("Browse");
  const [wallet, setWallet] = useState(null);
  const [openOffers, setOpenOffers] = useState([]);
  const [myOffers, setMyOffers] = useState([]);
  const [offerType, setOfferType] = useState("buy");
  const [amount, setAmount] = useState("");
  const [price, setPrice] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    setError("");
    const savedWallet = await loadWallet();
    setWallet(savedWallet);

    const openResult = await getExchangeOffers();
    if (openResult.success) {
      setOpenOffers(normalizeOffers(openResult.data));
    } else {
      setError(openResult.error);
    }

    if (savedWallet?.address) {
      const myResult = await getMyExchangeOffers(savedWallet.address);
      if (myResult.success) {
        setMyOffers(normalizeOffers(myResult.data));
      }
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleAccept = async (offerId) => {
    setError("");
    setMessage("");

    if (!wallet?.address) {
      setError("Create a wallet before accepting exchange offers.");
      return;
    }

    const result = await acceptExchangeOffer({
      offer_id: offerId,
      acceptor_address: wallet.address,
    });

    if (result.success) {
      setMessage("Offer accepted.");
      await loadData();
    } else {
      setError(result.error);
    }
  };

  const handleSubmit = async () => {
    setError("");
    setMessage("");

    if (!wallet?.address) {
      setError("Create a wallet before posting exchange offers.");
      return;
    }

    if (Number(amount) <= 0 || !price.trim() || !description.trim()) {
      setError("Enter a positive amount, a price, and a description.");
      return;
    }

    const result = await createExchangeOffer({
      creator_address: wallet.address,
      offer_type: offerType,
      amount: Number(amount),
      price: price.trim(),
      description: description.trim(),
    });

    if (result.success) {
      setMessage("Offer posted.");
      setAmount("");
      setPrice("");
      setDescription("");
      setActiveSegment("Browse");
      await loadData();
    } else {
      setError(result.error);
    }
  };

  const handleAction = async (offerId, action) => {
    setError("");
    setMessage("");

    const payload = {
      offer_id: offerId,
      caller_address: wallet?.address,
    };
    const result =
      action === "cancel"
        ? await cancelExchangeOffer(payload)
        : await completeExchangeOffer(payload);

    if (result.success) {
      setMessage(action === "cancel" ? "Offer cancelled." : "Offer completed.");
      await loadData();
    } else {
      setError(result.error);
    }
  };

  const renderBrowse = () => {
    if (openOffers.length === 0) {
      return <Text style={sharedStyles.mutedText}>No open exchange offers are available yet.</Text>;
    }

    return openOffers.map((offer) => (
      <OfferCard key={offer.offer_id} offer={offer}>
        <Pressable style={sharedStyles.button} onPress={() => handleAccept(offer.offer_id)}>
          <Text style={sharedStyles.buttonText}>Accept</Text>
        </Pressable>
      </OfferCard>
    ));
  };

  const renderPost = () => (
    <View style={sharedStyles.card}>
      <Text style={sharedStyles.label}>Offer Type</Text>
      <View style={styles.typeToggle}>
        {["buy", "sell"].map((type) => (
          <Pressable
            key={type}
            style={[styles.typeButton, offerType === type && styles.typeButtonActive]}
            onPress={() => setOfferType(type)}
          >
            <Text style={[styles.typeText, offerType === type && styles.typeTextActive]}>{type.toUpperCase()}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={sharedStyles.label}>Amount of VLQ</Text>
      <TextInput
        keyboardType="decimal-pad"
        style={sharedStyles.input}
        placeholder="100"
        placeholderTextColor={theme.textSecondary}
        value={amount}
        onChangeText={setAmount}
      />

      <Text style={sharedStyles.label}>Price</Text>
      <TextInput
        style={sharedStyles.input}
        placeholder="10 USD or one bag of vegetables"
        placeholderTextColor={theme.textSecondary}
        value={price}
        onChangeText={setPrice}
      />

      <Text style={sharedStyles.label}>Description</Text>
      <TextInput
        multiline
        style={[sharedStyles.input, sharedStyles.textArea]}
        placeholder="Explain the trade terms"
        placeholderTextColor={theme.textSecondary}
        value={description}
        onChangeText={setDescription}
      />

      <Pressable style={sharedStyles.button} onPress={handleSubmit}>
        <Text style={sharedStyles.buttonText}>Submit</Text>
      </Pressable>
    </View>
  );

  const renderMine = () => {
    if (!wallet?.address) {
      return <Text style={sharedStyles.errorText}>Create a wallet before viewing your offers.</Text>;
    }

    if (myOffers.length === 0) {
      return <Text style={sharedStyles.mutedText}>No exchange offers found for your wallet.</Text>;
    }

    return myOffers.map((offer) => (
      <OfferCard key={offer.offer_id} offer={offer} showStatus>
        {offer.status === "open" ? (
          <Pressable style={[sharedStyles.button, sharedStyles.secondaryButton]} onPress={() => handleAction(offer.offer_id, "cancel")}>
            <Text style={sharedStyles.buttonText}>Cancel</Text>
          </Pressable>
        ) : null}
        {offer.status === "accepted" ? (
          <Pressable style={sharedStyles.button} onPress={() => handleAction(offer.offer_id, "complete")}>
            <Text style={sharedStyles.buttonText}>Complete</Text>
          </Pressable>
        ) : null}
      </OfferCard>
    ));
  };

  return (
    <ScrollView style={sharedStyles.screen} contentContainerStyle={sharedStyles.content}>
      <Text style={sharedStyles.title}>Exchange</Text>
      <Text style={sharedStyles.subtitle}>Buy and sell VLQ directly with your community.</Text>

      <View style={styles.segmented}>
        {["Browse", "Post", "My Offers"].map((segment) => (
          <Pressable
            key={segment}
            style={[styles.segmentButton, activeSegment === segment && styles.segmentButtonActive]}
            onPress={() => setActiveSegment(segment)}
          >
            <Text style={[styles.segmentText, activeSegment === segment && styles.segmentTextActive]}>{segment}</Text>
          </Pressable>
        ))}
      </View>

      {message ? <Text style={sharedStyles.successText}>{message}</Text> : null}
      {error ? <Text style={sharedStyles.errorText}>{error}</Text> : null}

      {loading ? (
        <ActivityIndicator size="large" color={theme.accent} />
      ) : (
        <>
          {activeSegment === "Browse" && renderBrowse()}
          {activeSegment === "Post" && renderPost()}
          {activeSegment === "My Offers" && renderMine()}
        </>
      )}
    </ScrollView>
  );
}

function OfferCard({ offer, children, showStatus = false }) {
  return (
    <View style={sharedStyles.card}>
      <View style={styles.offerHeader}>
        <View style={[sharedStyles.badge, { backgroundColor: typeColor(offer.offer_type) }]}>
          <Text style={sharedStyles.badgeText}>{offer.offer_type}</Text>
        </View>
        {showStatus ? (
          <View style={[sharedStyles.badge, { backgroundColor: statusColor(offer.status) }]}>
            <Text style={sharedStyles.badgeText}>{offer.status}</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.amount}>{offer.amount} VLQ</Text>
      <Text style={sharedStyles.label}>Price</Text>
      <Text style={sharedStyles.value}>{offer.price}</Text>
      <Text style={[sharedStyles.label, styles.marginTop]}>Description</Text>
      <Text style={sharedStyles.value}>{offer.description}</Text>
      <Text style={[sharedStyles.label, styles.marginTop]}>Creator</Text>
      <Text style={sharedStyles.value}>{shortAddress(offer.creator_address)}</Text>
      <Text style={[sharedStyles.label, styles.marginTop]}>Posted</Text>
      <Text style={sharedStyles.mutedText}>{new Date(offer.timestamp * 1000).toLocaleString()}</Text>
      <View style={styles.actions}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  segmented: {
    backgroundColor: theme.card,
    borderColor: theme.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    marginVertical: theme.spacing.md,
    padding: theme.spacing.xs,
  },
  segmentButton: {
    alignItems: "center",
    borderRadius: 10,
    flex: 1,
    minHeight: 44,
    justifyContent: "center",
  },
  segmentButtonActive: {
    backgroundColor: theme.accent,
  },
  segmentText: {
    color: theme.textSecondary,
    fontWeight: "800",
  },
  segmentTextActive: {
    color: theme.text,
  },
  typeToggle: {
    flexDirection: "row",
    marginBottom: theme.spacing.md,
  },
  typeButton: {
    alignItems: "center",
    borderColor: theme.border,
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    marginRight: theme.spacing.sm,
    minHeight: 50,
    justifyContent: "center",
  },
  typeButtonActive: {
    backgroundColor: theme.accent,
  },
  typeText: {
    color: theme.textSecondary,
    fontWeight: "800",
  },
  typeTextActive: {
    color: theme.text,
  },
  offerHeader: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    justifyContent: "space-between",
    marginBottom: theme.spacing.md,
  },
  amount: {
    color: theme.text,
    fontSize: theme.fonts.heading,
    fontWeight: "800",
    marginBottom: theme.spacing.md,
  },
  marginTop: {
    marginTop: theme.spacing.md,
  },
  actions: {
    marginTop: theme.spacing.md,
  },
});
