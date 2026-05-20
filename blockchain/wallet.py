from __future__ import annotations

import hashlib

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec

from logger import vorliq_logger


BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
BASE58_ALPHABET_SET = set(BASE58_ALPHABET)
RESERVED_ADDRESSES = {"SYSTEM", "VORLIQ_TREASURY", "LENDING_POOL"}
MIN_REASONABLE_ADDRESS_LENGTH = 16
MAX_REASONABLE_ADDRESS_LENGTH = 96
_RIPEMD160_MASK = 0xFFFFFFFF
_RIPEMD160_R = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    7, 4, 13, 1, 10, 6, 15, 3, 12, 0, 9, 5, 2, 14, 11, 8,
    3, 10, 14, 4, 9, 15, 8, 1, 2, 7, 0, 6, 13, 11, 5, 12,
    1, 9, 11, 10, 0, 8, 12, 4, 13, 3, 7, 15, 14, 5, 6, 2,
    4, 0, 5, 9, 7, 12, 2, 10, 14, 1, 3, 8, 11, 6, 15, 13,
]
_RIPEMD160_R_PRIME = [
    5, 14, 7, 0, 9, 2, 11, 4, 13, 6, 15, 8, 1, 10, 3, 12,
    6, 11, 3, 7, 0, 13, 5, 10, 14, 15, 8, 12, 4, 9, 1, 2,
    15, 5, 1, 3, 7, 14, 6, 9, 11, 8, 12, 2, 10, 0, 4, 13,
    8, 6, 4, 1, 3, 11, 15, 0, 5, 12, 2, 13, 9, 7, 10, 14,
    12, 15, 10, 4, 1, 5, 8, 7, 6, 2, 13, 14, 0, 3, 9, 11,
]
_RIPEMD160_S = [
    11, 14, 15, 12, 5, 8, 7, 9, 11, 13, 14, 15, 6, 7, 9, 8,
    7, 6, 8, 13, 11, 9, 7, 15, 7, 12, 15, 9, 11, 7, 13, 12,
    11, 13, 6, 7, 14, 9, 13, 15, 14, 8, 13, 6, 5, 12, 7, 5,
    11, 12, 14, 15, 14, 15, 9, 8, 9, 14, 5, 6, 8, 6, 5, 12,
    9, 15, 5, 11, 6, 8, 13, 12, 5, 12, 13, 14, 11, 8, 5, 6,
]
_RIPEMD160_S_PRIME = [
    8, 9, 9, 11, 13, 15, 15, 5, 7, 7, 8, 11, 14, 14, 12, 6,
    9, 13, 15, 7, 12, 8, 9, 11, 7, 7, 12, 7, 6, 15, 13, 11,
    9, 7, 15, 11, 8, 6, 6, 14, 12, 13, 5, 14, 13, 13, 7, 5,
    15, 5, 8, 11, 14, 14, 6, 14, 6, 9, 12, 9, 12, 5, 15, 8,
    8, 5, 12, 9, 12, 5, 14, 6, 8, 13, 6, 5, 15, 13, 11, 11,
]
_RIPEMD160_K = [0x00000000, 0x5A827999, 0x6ED9EBA1, 0x8F1BBCDC, 0xA953FD4E]
_RIPEMD160_K_PRIME = [0x50A28BE6, 0x5C4DD124, 0x6D703EF3, 0x7A6D76E9, 0x00000000]


def base58_encode(data: bytes) -> str:
    leading_zeroes = len(data) - len(data.lstrip(b"\x00"))
    number = int.from_bytes(data, "big")

    encoded = ""
    while number > 0:
        number, remainder = divmod(number, 58)
        encoded = BASE58_ALPHABET[remainder] + encoded

    return ("1" * leading_zeroes) + (encoded or "")


def normalize_address(address: object) -> str:
    return str(address or "").replace("\x00", "").strip()


def is_reserved_address(address: object) -> bool:
    return normalize_address(address) in RESERVED_ADDRESSES


