import json
import tempfile
import time
import unittest
from pathlib import Path

from guiaia.observer import SnapshotObserver, RconObserver
from guiaia.tools import ToolRegistry
from guiaia.world_snapshot import WorldSnapshotError, parse_world_snapshot


def sample():
    return {
        "schema_version": 1,
        "source": "fabric_loaded_chunks",
        "dimension": "minecraft:overworld",
        "game_ticks": 24000,
        "sample_epoch_ms": int(time.time() * 1000),
        "players_online": 1,
        "chunks_loaded": 1,
        "blocks_sampled": 16,
        "entities_loaded": 3,
        "entities_capped": False,
        "sampled_from_loaded_only": True,
        "player_identifiers_excluded": True,
        "block_counts": {"minecraft:grass_block": 10, "minecraft:stone": 6},
        "entity_counts": {"minecraft:sheep": 3},
        "mspt_avg": 49.5,
        "password": "sensitive-untrusted-field",
        "player_uuid": "do-not-return",
        "coordinates": [1, 2, 3],
    }


class WorldSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.file = Path(self.directory.name) / "snapshot.json"

    def write(self, content):
        self.file.write_text(json.dumps(content), encoding="utf-8")

    def test_real_schema_returns_counts_and_no_private_fields(self):
        self.write(sample())
        data = SnapshotObserver(str(self.file)).world()
        self.assertEqual(data["entity_counts"]["minecraft:sheep"], 3)
        self.assertEqual(data["blocks_sampled"], 16)
        self.assertFalse(data["complete_world_view"])
        self.assertNotIn("do-not-return", json.dumps(data))
        self.assertNotIn("sensitive-untrusted-field", json.dumps(data))
        self.assertNotIn('"coordinates":', json.dumps(data))

    def test_tool_returns_aggregate_world(self):
        self.write(sample())
        result = ToolRegistry(SnapshotObserver(str(self.file))).invoke("guia_world_observe", {})
        self.assertTrue(result["read_only"])
        self.assertEqual(result["source"], "fabric_loaded_chunks")

    def test_plain_metrics_not_fabric(self):
        self.write({"players_online": 0, "game_ticks": 100})
        with self.assertRaises(WorldSnapshotError):
            SnapshotObserver(str(self.file)).world()

    def test_rejects_stale_and_future(self):
        raw = sample()
        raw["sample_epoch_ms"] -= 121000
        self.write(raw)
        with self.assertRaises(WorldSnapshotError):
            parse_world_snapshot(self.file)
        raw["sample_epoch_ms"] += 500000
        self.write(raw)
        with self.assertRaises(WorldSnapshotError):
            parse_world_snapshot(self.file)

    def test_rejects_missing_privacy_evidence(self):
        raw = sample()
        raw["player_identifiers_excluded"] = False
        self.write(raw)
        with self.assertRaises(WorldSnapshotError):
            parse_world_snapshot(self.file)

    def test_rejects_bad_counts(self):
        raw = sample()
        raw["block_counts"] = {"minecraft:stone": 30}
        self.write(raw)
        with self.assertRaises(WorldSnapshotError):
            parse_world_snapshot(self.file)

    def test_rejects_invalid_registry_key(self):
        raw = sample()
        raw["entity_counts"] = {"minecraft:sheep\" BAD": 3}
        self.write(raw)
        with self.assertRaises(WorldSnapshotError):
            parse_world_snapshot(self.file)

    def test_rejects_duplicate_fields(self):
        self.file.write_text('{"source":"fabric_loaded_chunks","source":"operator_snapshot"}')
        with self.assertRaises(WorldSnapshotError):
            parse_world_snapshot(self.file)

    def test_rejects_symlink(self):
        actual = Path(self.directory.name) / "actual.json"
        actual.write_text(json.dumps(sample()))
        self.file.symlink_to(actual)
        with self.assertRaises(WorldSnapshotError):
            parse_world_snapshot(self.file)

    def test_rcon_has_no_world_view(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "password"
            path.write_text("dummy")
            with self.assertRaises(WorldSnapshotError):
                RconObserver(str(path)).world()


if __name__ == "__main__":
    unittest.main()
