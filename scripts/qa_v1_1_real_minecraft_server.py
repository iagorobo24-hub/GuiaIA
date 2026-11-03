"""GuiaIA V1.1 - Real Disposable Minecraft & Cobblemon Laboratory on Durán.

Spins up an isolated disposable Minecraft 1.21.1 + Fabric + Cobblemon 1.8.2 server
on loopback port 25595 using official pre-provisioned runtime assets in .qa-cache.
Strictly isolated: never touches Teselia or external hosts.
"""
from __future__ import annotations

import argparse
import http.server
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
QA_CACHE = REPO_ROOT / ".qa-cache"
JAVA_EXE = QA_CACHE / "jre-21" / "jdk-21.0.13+9-jre" / "bin" / ("java.exe" if sys.platform == "win32" else "java")
LAUNCHER_JAR = QA_CACHE / "launcher.jar"
FABRIC_API_JAR = QA_CACHE / "fabric-api.jar"
COBBLEMON_JAR = QA_CACHE / "Cobblemon-fabric-1.8.2+1.21.1.jar"

SERVER_PORT = 25595
QA_CMD_PORT = 25599
SERVER_TIMEOUT = 180


def require_path(p: Path, name: str) -> Path:
    resolved = p.resolve()
    if not resolved.exists():
        raise RuntimeError(f"Missing required QA artifact: {name} at {resolved}")
    return resolved


def recent_log(file: Path, max_chars: int = 4000) -> str:
    if not file.exists():
        return "(no log yet)"
    return file.read_text(encoding="utf-8", errors="replace")[-max_chars:]


def send(process: subprocess.Popen, command: str) -> None:
    if process.poll() is not None or process.stdin is None:
        raise RuntimeError(f"Cannot send '{command}': QA Minecraft server process not running")
    process.stdin.write(command + "\n")
    process.stdin.flush()


def until(condition, seconds: float, *, process=None, note="condition") -> None:
    stop_at = time.monotonic() + seconds
    while time.monotonic() < stop_at:
        if condition():
            return
        if process is not None and process.poll() is not None:
            raise RuntimeError(f"QA Minecraft terminated prematurely while waiting for {note}")
        time.sleep(1)
    raise RuntimeError(f"Timed out after {seconds}s waiting for {note}")


def start_command_bridge(server_process: subprocess.Popen, log_file: Path = None, qa_root: Path = None) -> http.server.HTTPServer:
    class BridgeHandler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path.startswith("/player_data"):
                found = {}
                if qa_root and qa_root.exists():
                    for p in qa_root.glob("**/*.json"):
                        if "cobblemon" in str(p).lower() and "player" in str(p).lower():
                            try:
                                found[str(p.relative_to(qa_root))] = json.loads(p.read_text(encoding="utf-8"))
                            except Exception as e:
                                found[str(p.relative_to(qa_root))] = {"error": str(e)}
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"ok": True, "files": found}).encode("utf-8"))
            else:
                self.send_response(404)
                self.end_headers()

        def do_POST(self):
            if self.path == "/cmd":
                length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(length).decode("utf-8")
                try:
                    payload = json.loads(body)
                    cmd = payload.get("command") or payload.get("cmd", "")
                    output = ""
                    if cmd:
                        pos_start = log_file.stat().st_size if (log_file and log_file.exists()) else 0
                        send(server_process, cmd)
                        stop_wait = time.monotonic() + 1.2
                        while time.monotonic() < stop_wait:
                            time.sleep(0.1)
                            if log_file and log_file.exists() and log_file.stat().st_size > pos_start:
                                with open(log_file, "r", encoding="utf-8", errors="replace") as f:
                                    f.seek(pos_start)
                                    output = f.read()
                                if output.strip():
                                    break
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps({"ok": True, "output": output}).encode("utf-8"))
                except Exception as ex:
                    self.send_response(500)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps({"ok": False, "error": str(ex)}).encode("utf-8"))
            else:
                self.send_response(404)
                self.end_headers()

        def log_message(self, format, *args):
            pass

    httpd = http.server.HTTPServer(("127.0.0.1", QA_CMD_PORT), BridgeHandler)
    server_thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    server_thread.start()
    return httpd


def shutdown_server(process: subprocess.Popen, log) -> None:
    try:
        if process.poll() is None:
            try:
                send(process, "stop")
                process.wait(timeout=30)
            except (BrokenPipeError, RuntimeError, subprocess.TimeoutExpired):
                process.terminate()
                try:
                    process.wait(timeout=6)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=6)
    finally:
        if process.stdin is not None:
            process.stdin.close()
        log.close()


