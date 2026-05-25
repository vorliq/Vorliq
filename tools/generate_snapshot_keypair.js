#!/usr/bin/env node

const crypto = require("crypto");
const { publicKeyId } = require("../backend/snapshotSigner");

const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
const publicPem = publicKey.export({ type: "spki", format: "pem" });
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });

console.log("Vorliq snapshot Ed25519 keypair");
console.log("");
console.log("WARNING:");
console.log("- Do not commit the private key.");
console.log("- Store the private key only as a production secret.");
console.log("- The public key can be published.");
console.log("- This tool does not write keys into the repo.");
console.log("");
console.log(`Public key id: ${publicKeyId(publicPem)}`);
console.log("");
console.log("Public key:");
console.log(publicPem.trim());
console.log("");
console.log("Private key:");
console.log(privatePem.trim());
