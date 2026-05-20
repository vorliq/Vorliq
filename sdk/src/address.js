const BASE58_PATTERN = /^[1-9A-HJ-NP-Za-km-z]+$/;
const RESERVED_ADDRESSES = new Set(["SYSTEM", "VORLIQ_TREASURY", "LENDING_POOL"]);
const MIN_REASONABLE_ADDRESS_LENGTH = 16;
const MAX_REASONABLE_ADDRESS_LENGTH = 96;
const NULL_CHARACTER = String.fromCharCode(0);

function normalizeAddress(address) {
  return String(address || "").split(NULL_CHARACTER).join("").trim();
}

function isReservedAddress(address) {
  return RESERVED_ADDRESSES.has(normalizeAddress(address));
}

function validateAddress(address, options = {}) {
  const { allowReserved = false, label = "address" } = options;
  const normalized = normalizeAddress(address);
  const errors = [];
  const warnings = [];

  if (!normalized) {
    errors.push(`${label} is required.`);
  } else {
    const reserved = isReservedAddress(normalized);
    if (reserved && !allowReserved) {
      errors.push(`${label} is a reserved system address.`);
    }
    if (!reserved && !BASE58_PATTERN.test(normalized)) {
      errors.push(`${label} must use the Vorliq base58 address character set.`);
    }
    if (!reserved && (normalized.length < MIN_REASONABLE_ADDRESS_LENGTH || normalized.length > MAX_REASONABLE_ADDRESS_LENGTH)) {
      warnings.push(`${label} length is unusual for a Vorliq wallet. Verify it carefully before sending.`);
    }
  }

  return {
    address: normalized,
    valid: errors.length === 0,
    looksValid: errors.length === 0 && warnings.length === 0,
    errors,
    warnings,
  };
}

function createTransactionReview(from, to, amount, options = {}) {
  const sender = validateAddress(from, { label: "sender address" });
  const receiver = validateAddress(to, { label: "receiver address" });
  const numericAmount = Number(amount);
  const errors = [...sender.errors, ...receiver.errors];
  const warnings = [...sender.warnings, ...receiver.warnings];

  if (sender.address && receiver.address && sender.address === receiver.address) {
    errors.push("Sender and receiver cannot be the same address.");
  }
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    errors.push("Amount must be greater than 0 VLQ.");
  }
  if (options.balance !== undefined && options.balance !== null) {
    const numericBalance = Number(options.balance);
    if (Number.isFinite(numericBalance) && numericAmount > numericBalance) {
      errors.push("Amount is greater than the available confirmed balance.");
    }
  }

  return {
    from: sender.address,
    to: receiver.address,
    amount: numericAmount,
    sender,
    receiver,
    warnings,
    errors,
    canSubmit: errors.length === 0,
    status: "pending until mined",
    irreversible: true,
  };
}

function assertTransactionReview(review) {
  if (!review.canSubmit) {
    throw new Error(review.errors[0] || "Transaction review failed.");
  }
}

module.exports = {
  RESERVED_ADDRESSES,
  createTransactionReview,
  isReservedAddress,
  normalizeAddress,
  validateAddress,
  assertTransactionReview,
};
