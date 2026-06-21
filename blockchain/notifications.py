"""Opt-in email notifications.

A self-contained notification layer: members opt in (per event) and provide an
email; the core enqueues an email when one of those events happens to them, and a
best-effort dispatcher delivers queued emails through a transactional email
provider configured purely from environment variables.

Design rules that matter:
  * Strictly opt-in. Nothing is enqueued unless the recipient has saved an email
    and enabled that specific event. No email, no default, no surprise mail.
  * The provider credentials live only in the environment
    (VORLIQ_EMAIL_API_URL / VORLIQ_EMAIL_API_KEY / VORLIQ_EMAIL_FROM), never in
    the codebase or in storage.
  * If no provider is configured, the dispatcher LOGS the email it would have
    sent (recipient masked) and marks it skipped — it never raises. A missing
    provider must never break a transaction, a loan, or governance.
  * Dispatch is best-effort and decoupled from the event: enqueue is a fast,
    persisted append; sending happens off the request/mining path so a slow or
    unreachable mail provider can never stall consensus.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
import urllib.error
import urllib.request
import uuid
from typing import Any

from logger import vorliq_logger

EVENT_TYPES = ("vlq_received", "loan_funded", "loan_repaid", "governance_concluded")
EVENT_LABELS = {
    "vlq_received": "VLQ received",
    "loan_funded": "Loan funded",
    "loan_repaid": "Loan repaid",
    "governance_concluded": "Governance proposal concluded",
}
MAX_EMAIL_LENGTH = 254
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MAX_QUEUE = 5000


def default_events() -> dict[str, bool]:
    # Opt-in means every toggle starts OFF; saving an email does not silently
    # subscribe a member to anything.
    return {event: False for event in EVENT_TYPES}


def normalize_email(value: object) -> str:
    return str(value or "").replace("\0", "").strip().lower()


def mask_email(email: str) -> str:
    if not email or "@" not in email:
        return "(hidden)"
    name, domain = email.split("@", 1)
    shown = name[0] if name else ""
    return f"{shown}***@{domain}"


def email_provider() -> dict[str, str]:
    return {
        "api_url": os.environ.get("VORLIQ_EMAIL_API_URL", "").strip(),
        "api_key": os.environ.get("VORLIQ_EMAIL_API_KEY", "").strip(),
        "from": os.environ.get("VORLIQ_EMAIL_FROM", "").strip(),
    }


def provider_configured() -> bool:
    provider = email_provider()
    return bool(provider["api_url"] and provider["api_key"] and provider["from"])


def render_email(event: str, data: dict[str, Any]) -> dict[str, str]:
    """Plain, factual messages — never include secrets, balances are only shown
    when the event itself already exposes them to the recipient."""
    data = data or {}
    if event == "vlq_received":
        amount = data.get("amount")
        sender = data.get("from") or "another member"
        subject = "You received VLQ on Vorliq"
        text = (
            f"You received {amount} VLQ from {sender}.\n\n"
            "Open Vorliq to view the transaction in your wallet history."
        )
    elif event == "loan_funded":
        amount = data.get("amount")
        subject = "Your Vorliq loan was funded"
        text = (
            f"Your community loan request for {amount} VLQ has been funded and the VLQ is now in your wallet.\n\n"
            "Open Vorliq to review your loan and its repayment terms."
        )
    elif event == "loan_repaid":
        amount = data.get("amount")
        subject = "A Vorliq loan was repaid"
        text = (
            f"A community loan you are part of has been repaid ({amount} VLQ).\n\n"
            "Open Vorliq to review the loan."
        )
    elif event == "governance_concluded":
        title = data.get("title") or "a proposal"
        outcome = data.get("outcome") or "concluded"
        subject = "A governance proposal you voted on concluded"
        text = (
            f'The governance proposal "{title}" that you voted on has {outcome}.\n\n'
            "Open Vorliq to see the final result."
        )
    else:
        subject = "Vorliq notification"
        text = "You have a new Vorliq notification."
    return {"subject": subject, "text": text}


class Notifications:
    """Preferences (per wallet) plus a persisted outbound email queue."""

    def __init__(self) -> None:
        # preferences: { wallet_address: { "email": str, "events": {event: bool}, "updated_at": float } }
        self.preferences: dict[str, dict[str, Any]] = {}
        self.queue: list[dict[str, Any]] = []
        self._lock = threading.Lock()

    # --- preferences ------------------------------------------------------
    def get_preferences(self, wallet_address: str) -> dict[str, Any]:
        entry = self.preferences.get(wallet_address)
        if not entry:
            return {"configured": False, "email_masked": "", "events": default_events()}
        events = {event: bool(entry.get("events", {}).get(event, False)) for event in EVENT_TYPES}
        return {"configured": True, "email_masked": mask_email(entry.get("email", "")), "events": events}

    def set_preferences(self, wallet_address: str, *, email: object, events: object) -> dict[str, Any]:
        normalized = normalize_email(email)
        if normalized and (len(normalized) > MAX_EMAIL_LENGTH or not EMAIL_PATTERN.fullmatch(normalized)):
            raise ValueError("please provide a valid email address")
        safe_events = {event: bool((events or {}).get(event, False)) for event in EVENT_TYPES}
        # Clearing the email turns notifications off entirely and forgets the address.
        if not normalized:
            self.preferences.pop(wallet_address, None)
            return self.get_preferences(wallet_address)
        self.preferences[wallet_address] = {
            "email": normalized,
            "events": safe_events,
            "updated_at": time.time(),
        }
        return self.get_preferences(wallet_address)

    def update_events(self, wallet_address: str, *, events: object) -> dict[str, Any]:
        """Change only the event toggles, keeping the saved email. Used when the
        member edits toggles without re-typing their address (the UI only ever
        sees a masked email, so it can't resend the real one)."""
        entry = self.preferences.get(wallet_address)
        if not entry:
            return self.get_preferences(wallet_address)
        entry["events"] = {event: bool((events or {}).get(event, False)) for event in EVENT_TYPES}
        entry["updated_at"] = time.time()
        return self.get_preferences(wallet_address)

    # --- queueing ---------------------------------------------------------
    def enqueue(self, *, wallet_address: str, event: str, data: dict[str, Any] | None = None) -> dict[str, Any]:
        if event not in EVENT_TYPES:
            return {"queued": False, "reason": "unknown_event"}
        entry = self.preferences.get(wallet_address)
        if not entry or not entry.get("email"):
            return {"queued": False, "reason": "no_email"}
        if not entry.get("events", {}).get(event, False):
            return {"queued": False, "reason": "event_disabled"}
        rendered = render_email(event, data or {})
        item = {
            "id": uuid.uuid4().hex,
            "wallet_address": wallet_address,
            "email": entry["email"],
            "event": event,
            "subject": rendered["subject"],
            "text": rendered["text"],
            "status": "queued",
            "created_at": time.time(),
        }
        self.queue.append(item)
        # Cap the queue so a long-running node never grows it without bound.
        if len(self.queue) > MAX_QUEUE:
            self.queue = self.queue[-MAX_QUEUE:]
        return {"queued": True, "id": item["id"]}

    def pending(self) -> list[dict[str, Any]]:
        return [item for item in self.queue if item.get("status") == "queued"]

    # --- dispatch ---------------------------------------------------------
    def dispatch(self) -> dict[str, int]:
        """Drain the queue. Returns counts. Never raises for a missing or failing
        provider — a transactional-email outage must not affect the node."""
        pending = self.pending()
        if not pending:
            return {"sent": 0, "skipped": 0, "failed": 0}
        if not provider_configured():
            for item in pending:
                vorliq_logger.info(
                    "[notifications] would send %r to %s (no email provider configured; skipping)",
                    item["subject"],
                    mask_email(item["email"]),
                )
                item["status"] = "skipped_no_provider"
                item["processed_at"] = time.time()
            return {"sent": 0, "skipped": len(pending), "failed": 0}

        provider = email_provider()
        sent = failed = 0
        for item in pending:
            try:
                self._send_via_provider(provider, item)
                item["status"] = "sent"
                sent += 1
            except Exception as exc:  # noqa: BLE001 - delivery must be best-effort
                item["status"] = "failed"
                item["error"] = str(exc)[:200]
                failed += 1
                vorliq_logger.warning("[notifications] delivery failed for %s: %s", mask_email(item["email"]), exc)
            item["processed_at"] = time.time()
        return {"sent": sent, "skipped": 0, "failed": failed}

    def _send_via_provider(self, provider: dict[str, str], item: dict[str, Any]) -> None:
        payload = json.dumps(
            {"from": provider["from"], "to": item["email"], "subject": item["subject"], "text": item["text"]}
        ).encode("utf-8")
        request = urllib.request.Request(
            provider["api_url"],
            data=payload,
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {provider['api_key']}"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=10) as response:
            if response.status >= 400:
                raise RuntimeError(f"provider returned HTTP {response.status}")

    def dispatch_async(self) -> None:
        """Kick off delivery off the caller's thread so enqueue stays fast and the
        mining / request path is never blocked on a mail provider."""
        thread = threading.Thread(target=self._dispatch_guarded, name="vorliq-notify", daemon=True)
        thread.start()

    def _dispatch_guarded(self) -> None:
        with self._lock:
            try:
                self.dispatch()
            except Exception as exc:  # noqa: BLE001
                vorliq_logger.warning("[notifications] dispatch error: %s", exc)
