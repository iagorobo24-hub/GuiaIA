"""Isolated real Minecraft client crash between chest transfer and receipt.

No production server access. The synthetic Mineflayer client deliberately
exits with code 77 AFTER the server accepted transfer and BEFORE the journal
saved a success. World is saved and restarted, then audited read-only.
"""
from __future__ import annotations
import argparse
import json
import os
import subprocess
import tempfile
from pathlib import Path
from qa_fabric_server import require_file,recent_log,start_server,shutdown,until,send

ROOT=Path(__file__).resolve().parents[1]
def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--launcher",required=True)
    launcher=require_file(parser.parse_args().launcher,"Fabric QA launcher")
    with tempfile.TemporaryDirectory(prefix="guiaia-inflight-qa-") as temporary:
        root=Path(temporary)
        (root/"eula.txt").write_text("eula=true\n")
        (root/"server.properties").write_text(
            "server-ip=127.0.0.1\nserver-port=25594\n"
            "online-mode=false\nenforce-secure-profile=false\n"
            "enable-rcon=false\nenable-query=false\nmax-players=3\n"
            "view-distance=4\nsimulation-distance=4\nspawn-protection=0\n"
            "spawn-monsters=false\ndifficulty=peaceful\n"
            "level-type=minecraft:flat\nlevel-seed=20261029\n")
        env=os.environ.copy()
        env["GUIAIA_QA_DEPOSIT_DIR"]=str(root/"journal")
        env["GUIAIA_QA_EXPECTED_PHASE"]="transferring"
        env["GUIAIA_QA_EXPECTED_STATUS"]="manual_review_required"
        env["GUIAIA_QA_REQUIRE_TRANSFER_COUNTS"]="true"
        server=None
        handle=None
        client=None
        try:
            log=root/"before-inflight-crash.log"
            server,handle=start_server(root,launcher,log)
            until(lambda:"Done (" in recent_log(log),150,process=server,
                  note="in-flight transfer world ready")
            for command in (
                "gamerule spawnRadius 0",
                "fill 0 63 0 8 63 8 minecraft:stone",
                "setworldspawn 2 64 2",
                "setblock 4 64 3 minecraft:chest",
                "say GUIAIA_INFLIGHT_WORLD_READY",
            ):
                send(server,command)
            until(lambda:"GUIAIA_INFLIGHT_WORLD_READY" in recent_log(log),15,
                  process=server,note="in-flight test chest installed")
            client=subprocess.Popen(
                ["node","test/qa_inflight_deposit_crash.js"],
                cwd=ROOT/"companion",env=env,
                stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
            until(lambda:"GuiaIA_QA joined the game" in recent_log(log),30,
                  process=server,note="synthetic transfer player joined")
            for command in (
                "give GuiaIA_QA minecraft:oak_log 1",
                "say GUIAIA_INFLIGHT_RESOURCE_READY",
            ):
                send(server,command)
            until(lambda:"GUIAIA_INFLIGHT_RESOURCE_READY" in recent_log(log),
                  15,process=server,note="single synthetic test item provisioned")
            out,err=client.communicate(timeout=70)
            diagnostic=out+"\n"+err
            if client.returncode!=77 or "GUIAIA_INFLIGHT_FAULT_QA_EVIDENCE=" not in diagnostic:
                raise RuntimeError("Controlled fault did not trigger at expected barrier\n"+
                                   diagnostic[-2000:]+"\n"+recent_log(log,1400))
            print(diagnostic.strip())
            raw=(root/"journal"/"deposit.json").read_bytes()
            state=json.loads(raw)
            if state["phase"]!="transferring" or state["receipts"] or state["index"]!=0:
                raise RuntimeError("World transferred but durable receipt was unexpectedly saved")
            if not (root/"journal"/"deposit.lock").is_file():
                raise RuntimeError("Unexpectedly missing stale lock after bot crash")
            until(lambda:"GuiaIA_QA lost connection" in recent_log(log) or
                         "GuiaIA_QA left the game" in recent_log(log),
                  20,process=server,note="crashed client disconnected")
            send(server,"save-all flush")
            send(server,"say GUIAIA_INFLIGHT_SAVE_COMPLETE")
            until(lambda:"GUIAIA_INFLIGHT_SAVE_COMPLETE" in recent_log(log),
                  15,process=server,note="world saved with unacknowledged transfer")
            shutdown(server,handle)
            server=None
            handle=None

            after=root/"after-inflight-crash-restart.log"
            server,handle=start_server(root,launcher,after)
            until(lambda:"Done (" in recent_log(after),150,process=server,
                  note="in-flight crash world reopened")
            result=subprocess.run(
                ["node","test/qa_restart_snapshot_server.js"],
                cwd=ROOT/"companion",env=env,
                capture_output=True,text=True,timeout=57,check=False)
            evidence=result.stdout+"\n"+result.stderr
            if result.returncode or "GUIAIA_RESTART_SNAPSHOT_QA_EVIDENCE=" not in evidence:
                raise RuntimeError("Passive recovery failed\n"+evidence[-2000:]+
                                   "\n"+recent_log(after,1400))
            if (root/"journal"/"deposit.json").read_bytes()!=raw:
                raise RuntimeError("Passive recovery changed in-flight journal bytes")
            if not (root/"journal"/"deposit.lock").exists():
                raise RuntimeError("Passive recovery removed stale lock")
            print(evidence.strip())
            print("GUIAIA_INFLIGHT_REPLAY_DENIAL_QA_EVIDENCE="+json.dumps({
                "result":"pass","world_transfer_verified_before_client_crash":True,
                "client_exit_code":77,
                "journal_phase":"transferring",
                "durable_receipts":0,
                "same_world_after_real_server_restart":True,
                "journal_unchanged_by_passive_audit":True,
                "stale_process_lock_preserved":True,
                "automatic_replay_denied":True,
                "production":False,
            }))
        finally:
            if client is not None and client.poll() is None:
                client.terminate()
                try:client.wait(timeout=5)
                except subprocess.TimeoutExpired:client.kill();client.wait()
            if server is not None:shutdown(server,handle)

if __name__=="__main__":
    main()
