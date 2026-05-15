#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = ROOT / "database" / "sentinel.db"
DEFAULT_OUT = ROOT / "frontend" / "public" / "sentinel-helpers.json"


def _ensure_integrity_columns(conn: sqlite3.Connection) -> None:
    existing = {row[1] for row in conn.execute("PRAGMA table_info(responders)")}
    migrations = {
        "verification_status": "ALTER TABLE responders ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'unverified'",
        "cybercrime_status": "ALTER TABLE responders ADD COLUMN cybercrime_status TEXT NOT NULL DEFAULT 'unchecked'",
        "cybercrime_checked_at": "ALTER TABLE responders ADD COLUMN cybercrime_checked_at TEXT",
        "blacklist_reason": "ALTER TABLE responders ADD COLUMN blacklist_reason TEXT",
        "verification_source": "ALTER TABLE responders ADD COLUMN verification_source TEXT",
        "location_updated_at": "ALTER TABLE responders ADD COLUMN location_updated_at TEXT",
        "last_execution_id": "ALTER TABLE responders ADD COLUMN last_execution_id TEXT",
        "last_location_accuracy_m": "ALTER TABLE responders ADD COLUMN last_location_accuracy_m REAL",
        "accepted_count": "ALTER TABLE responders ADD COLUMN accepted_count INTEGER NOT NULL DEFAULT 0",
        "last_accepted_at": "ALTER TABLE responders ADD COLUMN last_accepted_at TEXT",
    }
    for column, statement in migrations.items():
        if column not in existing:
            conn.execute(statement)
    conn.commit()


def load_helpers(db_path: Path) -> list[dict[str, Any]]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    _ensure_integrity_columns(conn)
    rows = conn.execute(
        """
        SELECT id, telegram_chat_id, display_name, phone, email, github, photo_url,
               latitude, longitude, active, verification_status, cybercrime_status,
               cybercrime_checked_at, blacklist_reason, verification_source, location_updated_at,
               last_execution_id, last_location_accuracy_m, accepted_count, last_accepted_at
        FROM responders
        ORDER BY active DESC, display_name COLLATE NOCASE
        """
    ).fetchall()
    return [dict(row) for row in rows]


def write_snapshot(db_path: Path, output_path: Path) -> dict[str, Any]:
    payload = {
        "source": str(db_path),
        "generated_at": datetime.now(UTC).isoformat(),
        "helpers": load_helpers(db_path),
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Export SQLite responder integrity state for the Sentinel Grid UI.")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()
    payload = write_snapshot(args.db, args.out)
    print(json.dumps({"helpers": len(payload["helpers"]), "out": str(args.out)}, separators=(",", ":")))


if __name__ == "__main__":
    main()
