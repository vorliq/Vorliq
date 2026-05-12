from __future__ import annotations

import hashlib

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec


BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def base58_encode(data: bytes) -> str:
    leading_zeroes = len(data) - len(data.lstrip(b"\x00"))
    number = int.from_bytes(data, "big")

    encoded = ""
    while number > 0:
        number, remainder = divmod(number, 58)
        encoded = BASE58_ALPHABET[remainder] + encoded

    return ("1" * leading_zeroes) + (encoded or "")


def ripemd160(data: bytes) -> bytes:
    try:
        hasher = hashlib.new("ripemd160")
    except ValueError as exc:
        raise RuntimeError("RIPEMD160 is not available in this Python/OpenSSL build.") from exc
    hasher.update(data)
    return hasher.digest()


class Wallet:
    def __init__(
        self,
        private_key: ec.EllipticCurvePrivateKey | None = None,
    ) -> None:
        self.private_key = private_key or ec.generate_private_key(ec.SECP256K1())
        self.public_key = self.private_key.public_key()
        self.address = self.generate_address()

    def public_key_bytes(self) -> bytes:
        return self.public_key.public_bytes(
            encoding=serialization.Encoding.X962,
            format=serialization.PublicFormat.UncompressedPoint,
        )

    def public_key_pem(self) -> str:
        return self.public_key.public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        ).decode("ascii")

    def private_key_pem(self) -> str:
        return self.private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        ).decode("ascii")

    @classmethod
    def from_private_key_pem(cls, private_key_pem: str) -> "Wallet":
        private_key = serialization.load_pem_private_key(
            private_key_pem.encode("ascii"),
            password=None,
        )
        if not isinstance(private_key, ec.EllipticCurvePrivateKey):
            raise TypeError("private key is not an elliptic curve key")
        return cls(private_key=private_key)

    def generate_address(self) -> str:
        sha256_hash = hashlib.sha256(self.public_key_bytes()).digest()
        public_key_hash = ripemd160(sha256_hash)
        return base58_encode(public_key_hash)

    def sign(self, data: str) -> str:
        signature = self.private_key.sign(data.encode("utf-8"), ec.ECDSA(hashes.SHA256()))
        return signature.hex()

    def sign_transaction(self, transaction: object) -> str:
        if not hasattr(transaction, "data_to_sign"):
            raise TypeError("transaction must have a data_to_sign method")
        signature = self.sign(transaction.data_to_sign())
        transaction.signature = signature
        transaction.sender_public_key = self.public_key_pem()
        return signature

    def verify_signature(self, data: str, signature: str, public_key_pem: str | None = None) -> bool:
        return verify_signature(data, signature, public_key_pem or self.public_key_pem())


def public_key_from_pem(public_key_pem: str) -> ec.EllipticCurvePublicKey:
    public_key = serialization.load_pem_public_key(public_key_pem.encode("ascii"))
    if not isinstance(public_key, ec.EllipticCurvePublicKey):
        raise TypeError("public key is not an elliptic curve key")
    return public_key


def address_from_public_key_pem(public_key_pem: str) -> str:
    public_key = public_key_from_pem(public_key_pem)
    public_key_bytes = public_key.public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint,
    )
    sha256_hash = hashlib.sha256(public_key_bytes).digest()
    public_key_hash = ripemd160(sha256_hash)
    return base58_encode(public_key_hash)


def verify_signature(data: str, signature: str, public_key_pem: str) -> bool:
    try:
        public_key = public_key_from_pem(public_key_pem)
        public_key.verify(bytes.fromhex(signature), data.encode("utf-8"), ec.ECDSA(hashes.SHA256()))
        return True
    except (InvalidSignature, ValueError, TypeError):
        return False
