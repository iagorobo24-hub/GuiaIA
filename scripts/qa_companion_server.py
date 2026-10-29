"""Verify a Mineflayer companion's real login/follow/stop on an isolated test world.

This script is NEVER allowed to access Teselia; it creates and destroys a
temporary flat world on GitHub CI with loopback-only networking.
"""
from __future__ import annotations

import argparse
import subprocess
import tempfile
from pathlib import Path

from qa_fabric_server import require_file, recent_log, start_server, shutdown, until

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--launcher", required=True)
    args = parser.parse_args()
    launcher = require_file(args.launcher, "Fabric server launcher")
    with tempfile.TemporaryDirectory(prefix="guiaia-companion-disposable-") as root:
        game = Path(root)
        (game / "eula.txt").write_text("eula=true\n")
        (game / "server.properties").write_text(
            "server-ip=127.0.0.1\nserver-port=25598\n"
            "online-mode=false\nenforce-secure-profile=false\n"
            "enable-rcon=false\nenable-query=false\nmax-players=4\n"
            "view-distance=5\nsimulation-distance=5\n"
            "spawn-monsters=false\ndifficulty=peaceful\n"
            "level-type=minecraft:flat\nlevel-seed=20261029\n"
            "motd=Disposable GuiaIA companion QA only\n",
        )
        log_file = game / "qa.log"
        server, log = start_server(game, launcher, log_file)
        try:
            until(lambda: "Done (" in recent_log(log_file), 155,
                  process=server, note="companion QA world ready")
            # Only the local test runner launches the bots; no external network.
            result = subprocess.run(
                ["node", "test/qa_real_server.js"],
                cwd=ROOT / "companion", text=True, capture_output=True,
                timeout=85, check=False,
            )
            output = result.stdout + "\n" + result.stderr
            if result.returncode != 0 or "GUIAIA_BOT_QA_EVIDENCE=" not in output:
                raise RuntimeError("Real companion QA failed\n" +
                                   output[-1800:] + "\n" + recent_log(log_file, 2000))
            print(output.strip())
        finally:
            shutdown(server, log)


if __name__ == "__main__":
    main()
