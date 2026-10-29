"""Real signed gather->navigate->deposit QA on one disposable Fabric instance.

No shared Teselia files, no production bridge key, loopback only.
"""
from __future__ import annotations

import argparse
import os
import shutil
import socket
import subprocess
import tempfile
from pathlib import Path

from qa_fabric_server import require_file, recent_log, start_server, shutdown, until, send

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--launcher", required=True)
    parser.add_argument("--fabric-api", required=True)
    parser.add_argument("--mod", required=True)
    args = parser.parse_args()
    launcher = require_file(args.launcher, "QA Fabric server")
    fabric_api = require_file(args.fabric_api, "QA Fabric API")
    observer = require_file(args.mod, "QA bridge mod")
    for port in (25593, 25594):
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.4):
                raise RuntimeError(f"QA port {port} already occupied")
        except ConnectionRefusedError:
            pass

    with tempfile.TemporaryDirectory(prefix="guiaia-fabric-bridge-qa-") as temp:
        root = Path(temp)
        (root / "eula.txt").write_text("eula=true\n", encoding="ascii")
        (root / "server.properties").write_text(
            "server-ip=127.0.0.1\nserver-port=25593\n"
            "online-mode=false\nenforce-secure-profile=false\n"
            "enable-rcon=false\nenable-query=false\nmax-players=3\n"
            "spawn-protection=0\nspawn-monsters=false\n"
            "difficulty=peaceful\nview-distance=4\nsimulation-distance=4\n"
            "level-type=minecraft:flat\nlevel-seed=20261029\n",
            encoding="ascii",
        )
        mods = root / "mods"
        mods.mkdir()
        shutil.copyfile(observer, mods / "guiaia-observer-with-qa-bridge.jar")
        shutil.copyfile(fabric_api, mods / "fabric-api.jar")
        config = root / "config"
        config.mkdir()
        private = config / "guiaia-identity-key.pk8"
        public = root / "qa-public.pem"
        keygen = (
            "const c=require('node:crypto'),f=require('node:fs');"
            "const k=c.generateKeyPairSync('ed25519');"
            "f.writeFileSync(process.argv[1],"
            "k.privateKey.export({format:'der',type:'pkcs8'}),{mode:0o600,flag:'wx'});"
            "f.writeFileSync(process.argv[2],"
            "k.publicKey.export({format:'pem',type:'spki'}),{flag:'wx'});"
        )
        subprocess.run(
            ["node", "-e", keygen, str(private), str(public)],
            cwd=ROOT, timeout=15, check=True,
        )
        (config / "guiaia-identity-bridge.properties").write_text(
            "enabled=true\nqa_only=true\nworld_id=qa:real-fabric:25593\n",
            encoding="ascii",
        )
        log = root / "real-signed-delivery.log"
        server = handle = None
        client = None
        try:
            server, handle = start_server(root, launcher, log)
            until(lambda: "Done (" in recent_log(log), 390,
                  process=server, note="single-instance signed delivery QA ready")
            for command in (
                "forceload add 0 0",
                "gamerule spawnRadius 0",
                "fill 0 63 0 8 63 8 minecraft:stone",
                "setworldspawn 2 64 2",
                "setblock 4 64 3 minecraft:chest",
                "setblock 1 64 5 minecraft:chest",
                "setblock 7 64 2 minecraft:oak_log",
                "say GUIAIA_REAL_DELIVERY_WORLD_READY",
            ):
                send(server, command)
            until(lambda: (
                "GUIAIA_REAL_DELIVERY_WORLD_READY" in recent_log(log) and
                "Changed the block at 4, 64, 3" in recent_log(log) and
                "Changed the block at 1, 64, 5" in recent_log(log) and
                "Changed the block at 7, 64, 2" in recent_log(log)
            ), 30, process=server, note="exact disposable chest and log")
            events = config / "guiaia-identity-bridge" / "events.jsonl"
            client = subprocess.Popen(
                ["node", "test/qa_live_bridge_gateway.js", str(events),
                 str(public), str(root / "journal")],
                cwd=ROOT / "companion", stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, text=True,
            )
            until(lambda: (
                "GuiaIA_QA joined the game" in recent_log(log) and
                "OwnerQA joined the game" in recent_log(log)
            ), 30, process=server, note="two real QA clients joined")
            for command in (
                "tp OwnerQA 2 64 2",
                "give GuiaIA_QA minecraft:oak_log 1",
                "give GuiaIA_QA minecraft:birch_log 1",
                "say GUIAIA_BRIDGE_TEST_INVENTORY_READY",
            ):
                send(server, command)
            until(lambda: "GUIAIA_BRIDGE_TEST_INVENTORY_READY" in recent_log(log),
                  20, process=server, note="both QA inventories ready")
            out, err = client.communicate(timeout=120)
            result = out + "\n" + err
            if client.returncode != 0 or (
                "GUIAIA_REAL_SIGNED_DELIVERY_QA_EVIDENCE=" not in result or
                "GUIAIA_REAL_SERVER_SESSION_GATE_QA_EVIDENCE=" not in result
            ):
                raise RuntimeError(
                    "Real Fabric signed delivery QA failed\n" + result[-3800:] +
                    "\nMinecraft tail:\n" + recent_log(log, 2400)
                )
            print(result.strip())
        finally:
            if client is not None and client.poll() is None:
                client.terminate()
                try:
                    client.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    client.kill()
                    client.wait()
            if server is not None:
                shutdown(server, handle)


if __name__ == "__main__":
    main()
