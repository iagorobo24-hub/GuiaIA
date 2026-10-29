"""Bounded telemetry adapter: synthetic fixture or authorized local Minecraft RCON."""
from __future__ import annotations

import json
from pathlib import Path
from math import isfinite
from .rcon import RconReadOnly
from .world_snapshot import load_snapshot_json


class SnapshotObserver:
    """Read whitelisted, non-identifying world metrics from an operator-selected JSON file."""
    def __init__(self, path: str):
        self.path = Path(path).expanduser().absolute()
        if self.path.is_symlink() or not self.path.is_file():
            raise ValueError("Snapshot file does not exist")

    def _metrics(self) -> dict:
        content = load_snapshot_json(self.path, max_bytes=16384)
        clean: dict = {}
        for k in ("players_online", "max_players", "entities_loaded", "game_ticks"):
            if k in content:
                val = content[k]
                if type(val) is not int or not 0 <= val <= 100000000:
                    raise ValueError("Invalid metric: " + k)
                clean[k] = val
        for k in ("mspt_avg", "tps"):
            if k in content:
                val = content[k]
                if type(val) not in (int, float) or not isfinite(val) or val < 0 or val > 100000:
                    raise ValueError("Invalid metric: " + k)
                clean[k] = val
        return clean

    def world(self) -> dict:
        from .world_snapshot import parse_world_snapshot
        return parse_world_snapshot(self.path)

    def _fabric(self) -> dict | None:
        data = load_snapshot_json(self.path, max_bytes=16384)
        if data.get("source") == "fabric_loaded_chunks":
            return self.world()  # applies stricter size, schema, freshness and privacy checks
        return None

    def status(self) -> dict:
        fabric = self._fabric()
        if fabric is not None:
            return {"source": "fabric_loaded_chunks", "read_only": True,
                    "players_online": fabric["players_online"],
                    "max_players": None, "game_ticks": fabric["game_ticks"],
                    "nearby_entities_available": fabric["chunks_loaded"] == 1,
                    "vision_available": False, "sample_age_ms": fabric["sample_age_ms"],
                    "scope": fabric["scope"]}
        m = self._metrics()
        return {"source": "operator_snapshot", "read_only": True,
                "players_online": m.get("players_online"),
                "max_players": m.get("max_players"),
                "game_ticks": m.get("game_ticks"),
                "nearby_entities_available": False, "vision_available": False}

    def performance(self) -> dict:
        fabric = self._fabric()
        if fabric is not None:
            return {"source": "fabric_loaded_chunks", "read_only": True,
                    "mspt_avg": fabric["mspt_avg"], "tps": None,
                    "entities_loaded": None, "metrics_live": True,
                    "sampled_entities": fabric["entities_loaded"],
                    "sample_age_ms": fabric["sample_age_ms"],
                    "note": "Entity count covers only a small loaded chunk area, not the full server"}
        m = self._metrics()
        return {"source": "operator_snapshot", "read_only": True,
                "mspt_avg": m.get("mspt_avg"), "tps": m.get("tps"),
                "entities_loaded": m.get("entities_loaded"), "metrics_live": False}


class RconObserver:
    def __init__(self, password_file: str, port: int = 25575):
        self.client = RconReadOnly(password_file, port)

    def status(self) -> dict:
        return {**self.client.status(), **self.client.gametime()}

    def world(self) -> dict:
        from .world_snapshot import WorldSnapshotError
        raise WorldSnapshotError("No Fabric observer configured; RCON cannot see blocks/entities")

    def performance(self) -> dict:
        return {"source": "minecraft_java_rcon", "read_only": True,
                "mspt_avg": None, "tps": None, "entities_loaded": None,
                "metrics_live": False,
                "note": "Vanilla RCON does not expose trustworthy MSPT and entity counts via this adapter"}
