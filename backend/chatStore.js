const fs = require("fs");
const path = require("path");
const { atomicWriteJson, safeReadJson } = require("./jsonStore");

// Durable community chat history. Additive, isolated layer alongside the existing
// in-memory recent-messages buffer. Reuses the shared JSON store and applies the
// stale-lock recovery lesson from analytics. No third-party database.

const RETENTION_DAYS = Number(process.env.CHAT_RETENTION_DAYS || 30);
const MAX_MESSAGES = Number(process.env.CHAT_MAX_MESSAGES || 500);
const STALE_LOCK_MS = 12000;

function chatFile() {
  return process.env.CHAT_FILE || path.join(__dirname, "data", "chat.json");
}

function emptyStore() {
  return { messages: [] };
}

// A real write holds the lock for milliseconds and the shared helper gives up
// after 5s, so a chat.json.lock older than this threshold belongs to a process
// that died mid-write and would otherwise deadlock every chat write. Removing it
// is safe and never touches any other store.
function clearStaleChatLock() {
  const lockPath = `${chatFile()}.lock`;
  try {
    const stats = fs.statSync(lockPath);
    if (Date.now() - stats.mtimeMs > STALE_LOCK_MS) {
      fs.unlinkSync(lockPath);
    }
  } catch (error) {
    // No lock file, or it was removed by a concurrent writer. Nothing to do.
  }
}

function ensureStoreFile() {
  const file = chatFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) {
    atomicWriteJson(file, emptyStore());
  }
}

function readStore() {
  ensureStoreFile();
  const parsed = safeReadJson(chatFile(), emptyStore());
  return { messages: Array.isArray(parsed.messages) ? parsed.messages : [] };
}

function writeStore(store) {
  ensureStoreFile();
  clearStaleChatLock();
  atomicWriteJson(chatFile(), { messages: store.messages || [] });
}

function pruneMessages(messages, now = Date.now()) {
  const cutoff = now - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let kept = (messages || []).filter((message) => {
    const timestamp = Number(message.timestamp);
    return Number.isFinite(timestamp) && timestamp >= cutoff;
  });
  if (kept.length > MAX_MESSAGES) {
    kept = kept.slice(kept.length - MAX_MESSAGES);
  }
  return kept;
}

function appendChatMessage(message, now = Date.now()) {
  const store = readStore();
  const messages = pruneMessages(store.messages, now);
  messages.push(message);
  writeStore({ messages: pruneMessages(messages, now) });
  return message;
}

// Recent messages used to hydrate the in-memory buffer on startup.
function loadRecentMessages(limit = 100, now = Date.now()) {
  const messages = pruneMessages(readStore().messages, now);
  return messages.slice(-Math.max(1, limit));
}

// Update a stored message's moderation status (kept in sync with the live copy).
function setModerationStatus(messageId, status, replacementText) {
  const store = readStore();
  const message = store.messages.find((item) => item.message_id === messageId);
  if (!message) return null;
  message.moderation_status = status;
  if (replacementText !== undefined) message.text = replacementText;
  message.warning = "";
  writeStore(store);
  return message;
}

// Paginated, visible-only history for the public read endpoint. Moderated
// (hidden or removed) messages are excluded so they never resurface. `before`
// is a timestamp cursor for loading older messages.
function loadHistory({ limit = 50, before } = {}, now = Date.now()) {
  const visible = pruneMessages(readStore().messages, now).filter(
    (message) => message.moderation_status === "visible"
  );
  const beforeValue = Number(before);
  const older = Number.isFinite(beforeValue)
    ? visible.filter((message) => Number(message.timestamp) < beforeValue)
    : visible;
  const cappedLimit = Math.min(Math.max(1, Number(limit) || 50), 100);
  const slice = older.slice(Math.max(0, older.length - cappedLimit));
  return {
    messages: slice,
    total_visible: visible.length,
    has_more: older.length > slice.length,
    oldest_timestamp: slice.length ? Number(slice[0].timestamp) : null,
  };
}

module.exports = {
  RETENTION_DAYS,
  MAX_MESSAGES,
  chatFile,
  appendChatMessage,
  loadRecentMessages,
  setModerationStatus,
  loadHistory,
  pruneMessages,
};
