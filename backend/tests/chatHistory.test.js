const fs = require("fs");
const os = require("os");
const path = require("path");
const request = require("supertest");

const app = require("../index");
const chatStore = require("../chatStore");

describe("durable chat history", () => {
  const originalChatFile = process.env.CHAT_FILE;
  let tempDir;
  let chatFile;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vorliq-chat-"));
    chatFile = path.join(tempDir, "chat.json");
    process.env.CHAT_FILE = chatFile;
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalChatFile === undefined) delete process.env.CHAT_FILE;
    else process.env.CHAT_FILE = originalChatFile;
  });

  function message(index, status = "visible") {
    return {
      message_id: `chat-${index}`,
      sender_address: "VLQ_MEMBER",
      text: `message ${index}`,
      timestamp: Date.now() - (60 - index) * 1000,
      moderation_status: status,
      warning: "",
    };
  }

  test("history endpoint returns visible messages and excludes moderated ones", async () => {
    chatStore.appendChatMessage(message(1));
    chatStore.appendChatMessage(message(2));
    chatStore.appendChatMessage(message(3));
    chatStore.setModerationStatus("chat-2", "hidden", "This chat message is hidden by community moderation review.");

    const response = await request(app).get("/api/chat/history");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    const ids = response.body.messages.map((item) => item.message_id);
    expect(ids).toContain("chat-1");
    expect(ids).toContain("chat-3");
    expect(ids).not.toContain("chat-2");
    expect(JSON.stringify(response.body)).not.toContain("hidden by community moderation review");
  });

  test("history endpoint paginates older messages with a before cursor", async () => {
    for (let index = 1; index <= 5; index += 1) {
      chatStore.appendChatMessage(message(index));
    }

    const recent = await request(app).get("/api/chat/history?limit=2");
    expect(recent.body.messages.map((item) => item.message_id)).toEqual(["chat-4", "chat-5"]);
    expect(recent.body.has_more).toBe(true);

    const older = await request(app).get(`/api/chat/history?limit=2&before=${recent.body.oldest_timestamp}`);
    expect(older.body.messages.map((item) => item.message_id)).toEqual(["chat-2", "chat-3"]);
    expect(older.body.has_more).toBe(true);

    const oldest = await request(app).get(`/api/chat/history?limit=2&before=${older.body.oldest_timestamp}`);
    expect(oldest.body.messages.map((item) => item.message_id)).toEqual(["chat-1"]);
    expect(oldest.body.has_more).toBe(false);
  });

  test("retention prunes messages older than the retention window on write", async () => {
    const old = message(1);
    old.timestamp = Date.now() - (chatStore.RETENTION_DAYS + 5) * 24 * 60 * 60 * 1000;
    fs.writeFileSync(chatFile, JSON.stringify({ messages: [old] }));

    chatStore.appendChatMessage(message(2));

    const response = await request(app).get("/api/chat/history");
    expect(response.body.messages.map((item) => item.message_id)).toEqual(["chat-2"]);
  });
});
