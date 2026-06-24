const axios = require("axios");

const realtime = require("./realtime");
const { logInfo, logError } = require("./logger");

// On production the chain advances through Flask's in-process background miner,
// which never touches the Node /api/mining route — so the realtime fan-out that
// drives the notification bell, the live activity feed, and the no-reload balance
// refresh (block:new + wallet:credit) was only ever emitted for the rare blocks
// mined through the Node route, and effectively dead for the steady stream of
// background-mined blocks. This bridge closes that gap: it polls Flask for the
// chain tip and, when new blocks appear, fetches each one and feeds it through
// the same realtime.emitMinedBlock() path. It shares realtime's
// last-emitted-height watermark so a block already announced by the manual mine
// route is never double-broadcast.

const flaskUrl = process.env.FLASK_URL || "http://localhost:5001";
const POLL_MS = Number(process.env.VORLIQ_BLOCK_BRIDGE_POLL_MS || 8000);
// Cap how far back we ever catch up in one sweep, so a node that fell behind (or
// just booted) emits at most a bounded burst rather than replaying the chain.
const MAX_CATCHUP = 25;

async function flaskHeight() {
  const res = await axios.get(`${flaskUrl}/chain/summary`, { timeout: 6000 });
  const raw = res.data?.summary?.block_height ?? res.data?.block_height;
  const height = Number(raw);
  return Number.isFinite(height) ? height : null;
}

async function fetchBlock(index) {
  const res = await axios.get(`${flaskUrl}/chain/block/${index}`, { timeout: 6000 });
  return res.data?.block || null;
}

async function poll() {
  const height = await flaskHeight();
  if (height == null) return;

  const last = realtime.getLastEmittedBlockHeight();
  if (last < 0) {
    // First observation: baseline to the current tip so we never replay the
    // whole chain's history as a flood of "new block" notifications on boot.
    realtime.noteEmittedBlockHeight(height);
    return;
  }
  if (height <= last) return;

  const from = Math.max(last + 1, height - MAX_CATCHUP + 1);
  for (let index = from; index <= height; index += 1) {
    try {
      const block = await fetchBlock(index);
      if (block) realtime.emitMinedBlock(block);
    } catch (error) {
      logError(`[blockBridge] failed to fan out block ${index}: ${error.message}`);
    }
  }
  // Advance the watermark to the observed tip even if a fetch in the middle
  // failed, so we don't wedge on a single bad block forever.
  realtime.noteEmittedBlockHeight(height);
}

function startBlockBridge() {
  // Baseline before the first interval fires, so the very first sweep doesn't
  // treat the entire existing chain as new.
  flaskHeight()
    .then((height) => {
      if (height != null) realtime.noteEmittedBlockHeight(height);
    })
    .catch(() => {});

  const timer = setInterval(() => {
    poll().catch((error) => logError(`[blockBridge] poll failed: ${error.message}`));
  }, POLL_MS);
  timer.unref && timer.unref();
  logInfo(`Block bridge started: Flask-mined blocks fan out to realtime every ${POLL_MS} ms.`);
  return timer;
}

module.exports = { startBlockBridge, poll, flaskHeight, fetchBlock };
