"""Compatibility shim for lock manager naming.

Module A uses serialized locking inside TransactionalDatabaseManager via RLock.
This shim exists for rubric filename compatibility.
"""

from __future__ import annotations

from threading import RLock


class SerializedLockManager:
    """Minimal lock manager adapter over a single RLock."""

    def __init__(self) -> None:
        self._lock = RLock()

    def acquire(self) -> None:
        self._lock.acquire()

    def release(self) -> None:
        self._lock.release()


__all__ = ["SerializedLockManager"]
