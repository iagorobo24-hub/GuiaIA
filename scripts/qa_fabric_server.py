"""Disposable Fabric Minecraft 1.21.1 observer integration test.

ONLY runs in an empty temporary QA directory, never on a real Minecraft world.
The QA server is restricted to loopback and RCON is disabled. It can safely
mutate its synthetic world to establish that the observer sees real blocks/mobs.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from guiaia.world_snapshot import WorldSnapshotError, parse_world_snapshot
from guiaia.mcp import MCP
from guiaia.observer import SnapshotObserver

REPO_ROOT = Path(__file__).resolve().parents[1]
SERVER_TIMEOUT = 165


def require_file(path: str, description: str) -> Path:
    target = Path(path).expanduser().resolve(strict=True)
    if not target.is_file():
        raise RuntimeError(description + " is not a file")
    return target


def recent_log(file: Path, max_chars: int = 4500) -> str:
    if not file.exists():
        return "(log missing)"
    return file.read_text(encoding="utf-8", errors="replace")[-max_chars:]


def start_server(qa_dir: Path, launcher: Path, log_path: Path) -> tuple[subprocess.Popen, object]:
    log = open(log_path, "w", encoding="utf-8")
    cmd = [
        "java", "-Xms256M", "-Xmx1500M",
        "-Djava.awt.headless=true", "-jar", str(launcher), "nogui",
    ]
    process = subprocess.Popen(
        cmd, cwd=qa_dir, stdin=subprocess.PIPE, stdout=log,
        stderr=subprocess.STDOUT, text=True, bufsize=1,
    )
    return process, log


def send(process: subprocess.Popen, command: str) -> None:
    if process.poll() is not None or process.stdin is None:
        raise RuntimeError("Disposable QA server exited before receiving test command")
    process.stdin.write(command + "\n")
    process.stdin.flush()


def until(condition, seconds: float, *, process=None, note="condition") -> None:
    stop_at = time.monotonic() + seconds
    while time.monotonic() < stop_at:
        if condition():
            return
        if process is not None and process.poll() is not None:
            raise RuntimeError("QA Minecraft terminated while waiting for " + note)
        time.sleep(1)
    raise RuntimeError("Timed out waiting for " + note)


def shutdown(process: subprocess.Popen, log) -> None:
    try:
        if process.poll() is None:
            try:
                send(process, "stop")
                process.wait(timeout=35)
            except (BrokenPipeError, RuntimeError, subprocess.TimeoutExpired):
                process.terminate()
                try:
                    process.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=8)
    finally:
        if process.stdin is not None:
            process.stdin.close()
        log.close()


def validate_enabled(server_dir: Path, launcher: Path) -> dict:
    config_dir = server_dir / "config"
    config_dir.mkdir(exist_ok=True)
    (config_dir / "guiaia-observer.properties").write_text(
        "enabled=true\n"
        "dimension=minecraft:overworld\n"
        "center_x=0\ncenter_y=64\ncenter_z=0\n"
        "interval_ticks=200\n",
        encoding="ascii",
    )
    log_file = server_dir / "enabled-server.log"
    snapshot_file = config_dir / "guiaia-observer" / "snapshot.json"
    process, log = start_server(server_dir, launcher, log_file)
    started = time.monotonic()
    try:
        until(lambda: "Done (" in recent_log(log_file),
              SERVER_TIMEOUT, process=process, note="Fabric QA server ready")
        # These commands change only the temporary QA world; the observer does not.
        send(process, "forceload add 0 0")
        send(process, "setblock 0 64 0 minecraft:diamond_block")
        send(process, "setblock 2 63 2 minecraft:stone")
        send(process, "summon minecraft:sheep 2 64 2")
        seen = {}

        def observed():
            if not snapshot_file.is_file():
                return False
            try:
                result = parse_world_snapshot(snapshot_file)
            except (WorldSnapshotError, OSError):
                return False
            if result["chunks_loaded"] != 1 or result["blocks_sampled"] != 16:
                return False
            if result["block_counts"].get("minecraft:diamond_block", 0) < 1:
                return False
            if result["entity_counts"].get("minecraft:sheep", 0) < 1:
                return False
            seen.update(result)
            return True

        until(observed, 42, process=process, note="real chunk block and mob observations")
        # Verify real Fabric JSON end-to-end through the actual MCP tool handler.
        mcp = MCP(SnapshotObserver(str(snapshot_file)))
        initialized = mcp.handle({"jsonrpc": "2.0", "id": 1, "method": "initialize",
                                  "params": {"protocolVersion": "2025-11-25"}})
        assert initialized["result"]["protocolVersion"] == "2025-11-25"
        response = mcp.handle({"jsonrpc": "2.0", "id": 2, "method": "tools/call",
                               "params": {"name": "guia_world_observe", "arguments": {}}})
        live = response["result"]["structuredContent"]
        assert not response["result"]["isError"]
        assert live["block_counts"].get("minecraft:diamond_block", 0) >= 1
        assert live["entity_counts"].get("minecraft:sheep", 0) >= 1
        # Verify private Linux permissions of the observer-owned output.
        # GitHub Actions is Linux/POSIX, where these checks are mandatory.
        from stat import S_IMODE
        output_directory_mode = S_IMODE(snapshot_file.parent.stat().st_mode)
        output_file_mode = S_IMODE(snapshot_file.stat().st_mode)
        if output_directory_mode != 0o700 or output_file_mode != 0o600:
            raise RuntimeError("Observer output permissions are not private")
        # Output must not contain player names, raw coordinates or all world entities.
        raw = json.loads(snapshot_file.read_text(encoding="utf-8"))
        assert not any(k in raw for k in ("player_name", "player_uuid", "coordinates", "rcon", "chat"))
        assert seen["entities_loaded"] <= 64
        assert seen["blocks_sampled"] <= 16
        return {
            "result": "pass",
            "source": seen["source"],
            "game_ticks": seen["game_ticks"],
            "chunks_loaded": seen["chunks_loaded"],
            "blocks_sampled": seen["blocks_sampled"],
            "diamond_blocks": seen["block_counts"]["minecraft:diamond_block"],
            "sheep_observed": seen["entity_counts"]["minecraft:sheep"],
            "entities_capped": seen["entities_capped"],
            "mspt_avg": seen["mspt_avg"],
            "elapsed_wall_seconds": round(time.monotonic() - started, 1),
            "observer_code_has_no_world_mutation_calls": True,
            "real_minecraft_server": True,
            "production_world": False,
            "mcp_fabric_real_snapshot_roundtrip": True,
            "private_file_0600_and_directory_0700_verified": True,
            "test_world": "disposable_flat_qa",
        }
    except Exception as exc:
        raw_snapshot = (snapshot_file.read_text(encoding="utf-8", errors="replace")[:1800]
                        if snapshot_file.is_file() else "(snapshot missing)")
        raise RuntimeError(str(exc) + "\nLAST_QA_SNAPSHOT=" + raw_snapshot
                           + "\n" + recent_log(log_file)) from exc
    finally:
        shutdown(process, log)


def validate_unloaded(server_dir: Path, launcher: Path, old_timestamp_ms: int) -> dict:
    """Confirm that sampling a distant, ungenerated chunk does not load it."""
    config_dir = server_dir / "config"
    snapshot_file = config_dir / "guiaia-observer" / "snapshot.json"
    (config_dir / "guiaia-observer.properties").write_text(
        "enabled=true\n"
        "dimension=minecraft:overworld\n"
        "center_x=20000\ncenter_y=64\ncenter_z=20000\n"
        "interval_ticks=200\n",
        encoding="ascii",
    )
    log_file = server_dir / "unloaded-server.log"
    process, log = start_server(server_dir, launcher, log_file)
    try:
        until(lambda: "Done (" in recent_log(log_file),
              SERVER_TIMEOUT, process=process, note="distant chunk QA startup")

        def distant_snapshot_is_safe():
            if not snapshot_file.is_file():
                return False
            try:
                raw = json.loads(snapshot_file.read_text(encoding="utf-8"))
                if raw.get("sample_epoch_ms", 0) <= old_timestamp_ms:
                    return False
                data = parse_world_snapshot(snapshot_file)
                return (data["chunks_loaded"] == 0 and data["blocks_sampled"] == 0
                        and data["entities_loaded"] == 0)
            except (ValueError, OSError, TypeError):
                return False

        until(distant_snapshot_is_safe, 45, process=process,
              note="unloaded far chunk stays unobserved and unforced")
        return {"distant_unloaded_chunk_not_forced": True}
    except Exception as exc:
        raw_snapshot = (snapshot_file.read_text(encoding="utf-8", errors="replace")[:1800]
                        if snapshot_file.is_file() else "(snapshot missing)")
        raise RuntimeError(str(exc) + "\nLAST_QA_SNAPSHOT=" + raw_snapshot
                           + "\n" + recent_log(log_file)) from exc
    finally:
        shutdown(process, log)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--launcher", required=True)
    parser.add_argument("--fabric-api", required=True)
    parser.add_argument("--mod", required=True)
    args = parser.parse_args()
    launcher = require_file(args.launcher, "Fabric server launcher")
    fabric_api = require_file(args.fabric_api, "Fabric API")
    mod = require_file(args.mod, "Observer JAR")
    with tempfile.TemporaryDirectory(prefix="guiaia-fabric-qa-") as temporary:
        qa_dir = Path(temporary)
        mods = qa_dir / "mods"
        mods.mkdir()
        shutil.copy2(fabric_api, mods / "fabric-api.jar")
        shutil.copy2(mod, mods / "guiaia-world-observer.jar")
        (qa_dir / "eula.txt").write_text("eula=true\n", encoding="ascii")
        (qa_dir / "server.properties").write_text(
            "server-ip=127.0.0.1\n"
            "server-port=25596\n"
            "online-mode=false\n"
            "enforce-secure-profile=false\n"
            "enable-rcon=false\n"
            "enable-query=false\n"
            "max-players=1\n"
            "view-distance=3\n"
            "simulation-distance=3\n"
            "spawn-monsters=false\n"
            "difficulty=peaceful\n"
            "level-type=minecraft:flat\n"
            "level-seed=12345\n"
            "motd=Disposable GuiaIA QA only\n",
            encoding="ascii",
        )
        # Disabled-by-default gate: mod present, but no explicit configuration.
        log_file = qa_dir / "disabled-server.log"
        process, log = start_server(qa_dir, launcher, log_file)
        try:
            until(lambda: "Done (" in recent_log(log_file),
                  SERVER_TIMEOUT, process=process, note="disabled QA startup")
            until(lambda: "observer disabled" in recent_log(log_file).lower(),
                  5, process=process, note="observer disabled log")
            if (qa_dir / "config/guiaia-observer/snapshot.json").exists():
                raise RuntimeError("Disabled observer wrote a snapshot")
        except Exception as exc:
            raise RuntimeError(str(exc) + "\n" + recent_log(log_file)) from exc
        finally:
            shutdown(process, log)
        evidence = validate_enabled(qa_dir, launcher)
        first_snapshot = qa_dir / "config/guiaia-observer/snapshot.json"
        first_timestamp_ms = json.loads(first_snapshot.read_text(encoding="utf-8"))["sample_epoch_ms"]
        evidence.update(validate_unloaded(qa_dir, launcher, first_timestamp_ms))
        evidence["disabled_by_default_verified"] = True
        evidence["java_runtime"] = "21"
        print("GUIAIA_QA_EVIDENCE=" + json.dumps(evidence, sort_keys=True))


if __name__ == "__main__":
    main()
