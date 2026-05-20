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
  const { allowReserved = false, label = "address", strictLength = true } = options;
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
      const message = `${label} length is not valid for public wallet transactions.`;
      if (strictLength) errors.push(message);
      else warnings.push(message);
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

module.exports = {
  BASE58_PATTERN,
  RESERVED_ADDRESSES,
  isReservedAddress,
  normalizeAddress,
  validateAddress,
};
