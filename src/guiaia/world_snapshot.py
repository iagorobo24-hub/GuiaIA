"""Strict, privacy-preserving parser for the optional Fabric 1.21.1 world observer.

These are aggregate samples from *one loaded chunk*, not a complete view of the world.
The MCP host must choose an authorized local file. No chunk is loaded or mutated here.
"""
from __future__ import annotations

import json
import os
import re
import stat
import time
from math import isfinite
from pathlib import Path

_ID = re.compile(r"^[a-z0-9_.-]+:[a-z0-9_./-]+$")
_SOURCE = "fabric_loaded_chunks"


class WorldSnapshotError(ValueError):
    pass


def _pairs_unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise WorldSnapshotError("Duplicate snapshot field")
        result[key] = value
    return result


def _number(v, low, high, name):
    if type(v) not in (int, float) or not isfinite(v) or not low <= v <= high:
        raise WorldSnapshotError("Invalid world field: " + name)
    return v


def parse_world_snapshot(path: str | Path, *, now_ms: int | None = None) -> dict:
    p = Path(path).expanduser()
    if p.is_symlink():
        raise WorldSnapshotError("World snapshot symbolic link denied")
    # Open the actual file once, with NOFOLLOW, then bound the bytes read.
    # File size and JSON are checked on the same file descriptor, removing
    # the previous stat/read race and preventing oversized replacement reads.
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    try:
        fd = os.open(p, flags)
        with os.fdopen(fd, "rb") as stream:
            metadata = os.fstat(stream.fileno())
            if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > 8192:
                raise WorldSnapshotError("World snapshot unavailable or too large")
            payload = stream.read(8193)
            if len(payload) > 8192:
                raise WorldSnapshotError("World snapshot exceeds byte budget")
        raw = json.loads(payload, object_pairs_hook=_pairs_unique)
    except OSError as exc:
        raise WorldSnapshotError("World snapshot unavailable") from exc
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise WorldSnapshotError("Invalid Fabric snapshot JSON") from exc
    if not isinstance(raw, dict):
        raise WorldSnapshotError("World snapshot must be an object")
    if type(raw.get("schema_version")) is not int or raw["schema_version"] != 1:
        raise WorldSnapshotError("Unsupported world snapshot schema")
    if raw.get("source") != _SOURCE or raw.get("dimension") != "minecraft:overworld":
        raise WorldSnapshotError("Not an authorized Fabric overworld snapshot")
    if raw.get("sampled_from_loaded_only") is not True or raw.get("player_identifiers_excluded") is not True:
        raise WorldSnapshotError("Missing privacy or loaded-chunk provenance")
    tick = _number(raw.get("game_ticks"), 0, 100000000000, "game_ticks")
    stamp = _number(raw.get("sample_epoch_ms"), 1, 9999999999999, "sample_epoch_ms")
    current = now_ms if now_ms is not None else int(time.time() * 1000)
    age = current - int(stamp)
    if age < -15000 or age > 120000:
        raise WorldSnapshotError("World observation stale or timestamp invalid")
    chunks = _number(raw.get("chunks_loaded"), 0, 1, "chunks_loaded")
    blocks = _number(raw.get("blocks_sampled"), 0, 16, "blocks_sampled")
    entities = _number(raw.get("entities_loaded"), 0, 64, "entities_loaded")
    players = _number(raw.get("players_online"), 0, 1000, "players_online")
    if any(type(x) is not int for x in (chunks, blocks, entities, players, tick, stamp)):
        raise WorldSnapshotError("World counters must be integers")
    if type(raw.get("entities_capped")) is not bool:
        raise WorldSnapshotError("Invalid entity cap flag")

    def extract_counts(name: str, maximum: int, total_limit: int) -> dict[str, int]:
        source = raw.get(name)
        if not isinstance(source, dict) or len(source) > maximum:
            raise WorldSnapshotError("Invalid " + name)
        output = {}
        for key, count in source.items():
            if not isinstance(key, str) or len(key) > 72 or not _ID.fullmatch(key):
                raise WorldSnapshotError("Invalid registry id")
            if type(count) is not int or not 1 <= count <= total_limit:
                raise WorldSnapshotError("Invalid registry count")
            output[key] = count
        if sum(output.values()) > total_limit:
            raise WorldSnapshotError("Invalid total count")
        return output

    block_counts = extract_counts("block_counts", 16, 16)
    entity_counts = extract_counts("entity_counts", 16, 64)
    if sum(block_counts.values()) > blocks or sum(entity_counts.values()) > entities:
        raise WorldSnapshotError("Count proof failed")
    if chunks == 0 and (blocks != 0 or entities != 0 or block_counts or entity_counts):
        raise WorldSnapshotError("Unloaded chunk cannot report sampled world content")
    mspt = raw.get("mspt_avg")
    if mspt is not None:
        mspt = _number(mspt, 0, 1000, "mspt_avg")
    return {
        "source": _SOURCE,
        "schema_version": 1,
        "read_only": True,
        "dimension": "minecraft:overworld",
        "game_ticks": tick,
        "players_online": players,
        "chunks_loaded": chunks,
        "blocks_sampled": blocks,
        "entities_loaded": entities,
        "entities_capped": raw["entities_capped"],
        "block_counts": block_counts,
        "entity_counts": entity_counts,
        "mspt_avg": mspt,
        "sample_age_ms": age,
        "scope": "one_preconfigured_loaded_chunk_and_17_block_y_band",
        "missing_chunks_not_force_loaded": True,
        "no_player_names_or_coordinates": True,
        "complete_world_view": False,
    }
