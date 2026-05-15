from __future__ import annotations

import hashlib
import statistics
import time
from typing import Any

from logger import vorliq_logger


class PriceDiscovery:
    SIGNAL_LIFETIME_SECONDS = 24 * 60 * 60

    def __init__(self) -> None:
        self.signals: dict[str, dict[str, Any]] = {}

    def submit_signal(self, submitter_address: str, currency: str, price_value: float) -> str:
        submitter_address = self._require_text(submitter_address, "submitter address")
        currency = self._require_text(currency, "currency").upper()
        price_value = float(price_value)
        if price_value <= 0:
            raise ValueError("price value must be greater than zero")

        timestamp = time.time()
        signal_id = hashlib.sha256(f"{submitter_address}{currency}{price_value}{timestamp}".encode("utf-8")).hexdigest()
        self.signals[signal_id] = {
            "signal_id": signal_id,
            "submitter_address": submitter_address,
            "currency": currency,
            "price_value": price_value,
            "timestamp": timestamp,
            "expiry": timestamp + self.SIGNAL_LIFETIME_SECONDS,
        }
        vorliq_logger.info("Price signal %s submitted for %s at %s", signal_id, currency, price_value)
        return signal_id

    def expire_old_signals(self, current_timestamp: float | None = None) -> int:
        current_timestamp = time.time() if current_timestamp is None else current_timestamp
        expired_ids = [
            signal_id
            for signal_id, signal in self.signals.items()
            if float(signal.get("expiry", 0)) <= current_timestamp
        ]
        for signal_id in expired_ids:
            self.signals.pop(signal_id, None)
        if expired_ids:
            vorliq_logger.info("Expired %s old price signals", len(expired_ids))
        return len(expired_ids)

    def get_active_signals(self) -> list[dict[str, Any]]:
        self.expire_old_signals()
        return sorted(self.signals.values(), key=lambda signal: signal.get("timestamp", 0), reverse=True)

    def get_median_price(self, currency: str) -> dict[str, Any]:
        currency = self._require_text(currency, "currency").upper()
        signals = [signal for signal in self.get_active_signals() if signal.get("currency") == currency]
        prices = [float(signal["price_value"]) for signal in signals]
        return {
            "currency": currency,
            "signal_count": len(prices),
            "median_price": statistics.median(prices) if prices else None,
            "has_enough_data": len(prices) >= 3,
        }

    def _require_text(self, value: str, field_name: str) -> str:
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"{field_name} must be a non-empty string")
        return value.strip()
