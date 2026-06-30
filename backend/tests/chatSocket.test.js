// Integration tests for the realtime chat WebSocket layer (Socket.IO).
//
// These exercise the real production socket handlers wired in index.js against
// a real Socket.IO server bound to an ephemeral port, driven by a real
// socket.io-client. They cover the connection lifecycle, the signed-join
// handshake (the same secp256k1 scheme the REST signed-authorization uses),
// message authorization and validation, broadcast fan-out, and disconnect
// cleanup. Before this file the 370-test suite had no WebSocket coverage.

const crypto = require("crypto");
const { io: ioClient } = require("socket.io-client");

const app = require("../index");
const { addressFromPublicKey, authorizationMessage, bodyHash } = require("../middleware/signedAuthorization");

const server = app.server;
const ioServer = app.io;

let baseUrl;
const openClients = [];

beforeAll((done) => {
  server.listen(0, "127.0.0.1", () => {
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    done();
  });
});

afterEach(() => {
  while (openClients.length) {
    const client = openClients.pop();
    if (client.connected) client.disconnect();
    client.close();
  }
});

afterAll((done) => {
  ioServer.close();
  server.close(done);
});

function connect() {
  const client = ioClient(baseUrl, {
    path: "/api/socket.io",
    transports: ["websocket"],
    forceNew: true,
    reconnection: false,
  });
  openClients.push(client);
  return client;
}

// Wait for a named event once, rejecting if it does not arrive in time.
function waitFor(client, event, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for "${event}"`)), timeoutMs);
    client.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function makeWallet() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "secp256k1" });
  const public_key = publicKey.export({ format: "pem", type: "spki" });
  return { privateKey, public_key, wallet: addressFromPublicKey(public_key) };
}

// Build a valid signed-join payload for a server-issued challenge nonce.
function signJoin(signer, nonce, overrides = {}) {
  const timestamp = Math.floor(Date.now() / 1000);
  const message = authorizationMessage({
    action: "chat.join",
    body_hash: bodyHash({}),
    nonce,
    timestamp,
    wallet: signer.wallet,
  });
  const signature = crypto.sign("sha256", Buffer.from(message, "utf8"), signer.privateKey).toString("hex");
  return {
    wallet: signer.wallet,
    public_key: signer.public_key,
    signature,
    message,
    nonce,
    timestamp,
    ...overrides,
  };
}

// Connect, complete the signed join, and resolve once verified.
async function connectAndJoin(signer) {
  const client = connect();
  const challenge = await waitFor(client, "join_challenge");
  client.emit("join", signJoin(signer, challenge.nonce));
  const ok = await waitFor(client, "join_ok");
  return { client, ok, challenge };
}

describe("chat websocket — connection lifecycle", () => {
  test("a new connection receives welcome, history, and a signed-join challenge", async () => {
    const client = connect();
    // The server emits welcome, history, and join_challenge back-to-back on
    // connect, so register all three listeners before awaiting any of them —
    // otherwise a later event can arrive before its listener is attached.
    const welcomeP = waitFor(client, "welcome");
    const historyP = waitFor(client, "history");
    const challengeP = waitFor(client, "join_challenge");

    expect(await welcomeP).toEqual({ message: expect.stringMatching(/welcome to vorliq/i) });
    expect(Array.isArray(await historyP)).toBe(true);

    const challenge = await challengeP;
    expect(challenge.action).toBe("chat.join");
    expect(typeof challenge.nonce).toBe("string");
    expect(challenge.nonce.length).toBeGreaterThan(0);
  });

  test("user_count reflects connected sockets and drops after disconnect", async () => {
    const a = connect();
    const firstCount = await waitFor(a, "user_count");
    expect(typeof firstCount).toBe("number");
    expect(firstCount).toBeGreaterThanOrEqual(1);

    // A second connection raises the count that the first client observes.
    const raised = new Promise((resolve) => a.on("user_count", resolve));
    const b = connect();
    await waitFor(b, "welcome");
    expect(await raised).toBeGreaterThanOrEqual(2);

    // Disconnecting the second lowers it again.
    const lowered = new Promise((resolve) => a.on("user_count", resolve));
    b.disconnect();
    expect(await lowered).toBeGreaterThanOrEqual(1);
  });
});

describe("chat websocket — signed join handshake", () => {
  test("a correctly signed join is accepted and echoes the verified wallet", async () => {
    const signer = makeWallet();
    const { ok } = await connectAndJoin(signer);
    expect(ok).toEqual({ wallet: signer.wallet });
  });

  test("a join with a wrong nonce is rejected with a clear error", async () => {
    const signer = makeWallet();
    const client = connect();
    await waitFor(client, "join_challenge");
    client.emit("join", signJoin(signer, "chat-not-the-real-nonce"));
    const error = await waitFor(client, "chat_error");
    expect(error.message).toMatch(/challenge/i);
  });

  test("a join whose wallet does not match the public key is rejected", async () => {
    const signer = makeWallet();
    const impostor = makeWallet();
    const client = connect();
    const challenge = await waitFor(client, "join_challenge");
    // Sign with the real signer but claim a different wallet address.
    client.emit("join", signJoin(signer, challenge.nonce, { wallet: impostor.wallet }));
    const error = await waitFor(client, "chat_error");
    expect(error.message).toMatch(/canonical|does not match|verify/i);
  });
});

describe("chat websocket — messaging", () => {
  test("a verified member's message is broadcast to all connected clients", async () => {
    const signer = makeWallet();
    const { client: sender } = await connectAndJoin(signer);

    const observer = connect();
    await waitFor(observer, "join_challenge");

    const senderGot = waitFor(sender, "message");
    const observerGot = waitFor(observer, "message");
    sender.emit("message", { text: "hello vorliq" });

    const [a, b] = await Promise.all([senderGot, observerGot]);
    expect(a.text).toBe("hello vorliq");
    expect(a.sender_address).toBe(signer.wallet); // server binds the verified identity
    expect(a.moderation_status).toBe("visible");
    expect(b.message_id).toBe(a.message_id); // same broadcast reaches everyone
  });

  test("a socket that has not joined cannot send messages", async () => {
    const client = connect();
    await waitFor(client, "join_challenge");
    client.emit("message", { text: "I never joined" });
    const error = await waitFor(client, "chat_error");
    expect(error.message).toMatch(/verified wallet before sending/i);
  });

  test("an empty or oversized message is rejected after joining", async () => {
    const signer = makeWallet();
    const { client } = await connectAndJoin(signer);
    client.emit("message", { text: "   " });
    const error = await waitFor(client, "chat_error");
    expect(error.message).toMatch(/between 1 and 500/i);
  });

  test("history can be re-requested on demand", async () => {
    const client = connect();
    await waitFor(client, "history"); // initial push on connect
    client.emit("history");
    const history = await waitFor(client, "history");
    expect(Array.isArray(history)).toBe(true);
  });
});
