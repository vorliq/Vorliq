from __future__ import annotations

import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path


LOG_DIR = Path(__file__).resolve().parent / "data"
LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE = LOG_DIR / "vorliq.log"

vorliq_logger = logging.getLogger("vorliq")
vorliq_logger.setLevel(logging.INFO)
vorliq_logger.propagate = False

formatter = logging.Formatter("%(asctime)s %(levelname)s %(message)s")

if not vorliq_logger.handlers:
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)

    file_handler = RotatingFileHandler(
        LOG_FILE,
        maxBytes=5 * 1024 * 1024,
        backupCount=3,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)

    vorliq_logger.addHandler(console_handler)
    vorliq_logger.addHandler(file_handler)
