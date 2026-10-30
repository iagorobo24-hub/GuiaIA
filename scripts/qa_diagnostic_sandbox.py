"""Disposable Fabric sandbox diagnostic assistant QA script.

Reproduces an anomaly (e.g. entity clustering hotspot), performs structured MCP diagnosis,
applies safe mitigation strictly within the disposable sandbox, and verifies
the improvement without touching any production server or world.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import socket
import tempfile
import time
from pathlib import Path

from guiaia.mcp import MCP
from guiaia.observer import SnapshotObserver
from guiaia.sandbox import (
    DiagnosticAssistant,
    generate_sandbox_server_properties,
    validate_sandbox_dir,
)
from guiaia.world_snapshot import parse_world_snapshot

ROOT = Path(__file__).resolve().parents[1]


def run_mock_diagnostic(qa_dir: Path) -> dict:
    snap_path = qa_dir / "snapshot.json"
    # Anomaly state: entity clustering hotspot
    snap_path.write_text(json.dumps({
        "players_online": 1,
        "game_ticks": 12000,
        "mspt_avg": 54.2,
        "tps": 17.1,
        "entities_loaded": 320,
    }), encoding="utf-8")

    observer = SnapshotObserver(str(snap_path))
    assistant = DiagnosticAssistant(MCP(observer))
    diag_before = assistant.run_diagnosis()

    # Mitigated state in sandbox
    snap_path.write_text(json.dumps({
        "players_online": 1,
        "game_ticks": 13200,
        "mspt_avg": 22.8,
        "tps": 20.0,
        "entities_loaded": 40,
    }), encoding="utf-8")

    observer_after = SnapshotObserver(str(snap_path))
    assistant_after = DiagnosticAssistant(MCP(observer_after))
    diag_after = assistant_after.run_diagnosis()

    comp = assistant.compare(diag_before, diag_after, sandbox_path=qa_dir)
    return comp.to_dict()


def run_real_server_diagnostic(launcher: Path, fabric_api: Path, mod: Path) -> dict:
    from qa_fabric_server import (
        SERVER_TIMEOUT,
        recent_log,
        require_file,
        send,
        shutdown,
        start_server,
        until,
    )

    port = 25595
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.3):
            raise RuntimeError(f"Sandbox port {port} already occupied")
    except (ConnectionRefusedError, TimeoutError, OSError):
        pass

    with tempfile.TemporaryDirectory(prefix="guiaia-diagnostic-sandbox-") as tmp:
        qa_dir = validate_sandbox_dir(tmp)
        mods_dir = qa_dir / "mods"
        mods_dir.mkdir(parents=True)
        shutil.copy2(fabric_api, mods_dir / "fabric-api.jar")
        shutil.copy2(mod, mods_dir / "observer.jar")

        (qa_dir / "eula.txt").write_text("eula=true\n", encoding="ascii")
        (qa_dir / "server.properties").write_text(
            generate_sandbox_server_properties(port=port), encoding="ascii"
        )

        conf_dir = qa_dir / "config"
        conf_dir.mkdir(parents=True)
        (conf_dir / "guiaia-observer.properties").write_text(
            "enabled=true\ndimension=minecraft:overworld\n"
            "center_x=0\ncenter_y=64\ncenter_z=0\ninterval_ticks=200\n",
            encoding="ascii",
        )

        log_file = qa_dir / "sandbox.log"
        snap_file = conf_dir / "guiaia-observer" / "snapshot.json"
        server, handle = start_server(qa_dir, launcher, log_file)
        try:
            until(
                lambda: "Done (" in recent_log(log_file),
                SERVER_TIMEOUT,
                process=server,
                note="diagnostic sandbox server startup",
            )
            send(server, "forceload add 0 0")
            # Spawn cluster of entities in chunk (0,0) to reproduce entity hotspot anomaly
            for i in range(160):
                x = i % 16
                z = (i // 16) % 16
                send(server, f"summon minecraft:sheep {x} 64 {z} {{NoAI:1b,NoGravity:1b}}")
            send(server, "say GUIAIA_ANOMALY_SPAWNED")
            until(
                lambda: "GUIAIA_ANOMALY_SPAWNED" in recent_log(log_file),
                40,
                process=server,
                note="anomaly entity cluster spawned",
            )
            # Wait for observer snapshot with capped entities (64)
            until(
                lambda: snap_file.is_file() and parse_world_snapshot(snap_file)["entities_capped"],
                60,
                process=server,
                note="observer snapshot anomaly captured",
            )

            # 1. Diagnose anomaly
            observer = SnapshotObserver(str(snap_file))
            assistant = DiagnosticAssistant(MCP(observer))
            diag_before = assistant.run_diagnosis()
            prior_epoch = json.loads(snap_file.read_text(encoding="utf-8")).get("sample_epoch_ms", 0)

            # 2. Apply mitigation strictly in sandbox
            send(server, "kill @e[type=minecraft:sheep]")
            send(server, "say GUIAIA_MITIGATION_APPLIED")
            until(
                lambda: "GUIAIA_MITIGATION_APPLIED" in recent_log(log_file),
                30,
                process=server,
                note="mitigation applied in sandbox",
            )

            # Wait for next snapshot after mitigation
            def snapshot_updated_and_cleared():
                if not snap_file.is_file():
                    return False
                try:
                    data = json.loads(snap_file.read_text(encoding="utf-8"))
                    if data.get("sample_epoch_ms", 0) <= prior_epoch:
                        return False
                    return not data.get("entities_capped", False)
                except Exception:
                    return False

            until(
                snapshot_updated_and_cleared,
                60,
                process=server,
                note="post-mitigation snapshot updated",
            )

            # 3. Diagnose post-mitigation
            observer_after = SnapshotObserver(str(snap_file))
            assistant_after = DiagnosticAssistant(MCP(observer_after))
            diag_after = assistant_after.run_diagnosis()

            # 4. Compare before and after
            comp = assistant.compare(diag_before, diag_after, sandbox_path=qa_dir)
            return comp.to_dict()
        finally:
            shutdown(server, handle)


def main():
    parser = argparse.ArgumentParser(description="GuiaIA Diagnostic Sandbox QA")
    parser.add_argument("--launcher", help="Path to Fabric server launcher JAR")
    parser.add_argument("--fabric-api", help="Path to Fabric API JAR")
    parser.add_argument("--mod", help="Path to GuiaIA observer JAR")
    parser.add_argument("--mock", action="store_true", help="Run mock diagnostic workflow")
    args = parser.parse_args()

    if args.mock or not (args.launcher and args.fabric_api and args.mod):
        with tempfile.TemporaryDirectory(prefix="guiaia-diagnostic-mock-") as tmp:
            qa_dir = validate_sandbox_dir(tmp)
            report = run_mock_diagnostic(qa_dir)
    else:
        from qa_fabric_server import require_file
        launcher = require_file(args.launcher, "Fabric launcher")
        fabric_api = require_file(args.fabric_api, "Fabric API")
        mod = require_file(args.mod, "Observer mod")
        report = run_real_server_diagnostic(launcher, fabric_api, mod)

    assert report["anomaly_detected"], "Anomaly must be detected before mitigation"
    assert report["improvement_verified"], "Improvement must be verified after mitigation"
    assert not report["production_modified"], "Production must never be modified"
    assert report["sandbox_isolated"], "Sandbox must be strictly isolated"

    evidence = {
        "result": "pass",
        **report,
    }
    print("GUIAIA_DIAGNOSTIC_SANDBOX_QA_EVIDENCE=" + json.dumps(evidence, sort_keys=True))


if __name__ == "__main__":
    main()