def main():
    parser = argparse.ArgumentParser(description="GuiaIA V1.1 Real Minecraft & Cobblemon E2E Laboratory")
    parser.add_argument("test_script", nargs="?", default="test/qa_v1_1_real_minecraft_e2e.js", help="Node test script to execute")
    parser.add_argument("--skip-cobblemon", action="store_true", help="Boot vanilla Fabric 1.21.1 without Cobblemon")
    args = parser.parse_args()

    # Preflight check QA artifacts
    java_exe = require_path(JAVA_EXE, "Adoptium Temurin JRE 21")
    launcher = require_path(LAUNCHER_JAR, "Fabric Server Launcher")
    fabric_api = require_path(FABRIC_API_JAR, "Fabric API")
    cobblemon = None if args.skip_cobblemon else require_path(COBBLEMON_JAR, "Cobblemon 1.8.2")

    # Check port availability
    for p in (SERVER_PORT, QA_CMD_PORT):
        try:
            with socket.create_connection(("127.0.0.1", p), timeout=0.3):
                raise RuntimeError(f"Port {p} already occupied; aborting disposable server spin")
        except (ConnectionRefusedError, TimeoutError, OSError):
            pass

    with tempfile.TemporaryDirectory(prefix="guiaia-v1-1-disposable-") as tmp_dir:
        qa_root = Path(tmp_dir)
        print(f"[QA] Initializing disposable laboratory at {qa_root}", flush=True)

        # Copy pre-provisioned runtime inputs from .qa-cache
        for directory in ("libraries", ".fabric/server"):
            source = QA_CACHE / directory
            if source.is_dir():
                dest = qa_root / directory
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copytree(source, dest)

        # Mods directory
        mods_dir = qa_root / "mods"
        mods_dir.mkdir(exist_ok=True)
        shutil.copy2(fabric_api, mods_dir / "fabric-api.jar")
        if cobblemon:
            shutil.copy2(cobblemon, mods_dir / "Cobblemon-fabric-1.8.2+1.21.1.jar")

        # Config files
        (qa_root / "eula.txt").write_text("eula=true\n", encoding="ascii")
        (qa_root / "server.properties").write_text(
            f"server-ip=127.0.0.1\n"
            f"server-port={SERVER_PORT}\n"
            f"online-mode=false\n"
            f"enforce-secure-profile=false\n"
            f"enable-rcon=false\n"
            f"enable-query=false\n"
            f"max-players=4\n"
            f"view-distance=3\n"
            f"simulation-distance=3\n"
            f"spawn-monsters=false\n"
            f"difficulty=peaceful\n"
            f"level-type=minecraft:flat\n"
            f"level-seed=20261103\n"
            f"motd=GuiaIA V1.1 Disposable Laboratory\n",
            encoding="ascii"
        )

        log_file = qa_root / "server.log"
        log = open(log_file, "w", encoding="utf-8")

        cmd = [
            str(java_exe),
            "-Xms512M",
            "-Xmx2048M",
            "-Djava.awt.headless=true",
            "-jar", str(launcher),
            "nogui"
        ]

        print(f"[QA] Launching Fabric 1.21.1 + Cobblemon 1.8.2 server...", flush=True)
        server_process = subprocess.Popen(
            cmd,
            cwd=qa_root,
            stdin=subprocess.PIPE,
            stdout=log,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1
        )

        cmd_server = None
        try:
            # Wait for server ready
            until(
                lambda: "Done (" in recent_log(log_file) or "Showdown started" in recent_log(log_file),
                SERVER_TIMEOUT,
                process=server_process,
                note="Fabric 1.21.1 server boot"
            )
            print("[QA] Minecraft server ready! Configuring world parameters...", flush=True)

            # World preparation commands
            setup_cmds = [
                "gamerule spawnRadius 0",
                "gamerule doDaylightCycle false",
                "gamerule doMobSpawning false",
                "gamerule doPokemonSpawning false",
                "time set noon",
                "fill -10 63 -10 20 63 20 minecraft:stone",
                "setworldspawn 2 64 2",
                "say GUIAIA_QA_V1_1_SERVER_READY"
            ]
            for sc in setup_cmds:
                send(server_process, sc)

            until(
                lambda: "GUIAIA_QA_V1_1_SERVER_READY" in recent_log(log_file),
                15,
                process=server_process,
                note="world preparation ready"
            )

            # Start local command bridge for the test runner
            cmd_server = start_command_bridge(server_process, log_file, qa_root)
            print(f"[QA] Server command bridge listening at 127.0.0.1:{QA_CMD_PORT}", flush=True)

            # Run Node E2E test runner
            test_script = args.test_script
            print(f"[QA] Executing Node.js suite ({test_script})...", flush=True)
            node_env = os.environ.copy()
            node_env["MC_PORT"] = str(SERVER_PORT)
            node_env["MC_HOST"] = "127.0.0.1"
            node_env["QA_CMD_PORT"] = str(QA_CMD_PORT)

            test_proc = subprocess.run(
                ["node", test_script],
                cwd=REPO_ROOT / "companion",
                env=node_env,
                text=True,
                capture_output=True,
                timeout=180
            )

            output = test_proc.stdout + "\n" + test_proc.stderr
            print(output, flush=True)

            if test_proc.returncode != 0:
                print("\n[QA SERVER RECENT LOG]:\n" + recent_log(log_file, 8000), flush=True)
                raise RuntimeError(f"Real Minecraft E2E test exited with code {test_proc.returncode}")

            marker = "GUIAIA_V1_1_REAL_MINECRAFT_E2E_EVIDENCE="
            if "qa_v1_1_real_minecraft_e2e.js" in test_script and marker not in output:
                raise RuntimeError("Missing required evidence marker in E2E output")

            print("\n[QA] ALL REAL MINECRAFT E2E MISSIONS COMPLETED SUCCESSFULLY!", flush=True)

        finally:
            if cmd_server:
                cmd_server.shutdown()
            print("[QA] Shutting down disposable Minecraft server...", flush=True)
            shutdown_server(server_process, log)


if __name__ == "__main__":
    main()
