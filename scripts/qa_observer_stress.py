"""Disposable, bounded observer stress/profile on an official Fabric 1.21.1 server.

Three phases with a single temporary world:
- matched load (observer OFF, 160 frozen sheep)
- same world and load (observer ON, 160 frozen sheep)
- higher load (observer ON, 320 frozen sheep)

Only reports tick-query difference; it is NOT an authoritative overhead benchmark.
Everything runs on a dedicated GitHub runner with a loopback-only QA server.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import tempfile
import time
from pathlib import Path

from qa_fabric_server import (
    SERVER_TIMEOUT, recent_log, require_file, send, shutdown, start_server, until,
)
from guiaia.world_snapshot import parse_world_snapshot


def tick_query_mspt(log_file: Path) -> float | None:
    text = log_file.read_text(encoding="utf-8", errors="replace")
    for line in reversed(text.splitlines()):
        if "tick" not in line.lower():
            continue
        for pattern in (
            r"average(?: time)?(?: of)?\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:milli)?seconds?\s*per\s*tick",
            r"average(?: time)?(?: of)?\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?)\s*ms\s*per\s*tick",
            r"([0-9]+(?:\.[0-9]+)?)\s*ms(?:\s*per\s*tick)?",
        ):
            match = re.search(pattern, line, flags=re.I)
            if match:
                value = float(match.group(1))
                if 0 <= value <= 1000:
                    return value
    return None


def spawn_frozen_sheep(process, start: int, total: int) -> None:
    # NoAI + NoGravity prevents sheep from wandering or falling off Y=64.
    # Positions are inside one chunk only, distributed over 16x16 columns.
    for i in range(start, start + total):
        x, z = i % 16, (i // 16) % 16
        send(process, f"summon minecraft:sheep {x} 64 {z} {{NoAI:1b,NoGravity:1b}}")
    # All commands are on the disposable server console; never production.


def run_phase(qa: Path, launcher: Path, *, name: str, observed: bool,
              initial: int, added: int, prior_timestamp: int = 0):
    log_file = qa / (name + ".log")
    snap = qa / "config/guiaia-observer/snapshot.json"
    process, log = start_server(qa, launcher, log_file)
    try:
        until(lambda: "Done (" in recent_log(log_file), SERVER_TIMEOUT,
              process=process, note=name + " server startup")
        send(process, "forceload add 0 0")
        if added:
            spawn_frozen_sheep(process, initial, added)
        expected = initial + added
        # Queue marker: issued after all summons, ensures the server processed all.
        send(process, "say GUIAIA_STRESS_SETUP_COMPLETE")
        until(lambda: "GUIAIA_STRESS_SETUP_COMPLETE" in recent_log(log_file),
              35, process=process, note=name + " completed spawn commands")
        send(process, "tick query")
        # Warm up 200 ticks before collecting metrics / steady snapshot.
        time.sleep(12)
        send(process, "tick query")
        time.sleep(2)
        tick_mspt = tick_query_mspt(log_file)
        snapshot = None
        if observed:
            def captured():
                if not snap.is_file():
                    return False
                try:
                    data = parse_world_snapshot(snap)
                except (ValueError, OSError):
                    return False
                if (data["chunks_loaded"] != 1 or
                        data["entities_loaded"] != 64 or
                        not data["entities_capped"] or
                        sum(data["entity_counts"].values()) != 64):
                    return False
                if json.loads(snap.read_text()).get("sample_epoch_ms", 0) <= prior_timestamp:
                    return False
                nonlocal snapshot
                snapshot = data
                return True

            until(captured, 35, process=process, note=name + " bounded entity cap")
        if expected < 160:
            raise AssertionError("Load missing")
        return {
            "phase": name, "observer_enabled": observed,
            "frozen_sheep_requested": expected, "tick_query_mspt": tick_mspt,
            "sampler_mspt": snapshot["mspt_avg"] if snapshot else None,
            "entities_sampled": snapshot["entities_loaded"] if snapshot else None,
            "entities_capped": snapshot["entities_capped"] if snapshot else None,
            "blocks_sampled": snapshot["blocks_sampled"] if snapshot else None,
        }
    except Exception as exc:
        raw = snap.read_text(encoding="utf-8", errors="replace")[:1200] if snap.exists() else "(missing)"
        raise RuntimeError(str(exc) + "\nSAMPLE=" + raw + "\n" + recent_log(log_file)) from exc
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
    with tempfile.TemporaryDirectory(prefix="guiaia-stress-") as root:
        qa = Path(root)
        mods = qa / "mods"
        mods.mkdir()
        shutil.copy2(fabric_api, mods / "fabric-api.jar")
        shutil.copy2(mod, mods / "observer.jar")
        (qa / "eula.txt").write_text("eula=true\n")
        (qa / "server.properties").write_text(
            "server-ip=127.0.0.1\nserver-port=25597\n"
            "online-mode=false\nenforce-secure-profile=false\n"
            "enable-rcon=false\nenable-query=false\nmax-players=1\n"
            "view-distance=3\nsimulation-distance=3\n"
            "spawn-monsters=false\ndifficulty=peaceful\n"
            "level-type=minecraft:flat\nlevel-seed=20261029\n"
            "motd=Disposable GuiaIA stress QA\n",
        )
        conf_dir = qa / "config"
        conf_dir.mkdir()
        config_file = conf_dir / "guiaia-observer.properties"
        control = run_phase(qa, launcher, name="control_160", observed=False,
                            initial=0, added=160)
        config_file.write_text(
            "enabled=true\ndimension=minecraft:overworld\n"
            "center_x=0\ncenter_y=64\ncenter_z=0\ninterval_ticks=200\n",
        )
        with_observer = run_phase(qa, launcher, name="observer_160", observed=True,
                                  initial=160, added=0)
        snapshot = json.loads((conf_dir / "guiaia-observer/snapshot.json").read_text())
        high = run_phase(qa, launcher, name="observer_320", observed=True,
                         initial=160, added=160,
                         prior_timestamp=snapshot["sample_epoch_ms"])
        ratio = None
        if (control["tick_query_mspt"] is not None and
                with_observer["tick_query_mspt"] is not None):
            ratio = round(with_observer["tick_query_mspt"] -
                          control["tick_query_mspt"], 3)
        print("GUIAIA_STRESS_EVIDENCE=" + json.dumps({
            "result": "pass",
            "data": [control, with_observer, high],
            "matched_load_mspt_difference": ratio,
            "sample_cap_64_verified": True,
            "observer_disabled_control": True,
            "world": "temporary_superflat",
            "production_test": False,
            "caution": "Single GitHub runner; values are indicative, not benchmark proof",
        }, sort_keys=True))


if __name__ == "__main__":
    main()
