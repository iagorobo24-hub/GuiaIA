"""Regression tests for fail-closed MCP and credential protection."""
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from guiaia.mcp import MCP, serve
from guiaia.rcon import RconError, RconReadOnly
from guiaia.tools import ToolRegistry


class NoLiveRcon:
    def status(self):
        raise RconError("secret-credential-and-private-server-path")

    def performance(self):
        return {"source": "test", "mspt_avg": None, "tps": None, "entities_loaded": None}


class StabilityTests(unittest.TestCase):
    def setUp(self):
        self.app = MCP(NoLiveRcon())

    def initialize(self):
        self.app.handle({"jsonrpc": "2.0", "id": 1,
                         "method": "initialize",
                         "params": {"protocolVersion": "2025-11-25"}})

    def test_rcon_failure_safe_tool_error_not_process_failure(self):
        self.initialize()
        result = self.app.handle({"jsonrpc": "2.0", "id": 3,
                                  "method": "tools/call",
                                  "params": {"name": "guia_status"}})
        self.assertTrue(result["result"]["isError"])
        self.assertFalse(result["result"]["structuredContent"]["action_performed"])
        self.assertNotIn("secret-credential", json.dumps(result))
        self.assertNotIn("private-server-path", json.dumps(result))

    def test_server_continues_after_failed_tool(self):
        self.initialize()
        requests = [
            {"jsonrpc": "2.0", "id": 3, "method": "tools/call",
             "params": {"name": "guia_status"}},
            {"jsonrpc": "2.0", "id": 4, "method": "ping"},
            {"jsonrpc": "2.0", "id": 5, "method": "tools/list"},
        ]
        output = io.StringIO()
        serve(self.app, io.StringIO("\n".join(map(json.dumps, requests)) + "\n"), output)
        messages = [json.loads(s) for s in output.getvalue().splitlines()]
        self.assertEqual([x["id"] for x in messages], [3, 4, 5])
        self.assertTrue(messages[0]["result"]["isError"])
        self.assertEqual(messages[1]["result"], {})
        self.assertGreaterEqual(len(messages[2]["result"]["tools"]), 5)

    def test_invalid_ids_not_reflected(self):
        for bad in (True, False, [], {}, 1.2, "a" * 129):
            response = self.app.handle({"jsonrpc": "2.0", "id": bad,
                                        "method": "ping"})
            self.assertEqual(response["error"]["code"], -32600)
            self.assertIsNone(response["id"])

    def test_reinitialize_rejected(self):
        self.initialize()
        response = self.app.handle({"jsonrpc": "2.0", "id": 4, "method": "initialize",
                                    "params": {"protocolVersion": "2025-06-18"}})
        self.assertEqual(response["error"]["code"], -32600)

    def test_credential_symlink_denied(self):
        with tempfile.TemporaryDirectory() as d:
            actual = Path(d) / "real"
            actual.write_text("synthetic-not-real")
            link = Path(d) / "alias"
            link.symlink_to(actual)
            with self.assertRaises(ValueError):
                RconReadOnly(str(link))


if __name__ == "__main__":
    unittest.main()
