import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { toast } from "react-toastify";

import { useAuth } from "../context/AuthContext";

function socketUrl() {
  if (window.location.hostname === "localhost") {
    return "http://localhost:5000";
  }
  return window.location.origin;
}

function Chat() {
  const { wallet, isLoggedIn } = useAuth();
  const [walletAddress, setWalletAddress] = useState(isLoggedIn ? wallet.address : "");
  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState("");
  const [connectedUsers, setConnectedUsers] = useState(0);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);
  const walletAddressRef = useRef(walletAddress);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    walletAddressRef.current = walletAddress;
  }, [walletAddress]);

  useEffect(() => {
    const socket = io(socketUrl(), {
      path: "/api/socket.io",
      transports: ["websocket", "polling"],
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      if (walletAddressRef.current.trim()) {
        socket.emit("join", walletAddressRef.current.trim());
      }
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("welcome", (payload) => toast.info(payload.message));
    socket.on("history", (history) => setMessages(Array.isArray(history) ? history : []));
    socket.on("message", (message) => setMessages((current) => [...current, message].slice(-100)));
    socket.on("user_count", (count) => setConnectedUsers(Number(count) || 0));
    socket.on("chat_error", (payload) => toast.error(payload.message));
    socket.emit("history");

    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (isLoggedIn) {
      setWalletAddress(wallet.address);
    }
  }, [isLoggedIn, wallet]);

  useEffect(() => {
    if (socketRef.current?.connected && walletAddress.trim()) {
      socketRef.current.emit("join", walletAddress.trim());
    }
  }, [walletAddress]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function sendMessage(event) {
    event.preventDefault();
    const text = messageText.trim();
    if (!walletAddress.trim()) {
      toast.error("Enter your wallet address before chatting.");
      return;
    }
    if (!text) {
      return;
    }
    if (text.length > 500) {
      toast.error("Messages must be 500 characters or fewer.");
      return;
    }

    socketRef.current?.emit("message", {
      sender_address: walletAddress.trim(),
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

        <div className="field">
          <label>Wallet Address</label>
          <input
            className="input"
            value={walletAddress}
            onChange={(event) => setWalletAddress(event.target.value)}
            placeholder="Your VLQ wallet address"
          />
        </div>

        <div className="chat-window">
          {messages.length === 0 ? (
            <div className="empty-state">No messages yet. Start the conversation.</div>
          ) : (
            messages.map((message, index) => {
              const own = message.sender_address === walletAddress.trim();
              return (
                <article className={`chat-message ${own ? "own" : ""}`} key={`${message.timestamp}-${index}`}>
                  <span>{shorten(message.sender_address)} · {timeAgo(message.timestamp)}</span>
                  <p>{message.text}</p>
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
            placeholder="Write a message"
          />
          <button className="button" type="submit">Send</button>
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
  return new Date(milliseconds).toLocaleString();
}

export default Chat;
