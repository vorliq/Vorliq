import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { toast } from "react-toastify";

import ReportButton from "../components/ReportButton";
import { useAuth } from "../context/AuthContext";
import api from "../helpers/api";
import { loadWallet } from "../helpers/storage";
import { signMessage } from "../helpers/signer";
import { authorityBodyHash, authorityMessage } from "../helpers/signedAuthority";

function socketUrl() {
  if (window.location.hostname === "localhost") {
    return "http://localhost:5000";
  }
  return window.location.origin;
}

function Chat() {
  const { wallet, isLoggedIn } = useAuth();
  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState("");
  const [connectedUsers, setConnectedUsers] = useState(0);
  const [connected, setConnected] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(true);
  // Signed-join handshake state. A wallet can only chat under an address it
  // proves it controls, so sending is gated behind a signed join challenge.
  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinPassword, setJoinPassword] = useState("");
  const [joinError, setJoinError] = useState("");
  const socketRef = useRef(null);
  const challengeRef = useRef("");
  const messagesEndRef = useRef(null);
  // Mirror `joined` so the long-lived socket handlers read the current value
  // without re-binding; kept in sync by the effect below.
  const joinedRef = useRef(false);
  const address = wallet?.address;

  useEffect(() => {
    const socket = io(socketUrl(), {
      path: "/api/socket.io",
      transports: ["websocket", "polling"],
    });
    socketRef.current = socket;

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => {
      setConnected(false);
      // Identity binding lives on the server socket; a reconnect must re-prove it.
      setJoined(false);
      challengeRef.current = "";
    });
    socket.on("welcome", (payload) => toast.info(payload.message));
    socket.on("history", (history) => setMessages(Array.isArray(history) ? history : []));
    socket.on("message", (message) => setMessages((current) => [...current, message].slice(-100)));
    socket.on("user_count", (count) => setConnectedUsers(Number(count) || 0));
    socket.on("join_challenge", (payload) => {
      challengeRef.current = payload?.nonce || "";
    });
    socket.on("join_ok", () => {
      setJoined(true);
      setJoining(false);
      setJoinError("");
      setJoinPassword("");
      toast.success("Wallet verified — you can chat now.");
    });
    socket.on("chat_error", (payload) => {
      // While not yet joined, a chat_error is a join failure; surface it inline.
      setJoining(false);
      setJoinError((prev) => (joinedRef.current ? prev : payload?.message || "Could not verify your wallet for chat."));
      toast.error(payload?.message || "Chat error.");
    });
    socket.emit("history");

    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    joinedRef.current = joined;
  }, [joined]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function loadOlderMessages() {
    if (loadingOlder || messages.length === 0) return;
    setLoadingOlder(true);
    try {
      const before = Number(messages[0]?.timestamp);
      const response = await api.get("/chat/history", {
        params: { limit: 30, ...(Number.isFinite(before) ? { before } : {}) },
      });
      const older = response.data.messages || [];
      setMessages((current) => {
        const seen = new Set(current.map((item) => item.message_id));
        return [...older.filter((item) => !seen.has(item.message_id)), ...current];
      });
      setHasOlder(Boolean(response.data.has_more));
    } catch (error) {
      toast.error("Unable to load older messages right now.");
    } finally {
      setLoadingOlder(false);
    }
  }

  // Prove control of the connected wallet by signing the server's challenge
  // nonce locally. The private key is decrypted in this browser only (with the
  // password) and never sent; only the signature, message, and public key go to
  // the server, which re-derives the address and verifies the signature.
  async function handleJoin(event) {
    event.preventDefault();
    setJoinError("");
    if (!isLoggedIn || !address) {
      setJoinError("Sign in to your wallet to join chat.");
      return;
    }
    const nonce = challengeRef.current;
    if (!nonce) {
      setJoinError("Still connecting to chat. Try again in a moment.");
      return;
    }
    if (!joinPassword) {
      setJoinError("Enter your wallet password to sign the chat join locally.");
      return;
    }
    setJoining(true);
    try {
      const localWallet = await loadWallet(joinPassword);
      const timestamp = Math.floor(Date.now() / 1000);
      const bodyHash = await authorityBodyHash({});
      const message = authorityMessage({ action: "chat.join", bodyHash, nonce, timestamp, wallet: localWallet.address });
      const signature = await signMessage({ privateKeyPem: localWallet.private_key, message });
      socketRef.current?.emit("join", {
        wallet: localWallet.address,
        public_key: localWallet.public_key,
        signature,
        message,
        nonce,
        timestamp,
      });
      // join_ok or chat_error resolves the joining state.
    } catch (error) {
      setJoining(false);
      setJoinError(
        error?.message === "Incorrect password or corrupted saved wallet." || error?.message === "No saved Vorliq wallet found."
          ? error.message
          : "Could not sign the chat join. Check your wallet password and try again."
      );
    }
  }

  function sendMessage(event) {
    event.preventDefault();
    const text = messageText.trim();
    if (!joined) {
      toast.error("Join chat with your verified wallet before sending messages.");
      return;
    }
    if (!text) {
      return;
    }
    if (text.length > 500) {
      toast.error("Messages must be 500 characters or fewer.");
      return;
    }
    if (/private key|seed phrase|double your|guaranteed profit/i.test(text)) {
      toast.warn("This message contains scam-risk wording. Chat is public; never share private keys or recovery material.");
    }

    // The server attributes the message to this socket's verified identity; no
    // client-supplied sender address is sent or trusted.
    socketRef.current?.emit("message", {
      text,
      timestamp: Date.now(),
    });
    setMessageText("");
  }

  return (
    <div className="page">
      <section className="hero">
        <span className="eyebrow">Live Community</span>
        <h1>Chat</h1>
        <p className="subtitle">
          Talk with Vorliq members in real time inside the application.
        </p>
        <div className="risk-box">
          <strong>Public chat, kept for a limited time</strong>
          <p>
            This chat is public and is kept for up to 30 days. It is not private messaging. Older messages can be
            loaded for that window, and messages removed by moderation are not shown. Never share private keys, seed
            phrases, passwords, or backup files here.
          </p>
        </div>
      </section>

      <section className="card card-pad chat-shell">
        <div className="chat-header">
          <div>
            <h2>Vorliq Community Chat</h2>
            <span className={connected ? "green" : "warning"}>
              {connected ? "Connected" : "Connecting..."}
            </span>
          </div>
          <strong>{connectedUsers} online</strong>
        </div>

        {/* Identity gate: chatting under a wallet address requires proving you
            control it. Reading the public chat stays open to everyone. */}
        {!joined && (
          <div className="field">
            {!isLoggedIn ? (
              <p className="help-text">
                You can read the public chat below. <a href="/login">Sign in to your wallet</a> to verify your address
                and send messages.
              </p>
            ) : (
              <form className="chat-join" onSubmit={handleJoin}>
                <label htmlFor="chat-join-password">
                  Verify wallet to chat as <strong>{shorten(address)}</strong>
                </label>
                <p className="help-text">
                  Your password decrypts your key in this browser only to sign a one-time challenge. It is never sent.
                </p>
                <input
                  id="chat-join-password"
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  value={joinPassword}
                  onChange={(event) => setJoinPassword(event.target.value)}
                  placeholder="Wallet password"
                />
                {joinError && <small className="warning">{joinError}</small>}
                <button className="button" type="submit" disabled={joining}>
                  {joining ? "Verifying..." : "Verify and join chat"}
                </button>
              </form>
            )}
          </div>
        )}

        <div className="chat-window">
          {messages.length > 0 && hasOlder ? (
            <div className="chat-load-older">
              <button className="button secondary small-button" type="button" onClick={loadOlderMessages} disabled={loadingOlder}>
                {loadingOlder ? "Loading..." : "Load older messages"}
              </button>
            </div>
          ) : null}
          {messages.length === 0 ? (
            <div className="empty-state">No messages yet. Start the conversation.</div>
          ) : (
            messages.map((message, index) => {
              const own = address && message.sender_address === address;
              return (
                <article className={`chat-message ${own ? "own" : ""}`} key={message.message_id || `${message.timestamp}-${index}`}>
                  <span>{shorten(message.sender_address)} - {timeAgo(message.timestamp)}</span>
                  {message.warning && <small className="warning">{message.warning}</small>}
                  <p>{message.text}</p>
                  {message.message_id && <ReportButton targetType="chat_message" targetId={message.message_id} defaultReporter={address} />}
                </article>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        <form className="chat-form" onSubmit={sendMessage}>
          <input
            className="input"
            aria-label="Chat message"
            value={messageText}
            maxLength={500}
            onChange={(event) => setMessageText(event.target.value)}
            placeholder={joined ? "Write a message" : "Verify your wallet above to chat"}
            disabled={!joined}
          />
          <button className="button" type="submit" disabled={!joined}>Send</button>
        </form>
      </section>
    </div>
  );
}

function shorten(address) {
  if (!address) return "Unknown";
  return address.length > 12 ? `${address.slice(0, 12)}...` : address;
}

function timeAgo(timestamp) {
  const value = Number(timestamp);
  const milliseconds = value > 10_000_000_000 ? value : value * 1000;
  const seconds = Math.max(Math.floor((Date.now() - milliseconds) / 1000), 0);
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return `${days} days ago`;
}

export default Chat;
