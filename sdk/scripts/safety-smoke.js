const assert = require("assert");
const VorliqSDK = require("../src");

const validAddress = "3MNQE1X7T4Bz9kLmNpQrStUvWx";

assert.strictEqual(VorliqSDK.validateAddress(validAddress).valid, true);
assert.strictEqual(VorliqSDK.isReservedAddress("SYSTEM"), true);

const review = VorliqSDK.createTransactionReview(validAddress, "7YWHMfk9JZe9LMQaPq2X3B4C5D", 1.25);
assert.strictEqual(review.canSubmit, true);
assert.strictEqual(review.status, "pending until mined");

const sameAddressReview = VorliqSDK.createTransactionReview(validAddress, validAddress, 1);
assert.strictEqual(sameAddressReview.canSubmit, false);
assert.match(sameAddressReview.errors.join(" "), /same address/i);

const sdk = new VorliqSDK({ nodeUrl: "https://vorliq.org" });
sdk
  .sendTransaction("SYSTEM", "not-used", "not-used", validAddress, 1)
  .then(() => {
    throw new Error("reserved sender should be rejected before signing or network calls");
  })
  .catch((error) => {
    assert.match(error.message, /reserved system address/i);
    console.log("SDK safety smoke passed");
  });
