from __future__ import annotations

from pathlib import Path

from graphviz import Digraph


ROOT = Path(__file__).resolve().parent


TABLES = {
    "vaults": [
        ("PK", "vault_id"),
        ("UK", "outer_token"),
        ("", "created_at"),
        ("", "expires_at"),
        ("", "status"),
    ],
    "inner_tokens": [
        ("PK", "inner_token_id"),
        ("FK", "vault_id"),
        ("", "token_type"),
        ("", "token_hash"),
        ("", "token_lookup_hash"),
        ("", "salt"),
        ("", "key_iterations"),
        ("", "created_at"),
        ("", "status"),
    ],
    "files": [
        ("PK", "file_id"),
        ("FK", "vault_id"),
        ("UK", "drive_file_id"),
        ("", "original_filename"),
        ("", "mime_type"),
        ("", "file_size"),
        ("", "storage_path"),
        ("", "file_key_iv"),
        ("", "file_hmac"),
        ("", "status"),
        ("", "deleted_at"),
    ],
    "file_metadata": [
        ("PK", "metadata_id"),
        ("FK", "file_id"),
        ("", "original_filename"),
        ("", "relative_path"),
        ("", "mime_type"),
        ("", "file_size"),
        ("", "uploaded_at"),
    ],
    "file_key_access": [
        ("PK", "access_id"),
        ("FK", "file_id"),
        ("FK", "inner_token_id"),
        ("", "encrypted_file_key"),
    ],
    "sessions": [
        ("PK", "session_id"),
        ("", "ip_address"),
        ("", "user_agent"),
        ("", "created_at"),
        ("", "last_activity"),
    ],
    "auth_attempts": [
        ("PK", "attempt_id"),
        ("FK", "session_id"),
        ("FK", "vault_id"),
        ("", "attempt_time"),
        ("", "success"),
    ],
    "download_logs": [
        ("PK", "download_id"),
        ("FK", "file_id"),
        ("FK", "inner_token_id"),
        ("FK", "session_id"),
        ("", "download_time"),
    ],
    "captcha_tracking": [
        ("PK", "captcha_id"),
        ("FK", "session_id"),
        ("", "attempts"),
        ("", "required"),
        ("", "last_attempt"),
    ],
    "expiry_jobs": [
        ("PK", "job_id"),
        ("FK", "vault_id"),
        ("", "scheduled_time"),
        ("", "processed"),
    ],
    "portfolio_entries": [
        ("PK", "entry_id"),
        ("FK", "vault_id"),
        ("FK", "owner_token_id"),
        ("FK", "created_by_token_id"),
        ("", "title"),
        ("", "content"),
        ("", "integrity_hash"),
        ("", "status"),
        ("", "created_at"),
        ("", "updated_at"),
    ],
}


RELATIONSHIPS = [
    ("inner_tokens", "vaults", "vault_id", "N:1"),
    ("files", "vaults", "vault_id", "N:1"),
    ("file_metadata", "files", "file_id", "1:1"),
    ("file_key_access", "files", "file_id", "N:1"),
    ("file_key_access", "inner_tokens", "inner_token_id", "N:1"),
    ("sessions", None, None, None),
    ("auth_attempts", "sessions", "session_id", "N:1"),
    ("auth_attempts", "vaults", "vault_id", "N:1 optional"),
    ("download_logs", "files", "file_id", "N:1"),
    ("download_logs", "inner_tokens", "inner_token_id", "N:1"),
    ("download_logs", "sessions", "session_id", "N:1 optional"),
    ("captcha_tracking", "sessions", "session_id", "1:1"),
    ("expiry_jobs", "vaults", "vault_id", "1:1"),
    ("portfolio_entries", "vaults", "vault_id", "N:1"),
    ("portfolio_entries", "inner_tokens", "owner_token_id", "N:1"),
    ("portfolio_entries", "inner_tokens", "created_by_token_id", "N:1"),
]


