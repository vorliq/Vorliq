// Local e2e global setup: wait for the stack to answer, then mine enough blocks
// to fund the community treasury so the faucet journey can pay out.
const { ensureTreasuryFunded, api } = require("./tests/journeys/helpers");

module.exports = async () => {
  // Wait for the Node backend (and through it, Flask) to be ready.
  const deadline = Date.now() + 60_000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const health = await api("/health/ready");
      if (health.status === 200) {
        ready = true;
        break;
      }
    } catch (error) {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!ready) {
    throw new Error("E2E stack did not become ready (Flask/Node health check failed within 60s).");
  }

  const treasury = await ensureTreasuryFunded(12);
  // eslint-disable-next-line no-console
  console.log(`[e2e] community treasury funded to ${treasury} VLQ for faucet journeys.`);
};
