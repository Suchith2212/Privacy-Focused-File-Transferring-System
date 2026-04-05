"""Basic smoke test for the Assignment 3 Module A engine baseline (7 relations)."""

from engine import DatabaseManager


def main():
    db = DatabaseManager()

    vaults = db.create_table("vaults", index_type="bplustree", order=4)
    inner_tokens = db.create_table("inner_tokens", index_type="bplustree", order=4)
    files = db.create_table("files", index_type="bplustree", order=4)
    sessions = db.create_table("sessions", index_type="bplustree", order=4)
    download_logs = db.create_table("download_logs", index_type="bplustree", order=4)
    expiry_jobs = db.create_table("expiry_jobs", index_type="bplustree", order=4)
    portfolio_entries = db.create_table("portfolio_entries", index_type="bplustree", order=4)

    vaults.insert(1, {"outer_token": "OUTER001", "status": "ACTIVE"})
    inner_tokens.insert(101, {"vault_id": 1, "token_type": "MAIN", "status": "ACTIVE"})
    sessions.insert(501, {"ip_address": "127.0.0.1", "user_agent": "baseline-agent"})
    files.insert(1001, {"vault_id": 1, "inner_token_id": 101, "file_size": 200, "status": "ACTIVE"})
    download_logs.insert(7001, {"file_id": 1001, "inner_token_id": 101, "session_id": 501})
    expiry_jobs.insert(8001, {"vault_id": 1, "processed": False})
    portfolio_entries.insert(
        9001,
        {
            "vault_id": 1,
            "owner_token_id": 101,
            "created_by_token_id": 101,
            "title": "Baseline Entry",
            "content": "payload",
            "status": "ACTIVE",
        },
    )

    assert vaults.select(1)["status"] == "ACTIVE"
    assert inner_tokens.select(101)["token_type"] == "MAIN"
    assert sessions.select(501)["ip_address"] == "127.0.0.1"
    assert files.select(1001)["file_size"] == 200
    assert download_logs.select(7001)["file_id"] == 1001
    assert expiry_jobs.select(8001)["vault_id"] == 1
    assert portfolio_entries.select(9001)["title"] == "Baseline Entry"

    inner_tokens.update(101, {"vault_id": 1, "token_type": "SUB", "status": "ACTIVE"})
    assert inner_tokens.select(101)["token_type"] == "SUB"

    files.delete(1001)
    assert files.select(1001) is None

    print("[OK] Module A engine baseline smoke test passed.")


if __name__ == "__main__":
    main()
