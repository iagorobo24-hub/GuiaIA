"""Small MCP stdio server for local agent clients; default has no network listener.

Targets MCP 2025-11-25 / 2025-06-18 lifecycle. Future protocol revisions
are not advertised until conformance tests exist. stdout is protocol-only.
"""
from __future__ import annotations

import argparse
import json
import sys
from .observer import SnapshotObserver, RconObserver
from .tools import ToolRegistry, ToolError, format_content

PROTOCOL_VERSION = "2025-11-25"
SUPPORTED = {"2025-11-25", "2025-06-18"}


class MCP:
    def __init__(self, observer):
        self.tools = ToolRegistry(observer)
        self.initialized = False
        self.version = PROTOCOL_VERSION

    def handle(self, message: dict) -> dict | None:
        if not isinstance(message, dict) or message.get("jsonrpc") != "2.0":
            return self._error(message.get("id") if isinstance(message, dict) else None, -32600, "Invalid Request")
        method = message.get("method")
        request_id = message.get("id")
        if request_id is None:
            # JSON-RPC notification, never invoke a tool.
            if method == "notifications/initialized" and self.initialized:
                return None
            return None
        if not isinstance(method, str):
            return self._error(request_id, -32600, "Missing method")
        params = message.get("params", {})
        if not isinstance(params, dict):
            return self._error(request_id, -32602, "Params must be an object")
        if method == "initialize":
            requested = params.get("protocolVersion")
            self.version = requested if requested in SUPPORTED else PROTOCOL_VERSION
            self.initialized = True
            return self._result(request_id, {
                "protocolVersion": self.version,
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": "guiaia-minecraft-readonly", "version": "0.1.0"},
                "instructions": "Read-only observations and planning. No game or server mutation tools are exposed.",
            })
        if not self.initialized:
            return self._error(request_id, -32000, "Initialize MCP before calling tools")
        if method == "ping":
            return self._result(request_id, {})
        if method == "tools/list":
            if params.get("cursor"):
                return self._error(request_id, -32602, "No pagination cursor expected")
            return self._result(request_id, {"tools": self.tools.list()})
        if method == "tools/call":
            name = params.get("name")
            if not isinstance(name, str):
                return self._error(request_id, -32602, "Tool name must be a string")
            try:
                output = self.tools.invoke(name, params.get("arguments", {}))
                return self._result(request_id, format_content(output))
            except (ToolError, ValueError, OSError, json.JSONDecodeError) as exc:
                # Errors are data, not stack traces; credentials and local paths must not leak.
                safe = str(exc) if isinstance(exc, ToolError) else "Observer unavailable or invalid snapshot"
                return self._result(request_id, format_content({"error": safe, "action_performed": False}, True))
        return self._error(request_id, -32601, "Method not found")

    @staticmethod
    def _result(request_id, result):
        return {"jsonrpc": "2.0", "id": request_id, "result": result}

    @staticmethod
    def _error(request_id, code, message):
        return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


def serve(server: MCP, input_stream=None, output_stream=None):
    inp = input_stream if input_stream is not None else sys.stdin
    out = output_stream if output_stream is not None else sys.stdout
    for line in inp:
        if len(line) > 1024 * 1024:
            continue
        try:
            item = json.loads(line)
            result = server.handle(item)
        except (ValueError, TypeError, UnicodeError):
            result = MCP._error(None, -32700, "Parse error")
        if result is not None:
            out.write(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n")
            out.flush()


def main(argv=None):
    cli = argparse.ArgumentParser(description="GuiaIA safe read-only MCP stdio gateway")
    source = cli.add_mutually_exclusive_group(required=True)
    source.add_argument("--snapshot", help="Absolute path to sanitized JSON metric snapshot")
    source.add_argument("--rcon-password-file", help="Local RCON credential file (never passed through MCP)")
    cli.add_argument("--rcon-port", type=int, default=25575)
    args = cli.parse_args(argv)
    try:
        observer = SnapshotObserver(args.snapshot) if args.snapshot else RconObserver(
            args.rcon_password_file, port=args.rcon_port
        )
    except ValueError as exc:
        cli.error(str(exc))
    serve(MCP(observer))


if __name__ == "__main__":
    main()
