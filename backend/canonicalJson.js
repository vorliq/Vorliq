const crypto = require("crypto");

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = canonicalize(value[key]);
        return result;
      }, {});
  }
  return value;
}

function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

module.exports = {
  canonicalize,
  canonicalStringify,
  sha256Hex,
};
