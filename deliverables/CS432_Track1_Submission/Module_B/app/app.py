import hashlib
import hmac
import os
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from functools import wraps
from pathlib import Path

from flask import Flask, jsonify, render_template, request
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / "app" / "module_b.db"
SCHEMA_PATH = BASE_DIR / "sql" / "schema.sql"
LOG_PATH = BASE_DIR / "logs" / "audit.log"
SESSION_HOURS = int(os.getenv("SESSION_HOURS", "12"))
SIGNING_SECRET = os.getenv("API_SIGNING_SECRET", "change-me-before-demo")

app = Flask(__name__, template_folder=str(Path(__file__).resolve().parent / "templates"))


def utc_now():
    return datetime.now(timezone.utc)


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with get_db() as conn:
        conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))

        # Seed default admin and user only once.
        if conn.execute("SELECT COUNT(*) AS c FROM users").fetchone()["c"] == 0:
            conn.execute(
                "INSERT INTO members (member_id, full_name, email, group_name) VALUES (?, ?, ?, ?)",
                ("m_admin", "Admin User", "admin@local", "core-admin"),
            )
            conn.execute(
                "INSERT INTO members (member_id, full_name, email, group_name) VALUES (?, ?, ?, ?)",
                ("m_user", "Regular User", "user@local", "core-user"),
            )
            conn.execute(
                "INSERT INTO portfolios (member_id, bio, skills, projects, updated_at, api_signature) VALUES (?, ?, ?, ?, ?, ?)",
                (
                    "m_admin",
                    "System admin portfolio",
                    "RBAC, indexing, API",
                    "BlindDrop integration",
                    utc_now().isoformat(),
                    "",
                ),
            )
            conn.execute(
                "INSERT INTO portfolios (member_id, bio, skills, projects, updated_at, api_signature) VALUES (?, ?, ?, ?, ?, ?)",
                (
                    "m_user",
                    "Regular member profile",
                    "UI, testing",
                    "Portfolio module",
                    utc_now().isoformat(),
                    "",
                ),
            )

            conn.execute(
                "INSERT INTO users (user_id, username, password_hash, role, member_id) VALUES (?, ?, ?, ?, ?)",
                (
                    "u_admin",
                    "admin",
                    generate_password_hash("admin123"),
                    "admin",
                    "m_admin",
                ),
            )
            conn.execute(
                "INSERT INTO users (user_id, username, password_hash, role, member_id) VALUES (?, ?, ?, ?, ?)",
                (
                    "u_user",
                    "user",
                    generate_password_hash("user123"),
                    "user",
                    "m_user",
                ),
            )
            _refresh_signatures(conn, "m_admin")
            _refresh_signatures(conn, "m_user")
            conn.commit()


