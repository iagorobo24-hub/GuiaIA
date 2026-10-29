"""Real signed gather->navigate->deposit QA on one disposable Fabric instance.

No shared Teselia files, no production bridge key, loopback only.
"""
from __future__ import annotations

import argparse
import json
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
    parser.add_argument("--crash-after-deposit", action="store_true")
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
            child_env = os.environ.copy()
            if args.crash_after_deposit:
                child_env["GUIAIA_QA_CRASH_DURING_SIGNED_DEPOSIT"] = "1"
            client = subprocess.Popen(
                ["node", "test/qa_live_bridge_gateway.js", str(events),
                 str(public), str(root / "journal")],
                cwd=ROOT / "companion", env=child_env,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            )
            until(lambda: (
                "GuiaIA_QA joined the game" in recent_log(log) and
                "OwnerQA joined the game" in recent_log(log)
            ), 30, process=server, note="two real QA clients joined")
            # Crash test isolates durable transfer recovery from long route
            # times on a resource-limited QA server. The normal integration
            # test still verifies full navigation in both directions.
            setup_commands = ["tp OwnerQA 2 64 2"]
            if args.crash_after_deposit:
                setup_commands.append("tp GuiaIA_QA 6 64 2")
            setup_commands.extend([
                "give GuiaIA_QA minecraft:oak_log 1",
                "give GuiaIA_QA minecraft:birch_log 1",
                "say GUIAIA_BRIDGE_TEST_INVENTORY_READY",
            ])
            for command in setup_commands:
                send(server, command)
            until(lambda: "GUIAIA_BRIDGE_TEST_INVENTORY_READY" in recent_log(log),
                  20, process=server, note="both QA inventories ready")
            out, err = client.communicate(timeout=120)
            result = out + "\n" + err
            if args.crash_after_deposit:
                marker = "GUIAIA_REAL_SIGNED_DELIVERY_CRASH_POINT_QA_EVIDENCE="
                if client.returncode != 77 or marker not in result:
                    raise RuntimeError(
                        "Real signed pipeline did not crash at the expected "
                        "durable barrier\n" + result[-3500:] +
                        "\nMinecraft tail:\n" + recent_log(log, 1800)
                    )
                point = next(json.loads(line.split("=", 1)[1])
                             for line in result.splitlines()
                             if line.startswith(marker))
                if (point.get("result") != "pass" or
                    point.get("real_gather_receipts") != 1 or
                    point.get("real_deposit_receipts") != 0 or
                    point.get("crash_phase") != "transferring" or
                    point.get("transfer_confirmed_by_both_inventories") is not True):
                    raise RuntimeError("Signed delivery crash injection lacked real evidence")
                journal = root / "journal"
                mission_path = journal / "delivery-mission" / "mission.json"
                deposit_path = journal / "delivery-deposit" / "deposit.json"
                original_mission = mission_path.read_bytes()
                original_deposit = deposit_path.read_bytes()
                mission = json.loads(original_mission)
                deposit = json.loads(original_deposit)
                if (mission["phase"] != "completed" or
                    mission["index"] != 1 or len(mission["receipts"]) != 1 or
                    deposit["phase"] != "transferring" or
                    deposit["index"] != 0 or deposit["receipts"] or
                    not deposit["operationId"] or
                    not (journal / "delivery-mission" / "mission.lock").is_file() or
                    not (journal / "delivery-deposit" / "deposit.lock").is_file()):
                    raise RuntimeError("Signed pipeline did not durably record expected pre-crash progress")
                until(lambda: "GuiaIA_QA lost connection" in recent_log(log),
                      30, process=server, note="crashed QA bot disconnected")
                send(server, "save-all flush")
                send(server, "say GUIAIA_SIGNED_DELIVERY_CRASH_SAVED")
                until(lambda: "GUIAIA_SIGNED_DELIVERY_CRASH_SAVED" in recent_log(log),
                      20, process=server, note="post-crash Minecraft world saved")
                shutdown(server, handle)
                server = handle = None

                # Reopen THE SAME disposable world. Never unlock journals
                # or issue a new signed operation to reconcile uncertain state.
                after = root / "after-signed-delivery-crash-restart.log"
                server, handle = start_server(root, launcher, after)
                until(lambda: "Done (" in recent_log(after), 390,
                      process=server, note="signed delivery crash world restarted")
                audit_env = os.environ.copy()
                audit_env["GUIAIA_QA_CRASH_AUDIT_ROOT"] = str(root)
                audit = subprocess.run(
                    ["node", "test/qa_real_signed_delivery_crash_audit.js"],
                    cwd=ROOT / "companion", env=audit_env,
                    capture_output=True, text=True, timeout=80, check=False,
                )
                audit_text = audit.stdout + "\n" + audit.stderr
                marker2 = "GUIAIA_REAL_SIGNED_DELIVERY_CRASH_RECOVERY_QA_EVIDENCE="
                if audit.returncode != 0 or marker2 not in audit_text:
                    raise RuntimeError(
                        "Real signed delivery passive recovery failed\n" +
                        audit_text[-2800:] + "\n" + recent_log(after, 1000)
                    )
                if (mission_path.read_bytes() != original_mission or
                    deposit_path.read_bytes() != original_deposit):
                    raise RuntimeError("Read-only restart audit changed signed journal bytes")
                print(marker + json.dumps(point))
                print(audit.stdout.strip())
                print("GUIAIA_SIGNED_DELIVERY_CRASH_E2E_QA_EVIDENCE=" +
                      json.dumps({
                          "result": "pass", "production": False,
                          "client_exit": 77,
                          "same_fabric_world_restarted": True,
                          "signed_gather_durable": True,
                          "real_deposit_transferred": True,
                          "deposit_receipt_saved": False,
                          "stale_locks_preserved": True,
                          "uncertain_transfer_needs_manual_review": True,
                          "no_auto_replay_or_reissue": True,
                      }))
            else:
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
