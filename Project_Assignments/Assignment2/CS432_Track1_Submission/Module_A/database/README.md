# Module A Database Core

This folder contains the standalone Python database layer built for Module A. It is the assignment-facing implementation of the lightweight DBMS/indexing engine.

## Files in this folder

- `bplustree.py`
  Implements the custom B+ Tree with insertion, deletion, update, exact search, range query, in-order traversal, and Graphviz rendering.
- `bruteforce.py`
  Implements the linear-time baseline used for comparison during benchmarking.
- `table.py`
  Wraps the underlying structure into a table abstraction with a consistent CRUD-style interface.
- `db_manager.py`
  Manages multiple tables and exposes the lightweight Module A database surface used by the notebook.

## Why this layer matters

The assignment asks for more than a bare tree. It expects a lightweight DB-style abstraction where records are associated with keys and managed through a custom database manager. This folder is the direct answer to that requirement.

## B+ Tree behavior

The packaged implementation supports:

- insertion with node splitting
- deletion with borrowing and merging
- exact search
- update of existing values
- range query using linked leaf traversal
- full traversal through ordered leaf linkage
- Graphviz visualization

## Brute-force baseline

The brute-force implementation is intentionally simple. It stores rows in a linear structure and performs lookups through scanning. That makes it suitable as the performance baseline for:

- insertion comparison
- exact search comparison
- deletion comparison
- range-scan comparison
- mixed workload comparison

## Relationship to the integration layer

The `database/` folder is the standalone Module A implementation. The `integration/` folder sits on top of it and adapts the same structure to Ghost Drop-specific index keys such as:

- `outer_token -> vault_id`
- `expires_at_epoch -> vault_id[]`
- `(vault_id, status, created_at_epoch) -> file_id[]`
- `(session_id, attempt_time_epoch) -> auth_attempt_id[]`

That means the core implementation remains assignment-valid on its own, while the integration layer demonstrates project relevance.