def audit_log(conn, actor_user_id, action, target_table, target_id, status, message, ip):
    conn.execute(
        """
        INSERT INTO audit_logs (actor_user_id, action, target_table, target_id, status, message, ip_address, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (actor_user_id, action, target_table, target_id, status, message, ip, utc_now().isoformat()),
    )
    with open(LOG_PATH, "a", encoding="utf-8") as f:
        f.write(
            f"{utc_now().isoformat()} actor={actor_user_id} action={action} table={target_table} "
            f"target={target_id} status={status} ip={ip} msg={message}\n"
        )


def _portfolio_signature(member_id, bio, skills, projects, updated_at):
    payload = "|".join([member_id or "", bio or "", skills or "", projects or "", updated_at or ""])
    return hmac.new(SIGNING_SECRET.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()


def _refresh_signatures(conn, member_id):
    row = conn.execute(
        "SELECT member_id, bio, skills, projects, updated_at FROM portfolios WHERE member_id = ?",
        (member_id,),
    ).fetchone()
    if not row:
        return
    signature = _portfolio_signature(row["member_id"], row["bio"], row["skills"], row["projects"], row["updated_at"])
    conn.execute("UPDATE portfolios SET api_signature = ? WHERE member_id = ?", (signature, member_id))


def get_session_from_request(conn):
    token = None
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header.split(" ", 1)[1].strip()
    if not token:
        token = request.args.get("session_token")
    if not token:
        return None, "No session found"

    row = conn.execute(
        """
        SELECT s.token, s.user_id, s.expires_at, s.active, u.username, u.role, u.member_id
        FROM sessions s
        JOIN users u ON u.user_id = s.user_id
        WHERE s.token = ?
        """,
        (token,),
    ).fetchone()

    if not row:
        return None, "Invalid session token"
    if not row["active"]:
        return None, "Session expired"
    if datetime.fromisoformat(row["expires_at"]) < utc_now():
        conn.execute("UPDATE sessions SET active = 0 WHERE token = ?", (token,))
        conn.commit()
        return None, "Session expired"

    return dict(row), None


def require_auth(role=None):
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            with get_db() as conn:
                session, error = get_session_from_request(conn)
                if error:
                    return jsonify({"error": error}), 401
                if role and session["role"] != role:
                    return jsonify({"error": "Forbidden"}), 403
                request.current_user = session
            return fn(*args, **kwargs)

        return wrapper

    return decorator


@app.get("/")
def welcome():
    return jsonify({"message": "Welcome to test APIs"})


@app.get("/ui")
def ui():
    return render_template("index.html")


@app.post("/login")
def login():
    data = request.get_json(silent=True) or {}
    username = data.get("user")
    password = data.get("password")

    if not username or not password:
        return jsonify({"error": "Missing parameters"}), 401

    with get_db() as conn:
        user = conn.execute(
            "SELECT user_id, username, password_hash, role FROM users WHERE username = ?",
            (username,),
        ).fetchone()
        if not user or not check_password_hash(user["password_hash"], password):
            return jsonify({"error": "Invalid credentials"}), 401

        token = secrets.token_urlsafe(32)
        expires = utc_now() + timedelta(hours=SESSION_HOURS)
        conn.execute(
            "INSERT INTO sessions (token, user_id, created_at, expires_at, active) VALUES (?, ?, ?, ?, 1)",
            (token, user["user_id"], utc_now().isoformat(), expires.isoformat()),
        )
        conn.commit()

    return jsonify({"message": "Login successful", "session_token": token})


@app.get("/isAuth")
def is_auth():
    with get_db() as conn:
        session, error = get_session_from_request(conn)
        if error:
            return jsonify({"error": error}), 401
        return jsonify(
            {
                "message": "User is authenticated",
                "username": session["username"],
                "role": session["role"],
                "expiry": session["expires_at"],
            }
        )


@app.get("/api/portfolio")
@require_auth()
def list_portfolios():
    current = request.current_user
    with get_db() as conn:
        if current["role"] == "admin":
            rows = conn.execute(
                """
                SELECT m.member_id, m.full_name, m.email, m.group_name, p.bio, p.skills, p.projects, p.updated_at
                FROM members m
                LEFT JOIN portfolios p ON p.member_id = m.member_id
                ORDER BY m.full_name
                """
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT m.member_id, m.full_name, m.email, m.group_name, p.bio, p.skills, p.projects, p.updated_at
                FROM members m
                LEFT JOIN portfolios p ON p.member_id = m.member_id
                WHERE m.member_id = ?
                """,
                (current["member_id"],),
            ).fetchall()

        return jsonify([dict(r) for r in rows])


@app.get("/api/portfolio/<member_id>")
@require_auth()
def get_portfolio(member_id):
    current = request.current_user
    if current["role"] != "admin" and current["member_id"] != member_id:
        return jsonify({"error": "Forbidden"}), 403

    with get_db() as conn:
        row = conn.execute(
            """
            SELECT m.member_id, m.full_name, m.email, m.group_name, p.bio, p.skills, p.projects, p.updated_at
            FROM members m
            LEFT JOIN portfolios p ON p.member_id = m.member_id
            WHERE m.member_id = ?
            """,
            (member_id,),
        ).fetchone()

        if not row:
            return jsonify({"error": "Member not found"}), 404
        return jsonify(dict(row))