def html_table(table: str, title: str, rows: list[tuple[str, str]], fill: str) -> str:
    cells = [
        f'<TR><TD COLSPAN="2" BGCOLOR="{fill}"><B>{title}</B></TD></TR>'
    ]
    for tag, value in rows:
        if tag:
            cells.append(
                "<TR>"
                f'<TD ALIGN="LEFT"><B>{tag}</B></TD>'
                f'<TD ALIGN="LEFT">{value}</TD>'
                "</TR>"
            )
        else:
            cells.append(f'<TR><TD COLSPAN="2" ALIGN="LEFT">{value}</TD></TR>')
    body = "".join(cells)
    return f'<<TABLE BORDER="1" CELLBORDER="1" CELLSPACING="0" CELLPADDING="4">{body}</TABLE>>'


def node_label(table: str, rows: list[tuple[str, str]]) -> str:
    return html_table(table, table, rows, "#E8EEF7")


def build_basic_graph() -> Digraph:
    graph = Digraph("ghostdrop_basic", filename=str(ROOT / "ghostdrop_er_basic.gv"))
    graph.attr(rankdir="LR", splines="spline", bgcolor="white", pad="0.3")
    graph.attr("node", shape="box", style="rounded,filled", fillcolor="#F7F7F7", color="#444444", fontname="Helvetica")
    graph.attr("edge", color="#666666", fontname="Helvetica", arrowsize="0.8")

    for table in TABLES:
        graph.node(table, table)

    for child, parent, label, cardinality in RELATIONSHIPS:
        if parent is None:
            continue
        graph.edge(child, parent, label=f"{label} ({cardinality})")

    return graph


def build_formal_graph() -> Digraph:
    graph = Digraph("ghostdrop_formal", filename=str(ROOT / "ghostdrop_er_formal.gv"))
    graph.attr(rankdir="LR", splines="spline", bgcolor="white", pad="0.3", nodesep="0.45", ranksep="0.7")
    graph.attr("node", shape="plain", fontname="Helvetica")
    graph.attr("edge", color="#5A5A5A", fontname="Helvetica", arrowsize="0.8")

    core_cluster = Digraph(name="cluster_core")
    core_cluster.attr(label="Core Vault Data", color="#9BB7D4", style="rounded")
    for table in ["vaults", "inner_tokens", "files", "file_metadata", "file_key_access"]:
        core_cluster.node(table, node_label(table, TABLES[table]))

    security_cluster = Digraph(name="cluster_security")
    security_cluster.attr(label="Security and Audit", color="#C9A66B", style="rounded")
    for table in ["sessions", "auth_attempts", "download_logs", "captcha_tracking", "expiry_jobs"]:
        security_cluster.node(table, node_label(table, TABLES[table]))

    portfolio_cluster = Digraph(name="cluster_portfolio")
    portfolio_cluster.attr(label="Module B CRUD", color="#7CB8A7", style="rounded")
    portfolio_cluster.node("portfolio_entries", node_label("portfolio_entries", TABLES["portfolio_entries"]))

    graph.subgraph(core_cluster)
    graph.subgraph(security_cluster)
    graph.subgraph(portfolio_cluster)

    for child, parent, label, cardinality in RELATIONSHIPS:
        if parent is None:
            continue
        graph.edge(child, parent, label=f"{label}\\n{cardinality}")

    return graph


def render(graph: Digraph, stem: str) -> None:
    source_path = ROOT / f"{stem}.gv"
    graph.save(filename=str(source_path))
    graph.render(filename=str(ROOT / stem), format="png", cleanup=False)
    graph.render(filename=str(ROOT / stem), format="pdf", cleanup=False)


def main() -> None:
    render(build_basic_graph(), "ghostdrop_er_basic")
    render(build_formal_graph(), "ghostdrop_er_formal")


if __name__ == "__main__":
    main()
