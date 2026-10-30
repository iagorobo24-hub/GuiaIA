"""Actual Minecraft save -> restart -> read-only player/chest/ledger audit.

Runs on GitHub's isolated loopback Fabric 1.21.1 lab, not Teselia.
Also checks a forced server stop AFTER an explicit save-all flush, not a crash
during the transaction or proof against abrupt host power failure.
"""
from __future__ import annotations
import argparse
import os
import subprocess
import tempfile
from pathlib import Path
from qa_fabric_server import require_file,recent_log,start_server,shutdown,until,send

ROOT=Path(__file__).resolve().parents[1]
def run_client(filename: str, env: dict[str,str], expected: str, log_path: Path, timeout: int=85) -> str:
    result=subprocess.run(
        ["node","test/"+filename],cwd=ROOT/"companion",env=env,
        capture_output=True,text=True,timeout=timeout,check=False)
    output=result.stdout+"\n"+result.stderr
    if result.returncode!=0 or expected not in output:
        raise RuntimeError("Real restart QA client failed: "+filename+"\n"+
                           output[-2200:]+"\n"+recent_log(log_path,1600))
    print(output.strip())
    return output

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--launcher",required=True)
    launcher=require_file(parser.parse_args().launcher,"Fabric QA launcher")
    with tempfile.TemporaryDirectory(prefix="guiaia-restart-qa-") as temporary:
        root=Path(temporary)
        (root/"eula.txt").write_text("eula=true\n")
        (root/"server.properties").write_text(
            "server-ip=127.0.0.1\nserver-port=25594\n"
            "online-mode=false\nenforce-secure-profile=false\n"
            "enable-rcon=false\nenable-query=false\nmax-players=3\n"
            "view-distance=4\nsimulation-distance=4\nspawn-protection=0\n"
            "spawn-monsters=false\ndifficulty=peaceful\n"
            "level-type=minecraft:flat\nlevel-seed=20261029\n"
            "motd=Disposable restart validation only\n")
        env=os.environ.copy()
        env["GUIAIA_QA_PORT"]="25594"
        env["GUIAIA_QA_DEPOSIT_DIR"]=str(root/"journal")
        process=None
        handle=None
        try:
            # Initial server and actual two-sided transfers.
            first_log=root/"initial-server.log"
            process,handle=start_server(root,launcher,first_log)
            until(lambda:"Done (" in recent_log(first_log),150,
                  process=process,note="first disposable restart QA launch")
            for command in (
                "gamerule spawnRadius 0",
                "fill 0 63 0 8 63 8 minecraft:stone",
                "setworldspawn 2 64 2",
                "setblock 4 64 3 minecraft:chest",
                "say GUIAIA_FIRST_RESTART_WORLD_READY",
            ):
                send(process,command)
            until(lambda:"GUIAIA_FIRST_RESTART_WORLD_READY" in recent_log(first_log),
                  15,process=process,note="first QA chest installed")
            # Client needs to log in before synthetic test inventory can be
            # granted. Use Popen as original QA does.
            client=subprocess.Popen(["node","test/qa_chest_server.js"],
                cwd=ROOT/"companion",env=env,
                stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
            try:
                until(lambda:"GuiaIA_QA joined the game" in recent_log(first_log),
                      30,process=process,note="QA synthetic bot joined first world")
                for command in (
                    "give GuiaIA_QA minecraft:oak_log 1",
                    "give GuiaIA_QA minecraft:birch_log 1",
                    "say GUIAIA_INITIAL_ITEMS_READY",
                ):
                    send(process,command)
                until(lambda:"GUIAIA_INITIAL_ITEMS_READY" in recent_log(first_log),
                      15,process=process,note="initial test materials provisioned")
                stdout,stderr=client.communicate(timeout=87)
                result=stdout+"\n"+stderr
                if client.returncode!=0 or "GUIAIA_CHEST_DEPOSIT_QA_EVIDENCE=" not in result:
                    raise RuntimeError("First-world real transfer refused\n"+result[-1800:])
                print(result.strip())
            finally:
                if client.poll() is None:
                    client.terminate()
                    try:client.wait(timeout=5)
                    except subprocess.TimeoutExpired:client.kill();client.wait()
            # Clean shutdown saves player data, region chest data and world.
            shutdown(process,handle)
            process=None
            handle=None

            second_log=root/"after-graceful-restart.log"
            process,handle=start_server(root,launcher,second_log)
            until(lambda:"Done (" in recent_log(second_log),150,
                  process=process,note="Minecraft restart using original world")
            run_client("qa_restart_snapshot_server.js",env,
                "GUIAIA_RESTART_SNAPSHOT_QA_EVIDENCE=",second_log,timeout=55)

            # Explicit save barrier followed by abrupt process kill. This
            # establishes survival of a process crash *after* a durable save,
            # not loss-tolerance to power failure during an in-flight deposit.
            send(process,"save-all flush")
            send(process,"say GUIAIA_SAVED_BEFORE_FORCE_STOP")
            until(lambda:"GUIAIA_SAVED_BEFORE_FORCE_STOP" in recent_log(second_log),
                  15,process=process,note="forced-stop post-save barrier")
            process.kill()
            process.wait(timeout=15)
            if process.stdin is not None:process.stdin.close()
            handle.close()
            process=None
            handle=None

            third_log=root/"after-forced-process-stop.log"
            process,handle=start_server(root,launcher,third_log)
            until(lambda:"Done (" in recent_log(third_log),150,
                  process=process,note="Minecraft restart after prior saved kill")
            run_client("qa_restart_snapshot_server.js",env,
                "GUIAIA_RESTART_SNAPSHOT_QA_EVIDENCE=",third_log,timeout=55)
            print("GUIAIA_SERVER_RESTART_QA_EVIDENCE="+__import__("json").dumps({
                "result":"pass",
                "real_server_restarts":2,
                "graceful_restart_verified":True,
                "forced_server_stop_after_explicit_save_verified":True,
                "same_persisted_world_directory":True,
                "real_player_inventory_read":True,
                "real_chest_inventory_read":True,
                "journal_passive_no_replay":True,
                "in_flight_power_failure_proven":False,
                "production":False,
            }))
        finally:
            if process is not None:
                shutdown(process,handle)

if __name__=="__main__":
    main()
