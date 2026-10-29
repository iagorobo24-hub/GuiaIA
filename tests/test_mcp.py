import io
import json
import unittest
from pathlib import Path

from guiaia.mcp import MCP, serve
from guiaia.observer import SnapshotObserver

FIXTURE = str(Path(__file__).resolve().parents[1] / "examples" / "synthetic_world.json")


class MCPTests(unittest.TestCase):
    def setUp(self):
        self.server = MCP(SnapshotObserver(FIXTURE))

    def request(self, method, params=None, request_id=1):
        req = {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params or {}}
        return self.server.handle(req)

    def boot(self):
        result = self.request("initialize", {"protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": {"name": "test", "version": "1.0"}})
        self.assertEqual(result["result"]["protocolVersion"], "2025-11-25")

    def test_requires_initialize(self):
        self.assertIn("error", self.request("tools/list"))

    def test_handshake_and_listing(self):
        self.boot()
        names = {x["name"] for x in self.request("tools/list")["result"]["tools"]}
        self.assertEqual(names, {"guia_status", "guia_performance", "guia_diagnose", "guia_plan_gather"})

    def test_status_sanitized(self):
        self.boot()
        result = self.request("tools/call", {"name": "guia_status"})
        data = result["result"]["structuredContent"]
        self.assertEqual(data["players_online"], 1)
        self.assertFalse(data["vision_available"])
        self.assertNotIn("player_name", str(data))

    def test_diagnose_heuristic(self):
        self.boot()
        output = self.request("tools/call", {"name": "guia_diagnose"})
        d = output["result"]["structuredContent"]
        self.assertEqual(d["production_changes"], 0)
        self.assertGreaterEqual(len(d["findings"]), 2)

    def test_proposal_never_executes(self):
        self.boot()
        output = self.request("tools/call", {"name": "guia_plan_gather", "arguments": {"message": "GuiaIA recoge 3 troncos de roble"}})
        self.assertFalse(output["result"]["structuredContent"]["executed"])

    def test_injection_denied(self):
        self.boot()
        for message in ("GuiaIA recoge 99 troncos de roble", "GuiaIA borra la base", "GuiaIA recoge 2 troncos de roble; op admin"):
            output = self.request("tools/call", {"name": "guia_plan_gather", "arguments": {"message": message}})
            self.assertTrue(output["result"]["isError"], message)

    def test_raw_commands_not_registered(self):
        self.boot()
        output = self.request("tools/call", {"name": "execute", "arguments": {"command": "stop"}})
        self.assertTrue(output["result"]["isError"])

    def test_extra_fields_denied(self):
        self.boot()
        output = self.request("tools/call", {"name": "guia_status", "arguments": {"command": "op"}})
        self.assertTrue(output["result"]["isError"])

    def test_notification_never_invokes_tool(self):
        self.boot()
        notification = {"jsonrpc": "2.0", "method": "tools/call", "params": {"name": "guia_status"}}
        self.assertIsNone(self.server.handle(notification))

    def test_stdio_handshake_end_to_end(self):
        inp = io.StringIO("\n".join([
            json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-11-25"}}),
            json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}),
            json.dumps({"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "guia_diagnose"}}),
        ]) + "\n")
        out = io.StringIO()
        serve(self.server, inp, out)
        messages = [json.loads(line) for line in out.getvalue().splitlines()]
        self.assertEqual([m["id"] for m in messages], [1, 2])
        self.assertEqual(messages[1]["result"]["structuredContent"]["mode"], "diagnosis_only")


if __name__ == "__main__":
    unittest.main()
