import json
import tempfile
import unittest
from pathlib import Path

from guiaia.mcp import MCP
from guiaia.observer import SnapshotObserver
from guiaia.sandbox import (
    DiagnosticAssistant,
    SandboxComparisonResult,
    SandboxSecurityError,
    generate_sandbox_server_properties,
    validate_sandbox_dir,
)


class DiagnosticSandboxTests(unittest.TestCase):
    def test_sandbox_validation_enforces_safety(self):
        with tempfile.TemporaryDirectory(prefix="guiaia-sandbox-qa-") as tmp:
            valid_path = Path(tmp)
            self.assertEqual(validate_sandbox_dir(valid_path), valid_path.resolve())

            # Rejects non-existent path
            non_existent = valid_path / "does_not_exist"
            with self.assertRaises(SandboxSecurityError):
                validate_sandbox_dir(non_existent)

            # Rejects file instead of directory
            test_file = valid_path / "file.txt"
            test_file.write_text("data")
            with self.assertRaises(SandboxSecurityError):
                validate_sandbox_dir(test_file)

    def test_sandbox_validation_rejects_production_markers(self):
        with tempfile.TemporaryDirectory(prefix="guiaia-test-") as tmp:
            forbidden_dir = Path(tmp) / "Teselia_prod"
            forbidden_dir.mkdir()
            with self.assertRaises(SandboxSecurityError):
                validate_sandbox_dir(forbidden_dir)

    def test_sandbox_server_properties(self):
        props = generate_sandbox_server_properties(port=25596)
        self.assertIn("server-ip=127.0.0.1", props)
        self.assertIn("server-port=25596", props)
        self.assertIn("online-mode=false", props)
        self.assertIn("spawn-monsters=false", props)

        with self.assertRaises(SandboxSecurityError):
            generate_sandbox_server_properties(port=80)

    def test_diagnostic_assistant_mcp_flow_and_comparison(self):
        with tempfile.TemporaryDirectory(prefix="guiaia-diag-") as tmp:
            snap_path = Path(tmp) / "snapshot.json"

            # 1. Anomalous state: high MSPT and high entities
            snap_path.write_text(json.dumps({
                "players_online": 1,
                "game_ticks": 5000,
                "mspt_avg": 58.4,
                "tps": 16.5,
                "entities_loaded": 380,
            }), encoding="utf-8")

            observer_before = SnapshotObserver(str(snap_path))
            mcp_before = MCP(observer_before)
            assistant_before = DiagnosticAssistant(mcp_before)

            diag_before = assistant_before.run_diagnosis()
            self.assertEqual(diag_before["mode"], "diagnosis_only")
            self.assertEqual(diag_before["production_changes"], 0)
            self.assertGreaterEqual(len(diag_before["findings"]), 2)

            # 2. Mitigated state: normal MSPT and low entities
            snap_path.write_text(json.dumps({
                "players_online": 1,
                "game_ticks": 6000,
                "mspt_avg": 24.1,
                "tps": 20.0,
                "entities_loaded": 45,
            }), encoding="utf-8")

            observer_after = SnapshotObserver(str(snap_path))
            mcp_after = MCP(observer_after)
            assistant_after = DiagnosticAssistant(mcp_after)

            diag_after = assistant_after.run_diagnosis()
            self.assertEqual(diag_after["mode"], "diagnosis_only")
            self.assertEqual(diag_after["production_changes"], 0)
            self.assertEqual(len(diag_after["findings"]), 0)

            # 3. Compare before and after
            comp = assistant_after.compare(diag_before, diag_after, sandbox_path=tmp)
            self.assertTrue(comp.anomaly_detected)
            self.assertTrue(comp.improvement_verified)
            self.assertFalse(comp.production_modified)
            self.assertTrue(comp.sandbox_isolated)
            self.assertGreater(len(comp.resolved_findings), 0)
            self.assertEqual(len(comp.remaining_findings), 0)
            self.assertAlmostEqual(comp.metrics_delta["mspt_avg_delta"], -34.3)
            self.assertEqual(comp.metrics_delta["entities_loaded_delta"], -335)

            as_dict = comp.to_dict()
            self.assertIn("timestamp_utc", as_dict)
            json_str = json.dumps(as_dict)
            self.assertIn("improvement_verified", json_str)


if __name__ == "__main__":
    unittest.main()
