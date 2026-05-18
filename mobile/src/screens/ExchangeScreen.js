import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { acceptExchangeOffer, cancelExchangeOffer, createExchangeOffer, getExchangeOffers, getExchangeSummary, getMyExchangeTrades } from "../api";
import { loadWallet } from "../storage";
import theme from "../theme";
import { formatTimestamp, normalizeStatus, shortText, statusColor } from "../utils/format";
import sharedStyles from "./sharedStyles";

const segments = ["Browse", "Post", "My Trades", "Active", "History"];

export default function ExchangeScreen({ navigation }) {
  const [segment, setSegment] = useState("Browse");
  const [wallet, setWallet] = useState(null);
  const [summary, setSummary] = useState(null);
  const [offers, setOffers] = useState([]);
  const [myTrades, setMyTrades] = useState([]);
  const [offerType, setOfferType] = useState("buy");
  const [amount, setAmount] = useState("");
  const [price, setPrice] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    const savedWallet = await loadWallet();
    setWallet(savedWallet);
    const [summaryResult, offersResult, myResult] = await Promise.all([
      getExchangeSummary(),
      getExchangeOffers({ limit: 50 }),
      savedWallet?.address ? getMyExchangeTrades(savedWallet.address) : Promise.resolve({ success: true, data: { offers: [] } }),
    ]);
    if (summaryResult.success) setSummary(summaryResult.data.summary || summaryResult.data.data?.summary || summaryResult.data);
    if (offersResult.success) setOffers(offersResult.data.offers || offersResult.data.data?.offers || offersResult.data.data || []);
    if (myResult.success) setMyTrades(myResult.data.offers || myResult.data.trades || myResult.data.data?.offers || myResult.data.data || []);
    if (!offersResult.success) setError(offersResult.error);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleAccept = async (offerId) => {
    setError("");
    setMessage("");
    if (!wallet?.address) return setError("Create a wallet before accepting exchange offers.");
    const result = await acceptExchangeOffer({ offer_id: offerId, acceptor_address: wallet.address });
    if (result.success) {
      setMessage("Offer accepted. Complete the VLQ transfer and off-chain agreement carefully.");
      await loadData();
    } else {
      setError(result.error);
    }
  };

  const handleSubmit = async () => {
    setError("");
    setMessage("");
    if (!wallet?.address) return setError("Create a wallet before posting offers.");
    if (Number(amount) <= 0 || !price.trim() || !description.trim()) return setError("Enter a positive amount, terms, and description.");
    const result = await createExchangeOffer({ creator_address: wallet.address, offer_type: offerType, amount: Number(amount), price: price.trim(), description: description.trim() });
    if (result.success) {
      setMessage("Offer posted.");
      setAmount("");
      setPrice("");
      setDescription("");
      setSegment("Browse");
      await loadData();
    } else {
      setError(result.error);
    }
  };

  const handleCancel = async (offerId) => {
    const result = await cancelExchangeOffer({ offer_id: offerId, caller_address: wallet?.address });
    if (result.success) {
      setMessage("Offer cancelled.");
      await loadData();
    } else {
      setError(result.error);
    }
  };

  const visible =
    segment === "Browse"
      ? offers.filter((offer) => offer.status === "open")
      : segment === "My Trades"
        ? myTrades
        : segment === "Active"
          ? offers.filter((offer) => ["accepted", "vlq_pending", "vlq_confirmed", "disputed"].includes(offer.status))
          : offers.filter((offer) => ["completed", "cancelled"].includes(offer.status));

  return (
    <ScrollView style={sharedStyles.screen} contentContainerStyle={sharedStyles.content}>
      <Text style={sharedStyles.title}>Exchange</Text>
      <Text style={sharedStyles.subtitle}>
        Peer-to-peer community offers. Vorliq tracks VLQ transactions, but it cannot enforce off-chain cash, goods, or services.
      </Text>

      <View style={sharedStyles.card}>
        <Text style={sharedStyles.label}>Summary</Text>
        <Text style={sharedStyles.value}>Open offers: {summary?.open_offer_count ?? summary?.open_count ?? 0}</Text>
        <Text style={sharedStyles.value}>Active trades: {summary?.active_trade_count ?? 0}</Text>
        <Text style={sharedStyles.mutedText}>Completed: {summary?.completed_count ?? 0} | Disputed: {summary?.disputed_count ?? 0}</Text>
      </View>

      <View style={styles.segmented}>
        {segments.map((item) => (
          <Pressable key={item} style={[styles.segmentButton, segment === item && styles.segmentButtonActive]} onPress={() => setSegment(item)}>
            <Text style={[styles.segmentText, segment === item && styles.segmentTextActive]}>{item}</Text>
          </Pressable>
        ))}
      </View>

      {message ? <Text style={sharedStyles.successText}>{message}</Text> : null}
      {error ? <Text style={sharedStyles.errorText}>{error}</Text> : null}
      {loading ? <ActivityIndicator color={theme.accent} /> : null}

      {segment === "Post" ? (
        <View style={sharedStyles.card}>
          <Text style={sharedStyles.label}>Offer Type</Text>
          <View style={styles.voteToggle}>
            {["buy", "sell"].map((type) => (
              <Pressable key={type} style={[styles.voteButton, offerType === type && styles.segmentButtonActive]} onPress={() => setOfferType(type)}>
                <Text style={[styles.segmentText, offerType === type && styles.segmentTextActive]}>{type.toUpperCase()}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput keyboardType="decimal-pad" style={sharedStyles.input} placeholder="VLQ amount" placeholderTextColor={theme.textSecondary} value={amount} onChangeText={setAmount} />
          <TextInput style={sharedStyles.input} placeholder="Price or exchange terms" placeholderTextColor={theme.textSecondary} value={price} onChangeText={setPrice} />
          <TextInput multiline style={[sharedStyles.input, sharedStyles.textArea]} placeholder="Describe the trade" placeholderTextColor={theme.textSecondary} value={description} onChangeText={setDescription} />
          <Pressable style={sharedStyles.button} onPress={handleSubmit}>
            <Text style={sharedStyles.buttonText}>Post Offer</Text>
          </Pressable>
        </View>
      ) : (
        visible.length ? visible.map((offer) => (
          <OfferCard key={offer.offer_id} offer={offer} wallet={wallet} navigation={navigation} onAccept={handleAccept} onCancel={handleCancel} />
        )) : <Text style={sharedStyles.mutedText}>No exchange records returned for this view.</Text>
      )}
    </ScrollView>
  );
}

function OfferCard({ offer, wallet, navigation, onAccept, onCancel }) {
  const isCreator = wallet?.address && wallet.address === offer.creator_address;
  return (
    <View style={sharedStyles.card}>
      <View style={[sharedStyles.badge, { backgroundColor: statusColor(offer.status) }]}>
        <Text style={sharedStyles.badgeText}>{normalizeStatus(offer.status)}</Text>
      </View>
      <Text style={[sharedStyles.sectionTitle, styles.top]}>{String(offer.offer_type || "offer").toUpperCase()} {offer.amount} VLQ</Text>
      <Text style={sharedStyles.value}>{offer.price}</Text>
      <Text style={sharedStyles.mutedText}>{offer.description}</Text>
      <Text style={sharedStyles.mutedText}>Creator: {shortText(offer.creator_address, 12, 6)}</Text>
      <Text style={sharedStyles.mutedText}>Acceptor: {shortText(offer.acceptor_address, 12, 6)}</Text>
      <Text style={sharedStyles.mutedText}>Created: {formatTimestamp(offer.created_at || offer.timestamp)}</Text>
      {offer.vlq_tx_id ? (
        <Pressable style={[sharedStyles.button, sharedStyles.secondaryButton, styles.top]} onPress={() => navigation.navigate("Transaction", { txId: offer.vlq_tx_id })}>
          <Text style={sharedStyles.buttonText}>Open VLQ Transaction</Text>
        </Pressable>
      ) : null}
      {offer.status === "open" && !isCreator ? (
        <Pressable style={[sharedStyles.button, styles.top]} onPress={() => onAccept(offer.offer_id)}>
          <Text style={sharedStyles.buttonText}>Accept Offer</Text>
        </Pressable>
      ) : null}
      {offer.status === "open" && isCreator ? (
        <Pressable style={[sharedStyles.button, sharedStyles.secondaryButton, styles.top]} onPress={() => onCancel(offer.offer_id)}>
          <Text style={sharedStyles.buttonText}>Cancel Offer</Text>
        </Pressable>
      ) : null}
      {["accepted", "vlq_pending", "vlq_confirmed", "disputed"].includes(offer.status) ? (
        <Text style={[sharedStyles.warningText, styles.top]}>Record-tx, completion, and dispute actions are available on the web app in this mobile release.</Text>
      ) : null}
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
    flexWrap: "wrap",
    gap: theme.spacing.xs,
    marginVertical: theme.spacing.md,
    padding: theme.spacing.xs,
  },
  segmentButton: {
    alignItems: "center",
    borderRadius: 10,
    flexGrow: 1,
    minHeight: 42,
    justifyContent: "center",
    paddingHorizontal: theme.spacing.sm,
  },
  segmentButtonActive: {
    backgroundColor: theme.accent,
  },
  segmentText: {
    color: theme.textSecondary,
    fontWeight: "800",
  },
  segmentTextActive: {
    color: theme.background,
  },
  voteToggle: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  voteButton: {
    alignItems: "center",
    borderColor: theme.border,
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    minHeight: 46,
    justifyContent: "center",
  },
  top: {
    marginTop: theme.spacing.md,
  },
});
