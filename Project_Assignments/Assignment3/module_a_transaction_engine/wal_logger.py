"""Compatibility wrapper exposing WAL logger used by Module A."""

from __future__ import annotations

from . import WriteAheadLog

__all__ = ["WriteAheadLog"]
