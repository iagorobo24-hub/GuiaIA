"""Disposable chest transfer QA in real Minecraft, no Teselia services touched."""
from __future__ import annotations
import argparse
import os
import subprocess
import tempfile
from pathlib import Path
from qa_fabric_server import require_file, recent_log, start_server, shutdown, until, send

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--launcher", required=True)
    parser.add_argument("--client", choices=["qa_chest_server.js","qa_operator_auth_server.js","qa_offline_session_server.js"], default="qa_chest_server.js")
    args=parser.parse_args()
    launcher = require_file(args.launcher, "Fabric server launcher")
    with tempfile.TemporaryDirectory(prefix="guiaia-chest-qa-") as temporary:
        qa = Path(temporary)
        (qa / "eula.txt").write_text("eula=true\n")
        (qa / "server.properties").write_text(
            "server-ip=127.0.0.1\nserver-port=25595\n"
            "online-mode=false\nenforce-secure-profile=false\n"
            "enable-rcon=false\nenable-query=false\nmax-players=3\n"
            "view-distance=4\nsimulation-distance=4\n"
            "spawn-protection=0\nspawn-monsters=false\ndifficulty=peaceful\n"
            "level-type=minecraft:flat\nlevel-seed=20261029\n"
            "motd=Disposable GuiaIA chest QA ONLY\n"
        )
        log_file = qa / "server.log"
        server, handle = start_server(qa, launcher, log_file)
        client = None
        try:
            until(lambda: "Done (" in recent_log(log_file), 145,
                  process=server, note="chest QA server ready")
            for cmd in (
                "gamerule spawnRadius 0",
                "fill 0 63 0 8 63 8 minecraft:stone",
                "setworldspawn 2 64 2",
                "setblock 4 64 3 minecraft:chest",
                "say GUIAIA_CHEST_QA_READY",
            ):
                send(server, cmd)
            until(lambda: "GUIAIA_CHEST_QA_READY" in recent_log(log_file),
                  15, process=server, note="approved chest planted")
            env = os.environ.copy()
            env["GUIAIA_QA_DEPOSIT_DIR"] = str(qa / "journal")
            client = subprocess.Popen(
                ["node", "test/"+args.client],
                cwd=ROOT / "companion", env=env,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            )
            until(lambda: "GuiaIA_QA joined the game" in recent_log(log_file),
                  30, process=server, note="QA bot connected")
            for cmd in (
                "give GuiaIA_QA minecraft:oak_log 1",
                "give GuiaIA_QA minecraft:birch_log 1",
                "say GUIAIA_CHEST_ITEMS_READY",
            ):
                send(server, cmd)
            until(lambda: "GUIAIA_CHEST_ITEMS_READY" in recent_log(log_file),
                  15, process=server, note="test items delivered")
            out, err = client.communicate(timeout=87)
            evidence = out + "\n" + err
            markers = {"qa_chest_server.js":"GUIAIA_CHEST_DEPOSIT_QA_EVIDENCE=", "qa_operator_auth_server.js":"GUIAIA_SIGNED_CHEST_AUTH_QA_EVIDENCE=", "qa_offline_session_server.js":"GUIAIA_OFFLINE_SESSION_GATE_QA_EVIDENCE="}
            marker = markers[args.client]
            if client.returncode != 0 or marker not in evidence:
                raise RuntimeError("Real chest QA failed:\n" + evidence[-2500:] +
                                   "\n" + recent_log(log_file, 2400))
            print(evidence.strip())
        finally:
            if client is not None and client.poll() is None:
                client.terminate()
                try:
                    client.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    client.kill()
                    client.wait()
            shutdown(server, handle)


if __name__ == "__main__":
    main()
