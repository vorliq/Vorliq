const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { sendError } = require("../utils/apiResponse");
const { logError } = require("../logger");

const router = express.Router();

const AVATAR_DIR = path.join(__dirname, "..", "data", "avatars");
const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // hard 2MB cap on the decoded image
const MIN_IMAGE_BYTES = 64;
const MAX_DIMENSION = 1024; // bound stored resolution so storage stays small
// Raster formats only. SVG is deliberately excluded: it can carry script and is
// an XSS vector when served inline.
const SUPPORTED = {
  png: { ext: "png", mime: "image/png" },
  jpeg: { ext: "jpg", mime: "image/jpeg" },
};
const ALL_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif"];

function ensureDir() {
  try {
    fs.mkdirSync(AVATAR_DIR, { recursive: true });
  } catch (error) {
    logError(`Avatar dir create failed: ${error.message}`);
  }
}

// Storage key derived from the wallet address, so each wallet owns exactly one
// avatar slot and no two wallets can collide.
function addressKey(address) {
  return crypto.createHash("sha256").update(String(address || "")).digest("hex");
}

function decodeImageField(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  // Accept either a data URL ("data:image/png;base64,AAAA") or bare base64.
  const match = value.match(/^data:[^;,]*;base64,(.*)$/s);
  const base64 = (match ? match[1] : value).replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return null;
  try {
    return Buffer.from(base64, "base64");
  } catch (error) {
    return null;
  }
}

// Identify the image strictly from its bytes (not any client-claimed type) and
// read its real dimensions. Returns null for anything that is not a genuine
// PNG or JPEG — a disguised script or executable fails here.
function inspectImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) return null;

  // PNG: 8-byte signature, then IHDR with width/height as big-endian uint32.
  const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.subarray(0, 8).equals(PNG_SIG) && buffer.subarray(12, 16).toString("ascii") === "IHDR") {
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return { ...SUPPORTED.png, width, height };
  }

  // JPEG: starts FF D8; walk segments to a Start-Of-Frame marker for dimensions.
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    const SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      const segmentLength = buffer.readUInt16BE(offset + 2);
      if (segmentLength < 2) return null;
      if (SOF_MARKERS.has(marker)) {
        const height = buffer.readUInt16BE(offset + 5);
        const width = buffer.readUInt16BE(offset + 7);
        return { ...SUPPORTED.jpeg, width, height };
      }
      offset += 2 + segmentLength;
    }
  }

  return null;
}

function removeExistingAvatars(key) {
  for (const ext of ALL_EXTENSIONS) {
    const target = path.join(AVATAR_DIR, `${key}.${ext}`);
    try {
      if (fs.existsSync(target)) fs.unlinkSync(target);
    } catch (error) {
      logError(`Avatar cleanup failed for ${key}.${ext}: ${error.message}`);
    }
  }
}

router.post("/api/profiles/avatar", (req, res) => {
  // The signed-authority middleware has already proven control of this wallet
  // and bound it to wallet_address, so use the proven wallet as the storage key.
  const wallet = req.signedAuthorization?.wallet || String(req.body?.wallet_address || req.body?.walletAddress || "").trim();
  if (!wallet) {
    return sendError(res, 400, "VALIDATION_ERROR", "A wallet address is required.");
  }

  const buffer = decodeImageField(req.body?.image || req.body?.image_data || req.body?.imageData);
  if (!buffer) {
    return sendError(res, 400, "VALIDATION_ERROR", "Provide an image as base64 data.");
  }
  if (buffer.length < MIN_IMAGE_BYTES) {
    return sendError(res, 400, "VALIDATION_ERROR", "That image is too small to be valid.");
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    return sendError(res, 413, "IMAGE_TOO_LARGE", "Image must be 2MB or smaller.");
  }

  const info = inspectImage(buffer);
  if (!info) {
    return sendError(res, 415, "UNSUPPORTED_IMAGE", "Upload a valid PNG or JPEG image.");
  }
  if (!info.width || !info.height || info.width > MAX_DIMENSION || info.height > MAX_DIMENSION) {
    return sendError(res, 422, "IMAGE_DIMENSIONS", `Image must be ${MAX_DIMENSION}x${MAX_DIMENSION} pixels or smaller.`);
  }

  ensureDir();
  const key = addressKey(wallet);
  try {
    removeExistingAvatars(key);
    fs.writeFileSync(path.join(AVATAR_DIR, `${key}.${info.ext}`), buffer);
  } catch (error) {
    logError(`Avatar write failed for wallet ${wallet}: ${error.message}`);
    return sendError(res, 500, "AVATAR_WRITE_FAILED", "Could not save your avatar right now. Please try again.");
  }

  const updatedAt = Date.now();
  return res.json({
    success: true,
    // Cache-busting param so freshly uploaded avatars appear without a reload.
    url: `/api/profiles/avatar?address=${encodeURIComponent(wallet)}&v=${updatedAt}`,
    width: info.width,
    height: info.height,
    updated_at: updatedAt,
  });
});

router.get("/api/profiles/avatar", (req, res) => {
  const address = String(req.query.address || "").trim();
  if (!address) {
    return sendError(res, 400, "VALIDATION_ERROR", "address is required.");
  }
  const key = addressKey(address);
  for (const [ext, meta] of [["png", SUPPORTED.png], ["jpg", SUPPORTED.jpeg]]) {
    const file = path.join(AVATAR_DIR, `${key}.${ext}`);
    if (fs.existsSync(file)) {
      res.setHeader("Content-Type", meta.mime);
      res.setHeader("Cache-Control", "public, max-age=300");
      res.setHeader("X-Content-Type-Options", "nosniff");
      return res.sendFile(file);
    }
  }
  return sendError(res, 404, "AVATAR_NOT_FOUND", "No avatar set for this address.");
});

module.exports = router;
module.exports.inspectImage = inspectImage;
module.exports.decodeImageField = decodeImageField;
module.exports.addressKey = addressKey;
module.exports.AVATAR_DIR = AVATAR_DIR;
