"""Reproducible two-block durable mission QA in disposable Minecraft Fabric.

Never touches Teselia, a live Minecraft world or a real user credential.
"""
from __future__ import annotations
import argparse
import os
import subprocess
import tempfile
from pathlib import Path
from qa_fabric_server import require_file, recent_log, start_server, shutdown, until, send
ROOT = Path(__file__).resolve().parents[1]

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--launcher",required=True)
    launcher=require_file(parser.parse_args().launcher,"Fabric server launcher")
    with tempfile.TemporaryDirectory(prefix="guiaia-mission-qa-") as temporary:
        qa=Path(temporary)
        (qa/"eula.txt").write_text("eula=true\n")
        (qa/"server.properties").write_text(
            "server-ip=127.0.0.1\nserver-port=25596\n"
            "online-mode=false\nenforce-secure-profile=false\n"
            "enable-rcon=false\nenable-query=false\nmax-players=3\n"
            "view-distance=4\nsimulation-distance=4\n"
            "spawn-protection=0\nspawn-monsters=false\ndifficulty=peaceful\n"
            "level-type=minecraft:flat\nlevel-seed=20261029\n"
            "motd=Disposable GuiaIA durable mission QA\n")
        log=qa/"minecraft.log"
        server,handle=start_server(qa,launcher,log)
        try:
            until(lambda:"Done (" in recent_log(log),150,process=server,
                  note="durable mission QA server ready")
            for command in (
                "gamerule spawnRadius 0",
                "fill 0 63 0 7 63 7 minecraft:stone",
                "setworldspawn 2 64 2",
                "setblock 3 64 2 minecraft:oak_log",
                "setblock 5 64 2 minecraft:oak_log",
            ):
                send(server,command)
            until(lambda:"Changed the block at 5, 64, 2" in recent_log(log),
                  15,process=server,note="both synthetic oak logs placed")
            env=os.environ.copy()
            env["GUIAIA_QA_MISSION_DIR"]=str(qa/"journal")
            result=subprocess.run(["node","test/qa_mission_server.js"],
                                  cwd=ROOT/"companion",env=env,
                                  capture_output=True,text=True,timeout=87,check=False)
            output=result.stdout+"\n"+result.stderr
            if result.returncode!=0 or "GUIAIA_MISSION_QA_EVIDENCE=" not in output:
                raise RuntimeError("Disposable mission QA FAILED\n"+output[-2600:]+
                                   "\n"+recent_log(log,2200))
            print(output.strip())
        finally:
            shutdown(server,handle)

if __name__=="__main__":
    main()
