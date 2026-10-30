"""Two distinct resources + bounded movement, real Minecraft QA.

Runs in GitHub Actions only. Disposable Minecraft Java 1.21.1 world with
loopback-only access, no RCON, synthetic players, no Teselia mounts.
"""
from __future__ import annotations
import argparse
import os
import subprocess
import tempfile
from pathlib import Path
from qa_fabric_server import require_file,recent_log,start_server,shutdown,until,send

ROOT=Path(__file__).resolve().parents[1]
def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--launcher",required=True)
    launcher=require_file(parser.parse_args().launcher,"Official Fabric QA launcher")
    with tempfile.TemporaryDirectory(prefix="guiaia-mission-qa-") as root:
        qa=Path(root)
        (qa/"eula.txt").write_text("eula=true\n")
        (qa/"server.properties").write_text(
            "server-ip=127.0.0.1\nserver-port=25596\n"
            "online-mode=false\nenforce-secure-profile=false\n"
            "enable-rcon=false\nenable-query=false\n"
            "max-players=3\nview-distance=4\nsimulation-distance=4\n"
            "spawn-protection=0\nspawn-monsters=false\ndifficulty=peaceful\n"
            "level-type=minecraft:flat\nlevel-seed=20261029\n"
            "motd=Disposable GuiaIA multi-resource QA\n")
        logfile=qa/"server.log"
        server,log=start_server(qa,launcher,logfile)
        try:
            until(lambda:"Done (" in recent_log(logfile),145,
                  process=server,note="multi-resource Minecraft ready")
            for command in (
                "gamerule spawnRadius 0",
                "fill 0 63 0 14 63 7 minecraft:stone",
                "setworldspawn 2 64 2",
                "setblock 3 64 2 minecraft:oak_log",
                "setblock 9 64 2 minecraft:birch_log",
                "setblock 7 64 3 minecraft:chest",
                "say GUIAIA_MULTI_RESOURCE_QA_READY",
            ):
                send(server,command)
            until(lambda:"GUIAIA_MULTI_RESOURCE_QA_READY" in recent_log(logfile),
                  15,process=server,note="typed QA resources planted")
            env=os.environ.copy()
            env["GUIAIA_QA_MISSION_DIR"]=str(qa/"journal")
            result=subprocess.run(
                ["node","test/qa_multiresource_server.js"],
                cwd=ROOT/"companion",env=env,capture_output=True,
                text=True,timeout=96,check=False)
            output=result.stdout+"\n"+result.stderr
            if result.returncode!=0 or "GUIAIA_MULTI_RESOURCE_QA_EVIDENCE=" not in output:
                raise RuntimeError("Mixed-resource QA FAILED\n"+output[-3000:]+
                                   "\n"+recent_log(logfile,2100))
            print(output.strip())
        finally:
            shutdown(server,log)

if __name__=="__main__":
    main()
