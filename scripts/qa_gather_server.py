"""One-block real Minecraft gather proof, isolated from every production world.

Runs only on an ephemeral GitHub Actions runner. The server accepts loopback
connections and has RCON disabled. Local QA commands prepare a disposable
flat platform, not Minecraft Teselia or any owner save.
"""
from __future__ import annotations

import argparse
import subprocess
import tempfile
from pathlib import Path
from qa_fabric_server import (
    require_file, recent_log, start_server, shutdown, until, send
)

REPO = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--launcher", required=True)
    args = parser.parse_args()
    launcher = require_file(args.launcher, "Fabric QA launcher")
    with tempfile.TemporaryDirectory(prefix="guiaia-gather-qa-") as temporary:
        qa = Path(temporary)
        (qa / "eula.txt").write_text("eula=true\n")
        (qa / "server.properties").write_text(
            "server-ip=127.0.0.1\nserver-port=25599\n"
            "online-mode=false\nenforce-secure-profile=false\n"
            "enable-rcon=false\nenable-query=false\nmax-players=3\n"
            "view-distance=4\nsimulation-distance=4\n"
            "spawn-protection=0\n"
            "spawn-monsters=false\ndifficulty=peaceful\n"
            "level-type=minecraft:flat\nlevel-seed=20261029\n"
            "motd=Disposable GuiaIA gather QA ONLY\n"
        )
        log_path = qa / "lab.log"
        server, log = start_server(qa, launcher, log_path)
        try:
            until(lambda: "Done (" in recent_log(log_path), 145,
                  process=server, note="gather QA server startup")
            send(server, "gamerule spawnRadius 0")
            send(server, "fill 0 63 0 7 63 7 minecraft:stone")
            send(server, "setworldspawn 2 64 2")
            send(server, "setblock 3 64 2 minecraft:oak_log")
            until(lambda: "Changed the block at 3, 64, 2" in recent_log(log_path),
                  12, process=server, note="known QA oak log placed")
            result = subprocess.run(
                ["node", "test/qa_gather_server.js"],
                cwd=REPO / "companion", text=True, capture_output=True,
                timeout=82, check=False
            )
            output = result.stdout + "\n" + result.stderr
            if result.returncode != 0 or "GUIAIA_GATHER_QA_EVIDENCE=" not in output:
                raise RuntimeError("Gather QA failed\n" + output[-2500:] +
                                   "\n" + recent_log(log_path, 2300))
            print(output.strip())
        finally:
            shutdown(server, log)


if __name__ == "__main__":
    main()
