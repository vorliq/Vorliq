from __future__ import annotations

import argparse
import json
import logging
import tarfile
from pathlib import Path
from typing import Any

from diagnose_chain_startup import evaluate_chain_payload


def evaluate_archive(path: Path) -> dict[str, Any]:
    try:
        with tarfile.open(path, "r:gz") as archive:
            members = [
                member
                for member in archive.getmembers()
                if member.isfile() and member.name.endswith("/blockchain/data/chain.json")
            ]
            if len(members) != 1:
                return {"status": "invalid", "code": "ARCHIVE_CHAIN_FILE_UNAVAILABLE"}
            extracted = archive.extractfile(members[0])
            if extracted is None:
                return {"status": "invalid", "code": "ARCHIVE_CHAIN_FILE_UNAVAILABLE"}
            return evaluate_chain_payload(json.loads(extracted.read().decode("utf-8")))
    except Exception:
        return {"status": "invalid", "code": "ARCHIVE_UNREADABLE"}


def select_newest_valid_archive(directory: Path) -> tuple[Path | None, dict[str, Any]]:
    archives = sorted(directory.glob("vorliq-backup-*.tar.gz"), key=lambda path: path.stat().st_mtime, reverse=True)
    invalid_codes: dict[str, int] = {}
    for rank, archive in enumerate(archives, start=1):
        result = evaluate_archive(archive)
        if result["status"] == "valid":
            return archive, {
                "status": "valid_archive_found",
                "archives_checked": rank,
                "selected_age_rank": rank,
                "selected_block_count": result["block_count"],
                "invalid_codes": invalid_codes,
            }
        code = str(result["code"])
        invalid_codes[code] = invalid_codes.get(code, 0) + 1

    return None, {
        "status": "no_valid_archive",
        "archives_checked": len(archives),
        "invalid_codes": invalid_codes,
    }


def main() -> int:
    logging.disable(logging.CRITICAL)
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", required=True)
    parser.add_argument("--path-only", action="store_true")
    args = parser.parse_args()

    selected, summary = select_newest_valid_archive(Path(args.directory))
    if args.path_only:
        if selected is not None:
            print(selected)
    else:
        print(json.dumps({"diagnostic": "valid_chain_backup_selection", **summary}, sort_keys=True))
    return 0 if selected is not None else 1


if __name__ == "__main__":
    raise SystemExit(main())
