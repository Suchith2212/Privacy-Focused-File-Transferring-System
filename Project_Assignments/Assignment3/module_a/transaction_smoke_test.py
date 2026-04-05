"""Transaction smoke test for Assignment 3 Module A (7 project-domain relations)."""

from pathlib import Path

from engine import TransactionalDatabaseManager


RELATIONS = [
    "vaults",
    "inner_tokens",
    "files",
    "sessions",
    "download_logs",
    "expiry_jobs",
    "portfolio_entries",
]


def reset_wal(wal_path: Path) -> None:
    wal_path.parent.mkdir(parents=True, exist_ok=True)
    wal_path.write_text("", encoding="utf-8")


def main():
    wal_path = Path(__file__).resolve().parent / "logs" / "tx_wal.log"
    reset_wal(wal_path)

    db = TransactionalDatabaseManager(wal_path)
    for table in RELATIONS:
        db.create_table(table)

    tx = db.begin()
    tx.insert("vaults", 1, {"outer_token": "OUTER001", "status": "ACTIVE"})
    tx.insert("inner_tokens", 101, {"vault_id": 1, "token_type": "MAIN", "status": "ACTIVE"})
    tx.insert("sessions", 501, {"ip_address": "127.0.0.1", "user_agent": "smoke-agent"})
    tx.insert("files", 1001, {"vault_id": 1, "inner_token_id": 101, "file_size": 200, "status": "ACTIVE"})
    tx.insert("download_logs", 7001, {"file_id": 1001, "inner_token_id": 101, "session_id": 501})
    tx.insert("expiry_jobs", 8001, {"vault_id": 1, "processed": False})
    tx.insert(
        "portfolio_entries",
        9001,
        {
            "vault_id": 1,
            "owner_token_id": 101,
            "created_by_token_id": 101,
            "title": "Smoke Entry",
            "content": "payload",
            "status": "ACTIVE",
        },
    )
    db.commit(tx)

    assert db.get_table("vaults").select(1)["outer_token"] == "OUTER001"
    assert db.get_table("inner_tokens").select(101)["token_type"] == "MAIN"
    assert db.get_table("sessions").select(501)["ip_address"] == "127.0.0.1"
    assert db.get_table("files").select(1001)["file_size"] == 200
    assert db.get_table("download_logs").select(7001)["session_id"] == 501
    assert db.get_table("expiry_jobs").select(8001)["vault_id"] == 1
    assert db.get_table("portfolio_entries").select(9001)["title"] == "Smoke Entry"

    tx2 = db.begin()
    tx2.update("inner_tokens", 101, {"vault_id": 1, "token_type": "SUB", "status": "ACTIVE"})
    tx2.delete("files", 1001)
    db.rollback(tx2)

    assert db.get_table("inner_tokens").select(101)["token_type"] == "MAIN"
    assert db.get_table("files").select(1001)["status"] == "ACTIVE"

    recovered = TransactionalDatabaseManager(wal_path)
    assert recovered.get_table("vaults").select(1)["status"] == "ACTIVE"
    assert recovered.get_table("inner_tokens").select(101)["token_type"] == "MAIN"
    assert recovered.get_table("sessions").select(501)["ip_address"] == "127.0.0.1"
    assert recovered.get_table("files").select(1001)["file_size"] == 200
    assert recovered.get_table("download_logs").select(7001)["file_id"] == 1001
    assert recovered.get_table("expiry_jobs").select(8001)["processed"] is False
    assert recovered.get_table("portfolio_entries").select(9001)["status"] == "ACTIVE"

    print("[OK] Transaction + WAL + recovery smoke test passed.")


if __name__ == "__main__":
    main()
