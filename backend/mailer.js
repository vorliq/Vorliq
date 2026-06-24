const axios = require("axios");
const fs = require("fs");
const path = require("path");

const { logError } = require("./logger");

// Shared transactional email sender. This is "the email infrastructure already
// in place": the same VORLIQ_EMAIL_API_URL / _KEY / _FROM provider the monitor
// alerts and the per-event member notifications use. If the provider is not
// configured, every email is written to a log file instead of being sent, so the
// system never crashes for lack of credentials and an operator can see exactly
// what would have gone out (see NODE_OPERATOR_GUIDE section 3.1 to enable real
// delivery).

function provider() {
  return {
    apiUrl: String(process.env.VORLIQ_EMAIL_API_URL || "").trim(),
    apiKey: String(process.env.VORLIQ_EMAIL_API_KEY || "").trim(),
    from: String(process.env.VORLIQ_EMAIL_FROM || "").trim(),
  };
}

function emailConfigured() {
  const p = provider();
  return Boolean(p.apiUrl && p.apiKey && p.from);
}

function emailLogFile() {
  const dir = process.env.VORLIQ_BACKEND_DATA_DIR || path.join(__dirname, "data");
  return process.env.VORLIQ_EMAIL_LOG || path.join(dir, "emails.log");
}

function appendEmailLog(line) {
  try {
    fs.mkdirSync(path.dirname(emailLogFile()), { recursive: true });
    fs.appendFileSync(emailLogFile(), `${new Date().toISOString()} ${line}\n`);
  } catch (error) {
    logError(`[mailer] could not write email log: ${error.message}`);
  }
}

// Send one email. Never throws — a mail outage must not break the caller. Returns
// the channel used: "emailed", "email_failed_logged", "logged", or
// "skipped_no_recipient".
async function sendEmail({ to, subject, text, html }) {
  if (!to) return "skipped_no_recipient";
  const p = provider();
  if (emailConfigured()) {
    try {
      await axios.post(
        p.apiUrl,
        { from: p.from, to, subject, text, html },
        { headers: { "Content-Type": "application/json", Authorization: `Bearer ${p.apiKey}` }, timeout: 10000 }
      );
      return "emailed";
    } catch (error) {
      appendEmailLog(`EMAIL DELIVERY FAILED (${error.message}) to=${to} :: ${subject}`);
      return "email_failed_logged";
    }
  }
  appendEmailLog(`WOULD EMAIL to=${to} :: ${subject} :: ${String(text || "").slice(0, 240)}`);
  return "logged";
}

module.exports = { sendEmail, emailConfigured, provider, emailLogFile };