def validate_address(
    address: object,
    *,
    allow_reserved: bool = False,
    strict_length: bool = True,
    label: str = "address",
) -> tuple[bool, list[str], list[str]]:
    normalized = normalize_address(address)
    errors: list[str] = []
    warnings: list[str] = []

    if not normalized:
        errors.append(f"{label} is required.")
    else:
        reserved = is_reserved_address(normalized)
        if reserved and not allow_reserved:
            errors.append(f"{label} is a reserved system address.")
        if not reserved and any(character not in BASE58_ALPHABET_SET for character in normalized):
            errors.append(f"{label} must use the Vorliq base58 address character set.")
        if (
            not reserved
            and (len(normalized) < MIN_REASONABLE_ADDRESS_LENGTH or len(normalized) > MAX_REASONABLE_ADDRESS_LENGTH)
        ):
            message = f"{label} length is not valid for public wallet transactions."
            if strict_length:
                errors.append(message)
            else:
                warnings.append(message)

    return len(errors) == 0, errors, warnings


def ripemd160(data: bytes) -> bytes:
    try:
        hasher = hashlib.new("ripemd160")
    except ValueError:
        return _pure_python_ripemd160(data)
    hasher.update(data)
    return hasher.digest()


def _ripemd160_left_rotate(value: int, count: int) -> int:
    value &= _RIPEMD160_MASK
    return ((value << count) | (value >> (32 - count))) & _RIPEMD160_MASK


def _ripemd160_f(round_index: int, x_value: int, y_value: int, z_value: int) -> int:
    if round_index <= 15:
        return x_value ^ y_value ^ z_value
    if round_index <= 31:
        return (x_value & y_value) | (~x_value & z_value)
    if round_index <= 47:
        return (x_value | ~y_value) ^ z_value
    if round_index <= 63:
        return (x_value & z_value) | (y_value & ~z_value)
    return x_value ^ (y_value | ~z_value)


def _pure_python_ripemd160(data: bytes) -> bytes:
    message = bytearray(data)
    bit_length = (8 * len(message)) & 0xFFFFFFFFFFFFFFFF
    message.append(0x80)

    while len(message) % 64 != 56:
        message.append(0)

    message.extend(bit_length.to_bytes(8, "little"))

    h0 = 0x67452301
    h1 = 0xEFCDAB89
    h2 = 0x98BADCFE
    h3 = 0x10325476
    h4 = 0xC3D2E1F0

    for chunk_start in range(0, len(message), 64):
        chunk = message[chunk_start:chunk_start + 64]
        words = [
            int.from_bytes(chunk[index:index + 4], "little")
            for index in range(0, 64, 4)
        ]

        left_a, left_b, left_c, left_d, left_e = h0, h1, h2, h3, h4
        right_a, right_b, right_c, right_d, right_e = h0, h1, h2, h3, h4

        for index in range(80):
            temp = (
                _ripemd160_left_rotate(
                    left_a
                    + _ripemd160_f(index, left_b, left_c, left_d)
                    + words[_RIPEMD160_R[index]]
                    + _RIPEMD160_K[index // 16],
                    _RIPEMD160_S[index],
                )
                + left_e
            ) & _RIPEMD160_MASK
            left_a, left_e, left_d, left_c, left_b = (
                left_e,
                left_d,
                _ripemd160_left_rotate(left_c, 10),
                left_b,
                temp,
            )

            temp = (
                _ripemd160_left_rotate(
                    right_a
                    + _ripemd160_f(79 - index, right_b, right_c, right_d)
                    + words[_RIPEMD160_R_PRIME[index]]
                    + _RIPEMD160_K_PRIME[index // 16],
                    _RIPEMD160_S_PRIME[index],
                )
                + right_e
            ) & _RIPEMD160_MASK
            right_a, right_e, right_d, right_c, right_b = (
                right_e,
                right_d,
                _ripemd160_left_rotate(right_c, 10),
                right_b,
                temp,
            )

        temp = (h1 + left_c + right_d) & _RIPEMD160_MASK
        h1 = (h2 + left_d + right_e) & _RIPEMD160_MASK
        h2 = (h3 + left_e + right_a) & _RIPEMD160_MASK
        h3 = (h4 + left_a + right_b) & _RIPEMD160_MASK
        h4 = (h0 + left_b + right_c) & _RIPEMD160_MASK
        h0 = temp

    return b"".join(value.to_bytes(4, "little") for value in [h0, h1, h2, h3, h4])


class Wallet:
    def __init__(
        self,
        private_key: ec.EllipticCurvePrivateKey | None = None,
    ) -> None:
        self.private_key = private_key or ec.generate_private_key(ec.SECP256K1())
        self.public_key = self.private_key.public_key()
        self.address = self.generate_address()
        vorliq_logger.info("Wallet object created for address %s", self.address)

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
