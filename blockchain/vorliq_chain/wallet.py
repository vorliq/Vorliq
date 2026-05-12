from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec


@dataclass
class Wallet:
    private_key: ec.EllipticCurvePrivateKey

    @classmethod
    def create(cls) -> "Wallet":
        return cls(ec.generate_private_key(ec.SECP256K1()))

    @property
    def public_key_pem(self) -> str:
        public_key = self.private_key.public_key()
        return public_key.public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        ).decode()

    @property
    def address(self) -> str:
        digest = sha256(self.public_key_pem.encode()).hexdigest()
        return f"VLQ{digest[:40]}"

    def sign(self, message: bytes) -> bytes:
        return self.private_key.sign(message, ec.ECDSA(hashes.SHA256()))
