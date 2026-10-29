import json
import socket
import struct
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from guiaia.observer import SnapshotObserver
from guiaia.rcon import RconReadOnly


class ObserverTests(unittest.TestCase):
    def test_filters_untrusted_sensitive_fields(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "snapshot.json"
            p.write_text(json.dumps({"players_online": 2, "name": "PRIVATE", "password": "SECRET", "mspt_avg": 52.0}))
            s = SnapshotObserver(str(p))
            self.assertNotIn("PRIVATE", json.dumps(s.status()))
            self.assertNotIn("SECRET", json.dumps(s.performance()))
            self.assertEqual(s.performance()["mspt_avg"], 52.0)

    def test_nonfinite_metrics_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "snapshot.json"
            p.write_text('{"mspt_avg": NaN}')
            with self.assertRaises(ValueError):
                SnapshotObserver(str(p)).performance()

    def test_boolean_metrics_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "snapshot.json"
            p.write_text('{"players_online": true}')
            with self.assertRaises(ValueError):
                SnapshotObserver(str(p)).status()

    def test_oversize_snapshot_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "snapshot.json"
            p.write_text('{"data": "' + "x" * 17000 + '"}')
            with self.assertRaises(ValueError):
                SnapshotObserver(str(p)).status()

    def test_rcon_raw_command_is_denied_even_locally(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "password"
            p.write_text("synthetic-password")
            r = RconReadOnly(str(p))
            with self.assertRaises(ValueError):
                r._query("op anyone")


class FakeSocket:
    def __init__(self, reply: str):
        self.requests = []
        self.pending = b""
        self.messages = []
        for req_id, kind, payload in ((1042, 2, ""), (1043, 0, reply)):
            body = struct.pack("<ii", req_id, kind) + payload.encode() + b"\x00\x00"
            self.messages.append(struct.pack("<i", len(body)) + body)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def settimeout(self, timeout):
        pass

    def sendall(self, data):
        self.requests.append(data)

    def recv(self, n):
        if not self.pending:
            if not self.messages:
                return b""
            self.pending = self.messages.pop(0)
        out, self.pending = self.pending[:n], self.pending[n:]
        return out


class RconTests(unittest.TestCase):
    def test_rcon_parses_counts_without_player_names(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "password"
            p.write_text("synthetic-password")
            sock = FakeSocket("There are 2 of a max of 4 players online: SecretPlayer, Other")
            with patch("socket.create_connection", return_value=sock) as conn:
                result = RconReadOnly(str(p)).status()
            self.assertEqual(result["players_online"], 2)
            self.assertNotIn("SecretPlayer", str(result))
            self.assertEqual(conn.call_args[0][0], ("127.0.0.1", 25575))
            self.assertEqual(len(sock.requests), 2)


if __name__ == "__main__":
    unittest.main()