@app.post("/api/portfolio")
@require_auth(role="admin")
def create_member_portfolio():
    data = request.get_json(silent=True) or {}
    required_fields = ["member_id", "full_name", "email", "group_name", "username", "password", "role"]
    missing = [f for f in required_fields if not data.get(f)]
    if missing:
        return jsonify({"error": f"Missing fields: {', '.join(missing)}"}), 400

    member_id = data["member_id"]
    now_ts = utc_now().isoformat()

    with get_db() as conn:
        try:
            conn.execute(
                "INSERT INTO members (member_id, full_name, email, group_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                (member_id, data["full_name"], data["email"], data["group_name"], now_ts, now_ts),
            )
            conn.execute(
                "INSERT INTO portfolios (member_id, bio, skills, projects, updated_at, api_signature) VALUES (?, ?, ?, ?, ?, ?)",
                (member_id, data.get("bio", ""), data.get("skills", ""), data.get("projects", ""), now_ts, ""),
            )
            conn.execute(
                "INSERT INTO users (user_id, username, password_hash, role, member_id) VALUES (?, ?, ?, ?, ?)",
                (
                    f"u_{member_id}",
                    data["username"],
                    generate_password_hash(data["password"]),
                    data["role"],
                    member_id,
                ),
            )
            _refresh_signatures(conn, member_id)
            audit_log(
                conn,
                request.current_user["user_id"],
                "create",
                "members/portfolios/users",
                member_id,
                "success",
                "Admin created member and related core records",
                request.remote_addr or "unknown",
            )
            conn.commit()
        except sqlite3.IntegrityError as err:
            audit_log(
                conn,
                request.current_user["user_id"],
                "create",
                "members/portfolios/users",
                member_id,
                "failed",
                str(err),
                request.remote_addr or "unknown",
            )
            conn.commit()
            return jsonify({"error": str(err)}), 400

    return jsonify({"message": "Member portfolio created"}), 201


@app.put("/api/portfolio/<member_id>")
@require_auth()
def update_portfolio(member_id):
    current = request.current_user
    if current["role"] != "admin" and current["member_id"] != member_id:
        return jsonify({"error": "Forbidden"}), 403

    data = request.get_json(silent=True) or {}
    now_ts = utc_now().isoformat()

    with get_db() as conn:
        row = conn.execute("SELECT member_id FROM members WHERE member_id = ?", (member_id,)).fetchone()
        if not row:
            return jsonify({"error": "Member not found"}), 404

        if current["role"] == "admin":
            conn.execute(
                "UPDATE members SET full_name = COALESCE(?, full_name), email = COALESCE(?, email), group_name = COALESCE(?, group_name), updated_at = ? WHERE member_id = ?",
                (data.get("full_name"), data.get("email"), data.get("group_name"), now_ts, member_id),
            )

        conn.execute(
            "UPDATE portfolios SET bio = COALESCE(?, bio), skills = COALESCE(?, skills), projects = COALESCE(?, projects), updated_at = ? WHERE member_id = ?",
            (data.get("bio"), data.get("skills"), data.get("projects"), now_ts, member_id),
        )
        _refresh_signatures(conn, member_id)

        audit_log(
            conn,
            current["user_id"],
            "update",
            "portfolio",
            member_id,
            "success",
            "Portfolio updated via authenticated API",
            request.remote_addr or "unknown",
        )
        conn.commit()

    return jsonify({"message": "Portfolio updated"})


@app.delete("/api/portfolio/<member_id>")
@require_auth(role="admin")
def delete_member(member_id):
    with get_db() as conn:
        exists = conn.execute("SELECT member_id FROM members WHERE member_id = ?", (member_id,)).fetchone()
        if not exists:
            return jsonify({"error": "Member not found"}), 404

        conn.execute("DELETE FROM sessions WHERE user_id IN (SELECT user_id FROM users WHERE member_id = ?)", (member_id,))
        conn.execute("DELETE FROM users WHERE member_id = ?", (member_id,))
        conn.execute("DELETE FROM portfolios WHERE member_id = ?", (member_id,))
        conn.execute("DELETE FROM members WHERE member_id = ?", (member_id,))

        audit_log(
            conn,
            request.current_user["user_id"],
            "delete",
            "members/portfolios/users",
            member_id,
            "success",
            "Admin deleted member and corresponding core records",
            request.remote_addr or "unknown",
        )
        conn.commit()

    return jsonify({"message": "Member and related records deleted"})


@app.get("/api/security/unauthorized-check")
@require_auth(role="admin")
def unauthorized_check():
    flagged = []
    with get_db() as conn:
        rows = conn.execute(
            "SELECT member_id, bio, skills, projects, updated_at, api_signature FROM portfolios"
        ).fetchall()

        for row in rows:
            expected = _portfolio_signature(
                row["member_id"], row["bio"], row["skills"], row["projects"], row["updated_at"]
            )
            if row["api_signature"] != expected:
                flagged.append(
                    {
                        "member_id": row["member_id"],
                        "reason": "Signature mismatch: possible direct DB modification",
                    }
                )

    return jsonify({"flagged": flagged, "count": len(flagged)})


if __name__ == "__main__":
    init_db()
    app.run(host="127.0.0.1", port=5000, debug=True)
