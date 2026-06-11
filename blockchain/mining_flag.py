from __future__ import annotations

import os


def mining_enabled() -> bool:
    """Fail-closed mining switch.

    Mining is allowed only when VORLIQ_MINING_ENABLED is explicitly set to
    "true" (case-insensitive, surrounding whitespace ignored). An absent,
    empty, or malformed value keeps mining disabled, so a missing or
    regenerated config can never silently reopen public mining.
    """
    raw = os.environ.get("VORLIQ_MINING_ENABLED")
    if not isinstance(raw, str):
        return False
    return raw.strip().lower() == "true"
