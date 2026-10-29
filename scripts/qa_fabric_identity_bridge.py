"""Only disposable QA: real Fabric JOIN/DISCONNECT signed by server key.

Test server never touches Teselia, owns no production key, binds to loopback.
Java private Ed25519 key is generated in temporary dir with 0600 mode and
deleted with the temporary QA world.
"""
from __future__ import annotations
import argparse
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from qa_fabric_server import require_file, recent_log, start_server, shutdown, until, send

ROOT=Path(__file__).resolve().parents[1]

def clients(log, server):
    result=subprocess.run(["node","test/qa_real_bridge_clients.js"],
        cwd=ROOT/"companion",capture_output=True,text=True,timeout=60)
    result_text=result.stdout+"\n"+result.stderr
    if result.returncode!=0 or "GUIAIA_REAL_BRIDGE_CLIENTS_QA_EVIDENCE=" not in result_text:
        raise RuntimeError("Real Fabric connection QA failed\n"+
            result_text[-1200:]+"\n"+recent_log(log,1600))
    return result_text

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--launcher",required=True)
    parser.add_argument("--fabric-api",required=True)
    parser.add_argument("--mod",required=True)
    a=parser.parse_args()
    launcher=require_file(a.launcher,"QA launcher")
    api=require_file(a.fabric_api,"Fabric API")
    mod=require_file(a.mod,"QA Fabric mod")
    with tempfile.TemporaryDirectory(prefix="guiaia-fabric-bridge-qa-") as temp:
        root=Path(temp)
        (root/"eula.txt").write_text("eula=true\n",encoding="ascii")
        (root/"server.properties").write_text(
            "server-ip=127.0.0.1\nserver-port=25593\n"
            "online-mode=false\nenforce-secure-profile=false\n"
            "enable-rcon=false\nenable-query=false\n"
            "spawn-protection=0\nspawn-monsters=false\n"
            "difficulty=peaceful\nview-distance=4\nsimulation-distance=4\n",
            encoding="ascii")
        mods=root/"mods"
        mods.mkdir()
        shutil.copyfile(mod,mods/"guiaia-observer-with-qa-bridge.jar")
        shutil.copyfile(api,mods/"fabric-api.jar")
        server=None
        handle=None
        try:
            # Absolute fail-closed: no config means no key read, no output.
            log=root/"default-disabled.log"
            server,handle=start_server(root,launcher,log)
            until(lambda:"Done (" in recent_log(log),150,process=server,
                  note="identity bridge default-disabled server")
            clients(log,server)
            assert not (root/"config"/"guiaia-identity-bridge").exists(), (
                "Disabled-by-default bridge emitted identity events")
            shutdown(server,handle)
            server=None;handle=None

            config=root/"config"
            config.mkdir(exist_ok=True)
            private=config/"guiaia-identity-key.pk8"
            public=root/"qa-public.pem"
            js=(
                "const c=require('node:crypto'),f=require('node:fs');"
                "const x=c.generateKeyPairSync('ed25519');"
                "f.writeFileSync(process.argv[1],"
                "x.privateKey.export({format:'der',type:'pkcs8'}),{mode:0o600,flag:'wx'});"
                "f.writeFileSync(process.argv[2],"
                "x.publicKey.export({format:'pem',type:'spki'}),{flag:'wx'});"
            )
            subprocess.run(["node","-e",js,str(private),str(public)],
                cwd=ROOT,check=True,timeout=15)
            assert private.stat().st_mode & 0o777==0o600
            (config/"guiaia-identity-bridge.properties").write_text(
                "enabled=true\nqa_only=true\nworld_id=qa:real-fabric:25593\n",
                encoding="ascii")
            log=root/"configured-real-server.log"
            server,handle=start_server(root,launcher,log)
            until(lambda:"Done (" in recent_log(log),150,process=server,
                  note="opt-in Fabric bridge with ephemeral server key")
            print(clients(log,server).strip())
            events=config/"guiaia-identity-bridge"/"events.jsonl"
            until(lambda:events.is_file() and
                  events.read_text(encoding='utf8').count("\n")>=4,
                  20,process=server,note="four server-signed JOIN/DISCONNECT events")
            verify=subprocess.run(["node","test/qa_verify_real_bridge.js",
                str(events),str(public)],cwd=ROOT/"companion",
                capture_output=True,text=True,timeout=20)
            if verify.returncode!=0:
                raise RuntimeError("Real server signature verification failed\n"+
                    verify.stdout+verify.stderr+"\n"+recent_log(log,1300))
            print(verify.stdout.strip())
            shutdown(server,handle)
            server=None;handle=None

            # After restart stale evidence must be gone; no prior connection
            # can be treated as still active by a file-based observer.
            restarted=root/"restarted-without-players.log"
            server,handle=start_server(root,launcher,restarted)
            until(lambda:"Done (" in recent_log(restarted),150,
                  process=server,note="QA restart with no live sessions")
            assert events.is_file() and events.stat().st_size==0, (
                "Stale bridge connection evidence survived server boot")
            print('GUIAIA_REAL_BRIDGE_RESTART_QA_EVIDENCE={"result":"pass",'
                  '"stale_connection_log_cleared":true,'
                  '"no_offline_identity_authenticated":true,"production":false}')

            # Actual Fabric-signed JOIN is consumed by the existing QA action
            # gateway, together with a synthetic pre-enrolled player key.
            # Only temporary QA world commands; no use of Teselia.
            for command in (
                "gamerule spawnRadius 0",
                "fill 0 63 0 8 63 8 minecraft:stone",
                "setworldspawn 2 64 2",
                "setblock 4 64 3 minecraft:chest",
                "say GUIAIA_BRIDGE_CHEST_READY",
            ):
                send(server,command)
            until(lambda:"GUIAIA_BRIDGE_CHEST_READY" in recent_log(restarted),
                  15,process=server,note="isolated real Fabric bridge chest")
            client=subprocess.Popen(
                ["node","test/qa_live_bridge_gateway.js",str(events),
                 str(public),str(root/"journal")],
                cwd=ROOT/"companion",stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,text=True)
            try:
                until(lambda:"GuiaIA_QA joined the game" in recent_log(restarted) and
                             "OwnerQA joined the game" in recent_log(restarted),
                      30,process=server,note="both real Fabric QA players joined")
                for command in (
                    # OwnerQA has playerdata from the preceding test-world
                    # login and may spawn far from the newly planted chest.
                    # Only the disposable QA world is teleported here.
                    "tp OwnerQA 2 64 2",
                    "give GuiaIA_QA minecraft:oak_log 1",
                    "give GuiaIA_QA minecraft:birch_log 1",
                    "say GUIAIA_BRIDGE_TEST_INVENTORY_READY",
                ):
                    send(server,command)
                until(lambda:"GUIAIA_BRIDGE_TEST_INVENTORY_READY" in recent_log(restarted),
                      15,process=server,note="temporary QA inventory provided")
                out,err=client.communicate(timeout=83)
                result=out+"\\n"+err
                if client.returncode!=0 or "GUIAIA_REAL_SERVER_SESSION_GATE_QA_EVIDENCE=" not in result:
                    raise RuntimeError("Actual Fabric-to-companion session proof failed\\n"+
                                       result[-2000:]+"\\n"+recent_log(restarted,1600))
                print(result.strip())
            finally:
                if client.poll() is None:
                    client.terminate()
                    try:client.wait(timeout=5)
                    except subprocess.TimeoutExpired:client.kill();client.wait()
        finally:
            if server is not None:shutdown(server,handle)

if __name__=="__main__":
    main()
