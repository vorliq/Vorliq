from __future__ import annotations

import hashlib
import json
import re
import time
from typing import Any

from cryptography.exceptions import UnsupportedAlgorithm
from cryptography.hazmat.primitives.asymmetric import ec

from wallet import address_from_public_key_pem, is_reserved_address, public_key_from_pem, validate_address, verify_signature


AUTHORIZATION_DOMAIN = "vorliq.authority.v1"
AUTHORIZATION_MAX_AGE_SECONDS = 300
AUTHORIZATION_FUTURE_SKEW_SECONDS = 30
NONCE_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{16,128}$")
BODY_HASH_PATTERN = re.compile(r"^[a-f0-9]{64}$")
ROLE_LIKE_IDENTITIES = {"admin", "operator", "moderator", "system", "vorliq_treasury", "lending_pool"}
OVERRIDE_FIELDS = {
    "authority_override",
    "authorityOverride",
    "balance",
    "current_treasury_balance",
    "currentTreasuryBalance",
    "source_balance",
    "sourceBalance",
    "treasury_balance",
    "treasuryBalance",
    "vote_weight",
    "voteWeight",
    "voter_balance",
    "voterBalance",
    "voting_balance",
    "votingBalance",
}
AUTHORITY_ROUTES = {
    "/governance/propose": ("governance.propose", ("proposer_address", "proposerAddress")),
    "/governance/vote": ("governance.vote", ("voter_address", "voterAddress")),
    "/governance/cancel": ("governance.cancel", ("proposer_address", "proposerAddress")),
    "/treasury/propose": ("treasury.propose", ("proposer_address", "proposerAddress")),
    "/treasury/vote": ("treasury.vote", ("voter_address", "voterAddress")),
    "/treasury/cancel": ("treasury.cancel", ("proposer_address", "proposerAddress")),
    "/lending/request": ("lending.request", ("requester_address", "requesterAddress")),
    "/lending/vote": ("lending.vote", ("voter_address", "voterAddress")),
    "/lending/repay": ("lending.repay", ("repayer_address", "repayerAddress")),
}


class SignedAuthorizationError(ValueError):
    def __init__(self, code: str, message: str, status: int = 401) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


def canonical_json(value: Any) -> str:
    try:
        return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise SignedAuthorizationError("AUTHORIZATION_MALFORMED", "Signed payload contains an unsupported value.") from exc


def body_without_authorization(body: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in body.items() if key != "authorization"}


def body_hash(payload: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_json(payload).encode("utf-8")).hexdigest()


def authorization_message(*, action: str, body_hash_value: str, nonce: str, timestamp: int, wallet: str) -> str:
    return canonical_json(
        {
            "action": action,
            "body_hash": body_hash_value,
            "domain": AUTHORIZATION_DOMAIN,
            "nonce": nonce,
            "timestamp": timestamp,
            "wallet": wallet,
        }
    )


def _actor_from_payload(payload: dict[str, Any], actor_fields: tuple[str, ...]) -> str:
    values = [str(payload[field]).strip() for field in actor_fields if field in payload]
    if not values or any(value != values[0] for value in values):
        raise SignedAuthorizationError("AUTHORIZATION_ACTOR_MISMATCH", "Signed authorization wallet must match the route actor.")
    return values[0]


