import AsyncStorage from "@react-native-async-storage/async-storage";

export const WALLET_KEY = "vorliq_wallet";
export const NODE_URL_KEY = "vorliq_node_url";
export const DEFAULT_NODE_URL = "http://192.168.1.1:5000";

export async function saveWallet(wallet) {
  if (!wallet || !wallet.address || !wallet.public_key || !wallet.private_key) {
    throw new Error("Wallet is missing required fields.");
  }

  await AsyncStorage.setItem(WALLET_KEY, JSON.stringify(wallet));
}

export async function loadWallet() {
  const rawWallet = await AsyncStorage.getItem(WALLET_KEY);

  if (!rawWallet) {
    return null;
  }

  try {
    return JSON.parse(rawWallet);
  } catch (error) {
    await clearWallet();
    return null;
  }
}

export async function clearWallet() {
  await AsyncStorage.removeItem(WALLET_KEY);
}

export async function saveNodeUrl(nodeUrl) {
  const cleanUrl = String(nodeUrl || "").trim().replace(/\/+$/, "");

  if (!cleanUrl.startsWith("http://") && !cleanUrl.startsWith("https://")) {
    throw new Error("Node URL must start with http:// or https://.");
  }

  await AsyncStorage.setItem(NODE_URL_KEY, cleanUrl);
}

export async function loadNodeUrl() {
  const savedUrl = await AsyncStorage.getItem(NODE_URL_KEY);
  return savedUrl || DEFAULT_NODE_URL;
}