def verify_signed_authorization(
    body: dict[str, Any],
    route: str,
    *,
    storage: Any,
    now_seconds: int | None = None,
) -> dict[str, Any] | None:
    route_config = AUTHORITY_ROUTES.get(route)
    if route_config is None:
        return None
    authorization = body.get("authorization")
    if not isinstance(authorization, dict):
        raise SignedAuthorizationError(
            "SIGNED_AUTHORIZATION_REQUIRED",
            "This write requires signed wallet authorization. Read-only records remain available.",
            503,
        )
    required = {"wallet", "public_key", "signature", "message", "timestamp", "nonce", "action", "body_hash", "domain"}
    if any(authorization.get(field) is None for field in required):
        raise SignedAuthorizationError("AUTHORIZATION_MALFORMED", "Signed authorization envelope is incomplete.")

    wallet = str(authorization["wallet"]).strip()
    public_key = str(authorization["public_key"])
    signature = str(authorization["signature"]).strip()
    action = str(authorization["action"]).strip()
    nonce = str(authorization["nonce"]).strip()
    claimed_body_hash = str(authorization["body_hash"]).strip().lower()
    timestamp = authorization["timestamp"]
    payload = body_without_authorization(body)
    now = int(time.time()) if now_seconds is None else int(now_seconds)

    if len(wallet) > 96 or len(public_key) > 2000 or len(signature) > 512 or len(str(authorization["message"])) > 2000:
        raise SignedAuthorizationError("AUTHORIZATION_MALFORMED", "Signed authorization envelope exceeds safe field limits.")
    if not isinstance(timestamp, int) or not NONCE_PATTERN.fullmatch(nonce) or not BODY_HASH_PATTERN.fullmatch(claimed_body_hash):
        raise SignedAuthorizationError("AUTHORIZATION_MALFORMED", "Signed authorization timestamp, nonce, or body hash is malformed.")
    if timestamp < now - AUTHORIZATION_MAX_AGE_SECONDS or timestamp > now + AUTHORIZATION_FUTURE_SKEW_SECONDS:
        raise SignedAuthorizationError("AUTHORIZATION_EXPIRED", "Signed authorization timestamp is expired or outside the allowed clock window.")

    expected_action, actor_fields = route_config
    if action != expected_action:
        raise SignedAuthorizationError("AUTHORIZATION_ACTION_MISMATCH", "Signed authorization action does not match this route.")
    if authorization["domain"] != AUTHORIZATION_DOMAIN:
        raise SignedAuthorizationError("AUTHORIZATION_DOMAIN_MISMATCH", "Signed authorization domain does not match Vorliq authority writes.")
    valid, _, _ = validate_address(wallet)
    if not valid or is_reserved_address(wallet) or wallet.lower() in ROLE_LIKE_IDENTITIES:
        raise SignedAuthorizationError("AUTHORIZATION_WALLET_INVALID", "Reserved, malformed, or role-like identities cannot authorize public wallet actions.")
    try:
        public_key_object = public_key_from_pem(public_key)
        if not isinstance(public_key_object.curve, ec.SECP256K1):
            raise SignedAuthorizationError("AUTHORIZATION_PUBLIC_KEY_INVALID", "Authorization public key must be a Vorliq secp256k1 key.")
        derived_address = address_from_public_key_pem(public_key)
    except SignedAuthorizationError:
        raise
    except (TypeError, ValueError, UnsupportedAlgorithm) as exc:
        raise SignedAuthorizationError("AUTHORIZATION_PUBLIC_KEY_INVALID", "Authorization public key is invalid.") from exc
    if derived_address != wallet:
        raise SignedAuthorizationError("AUTHORIZATION_WALLET_MISMATCH", "Authorization wallet does not match the supplied public key.")
    if _actor_from_payload(payload, actor_fields) != wallet:
        raise SignedAuthorizationError("AUTHORIZATION_ACTOR_MISMATCH", "Signed authorization wallet must match the route actor.")
    if any(field in payload for field in OVERRIDE_FIELDS):
        raise SignedAuthorizationError("AUTHORIZATION_OVERRIDE_REJECTED", "Client-supplied authority or balance overrides are not allowed.", 400)

    calculated_body_hash = body_hash(payload)
    if calculated_body_hash != claimed_body_hash:
        raise SignedAuthorizationError("AUTHORIZATION_BODY_HASH_MISMATCH", "Signed authorization body hash does not match the request payload.")
    expected_message = authorization_message(
        action=action,
        body_hash_value=calculated_body_hash,
        nonce=nonce,
        timestamp=timestamp,
        wallet=wallet,
    )
    if authorization["message"] != expected_message:
        raise SignedAuthorizationError("AUTHORIZATION_MESSAGE_MISMATCH", "Signed authorization message is not canonical.")
    if not verify_signature(expected_message, signature, public_key):
        raise SignedAuthorizationError("AUTHORIZATION_SIGNATURE_INVALID", "Signed authorization signature is invalid.")

    nonce_key = hashlib.sha256(f"{wallet}:{nonce}".encode("utf-8")).hexdigest()
    if not storage.consume_authority_nonce(
        nonce_key,
        expires_at=timestamp + AUTHORIZATION_MAX_AGE_SECONDS + AUTHORIZATION_FUTURE_SKEW_SECONDS,
        now=now,
    ):
        raise SignedAuthorizationError("AUTHORIZATION_REPLAYED", "Signed authorization nonce has already been used.")
    return {"action": action, "wallet": wallet, "nonce": nonce, "timestamp": timestamp, "body_hash": calculated_body_hash}
