"""Read-only Minecraft Java RCON access. Never accepts model-supplied commands."""
from __future__ import annotations
import os
import re
import socket
import stat
import struct
from pathlib import Path


class RconError(RuntimeError):
    pass


def _read_exact(sock: socket.socket, size: int) -> bytes:
    out = bytearray()
    while len(out) < size:
        part = sock.recv(size - len(out))
        if not part:
            raise RconError("RCON connection closed")
        out.extend(part)
    return bytes(out)


def _packet(sock: socket.socket, req_id: int, kind: int, content: str) -> None:
    body = struct.pack("<ii", req_id, kind) + content.encode("utf-8") + b"\x00\x00"
    if len(body) > 4096:
        raise RconError("RCON payload too large")
    sock.sendall(struct.pack("<i", len(body)) + body)


def _recv(sock: socket.socket) -> tuple[int, int, str]:
    (size,) = struct.unpack("<i", _read_exact(sock, 4))
    if not 10 <= size <= 65536:
        raise RconError("Invalid RCON response size")
    body = _read_exact(sock, size)
    req_id, kind = struct.unpack_from("<ii", body)
    return req_id, kind, body[8:-2].decode("utf-8", "replace")


class RconReadOnly:
    """Loopback-only by design; credentials read from file, never returned."""
    def __init__(self, password_file: str, port: int = 25575):
        self.password_file = Path(password_file).expanduser()
        if not self.password_file.is_absolute() or self.password_file.is_symlink() or not self.password_file.is_file():
            raise ValueError("RCON password file must exist at an absolute path")
        if not isinstance(port, int) or not (1 <= port <= 65535):
            raise ValueError("Invalid RCON port")
        self.port = port

    def _query(self, command: str) -> str:
        if command not in ("list", "time query gametime"):
            raise ValueError("Command denied by read-only allowlist")
        # Reopen with NOFOLLOW on every use, so a final symlink swapped in
        # after initialization cannot redirect credential reads to other files.
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
        try:
            fd = os.open(self.password_file, flags)
            with os.fdopen(fd, "rb") as file:
                meta = os.fstat(file.fileno())
                if not stat.S_ISREG(meta.st_mode) or meta.st_size > 512:
                    raise RconError("Invalid RCON credential file")
                raw_password = file.read(513)
                if len(raw_password) > 512:
                    raise RconError("Invalid RCON credential file")
            password = raw_password.decode("utf-8").strip()
        except (OSError, UnicodeError) as exc:
            raise RconError("RCON credential unavailable") from exc
        if not 1 <= len(password) <= 256:
            raise RconError("Invalid RCON password")
        try:
            with socket.create_connection(("127.0.0.1", self.port), timeout=2.0) as sock:
                sock.settimeout(3.0)
                _packet(sock, 1042, 3, password)
                auth_id, _, _ = _recv(sock)
                if auth_id != 1042:
                    raise RconError("RCON authentication rejected")
                _packet(sock, 1043, 2, command)
                reply_id, _, text = _recv(sock)
                if reply_id != 1043:
                    raise RconError("Unexpected RCON response")
                return text[:4096]
        except (OSError, struct.error) as exc:
            raise RconError("RCON connection or protocol error") from exc

    def status(self) -> dict:
        # Never expose player names, addresses, UUIDs or raw server messages.
        raw = self._query("list")
        count = re.search(r"(?:There are|Hay)\s+(\d+)\s+(?:of a max of|de un m[aá]ximo de)\s+(\d+)", raw, re.IGNORECASE)
        if not count:
            # Alternate vanilla "There are N of a max of M players online" is covered above.
            raise RconError("Cannot parse player count in current server locale")
        return {
            "source": "minecraft_java_rcon",
            "players_online": int(count.group(1)),
            "max_players": int(count.group(2)),
            "read_only": True,
            "nearby_entities_available": False,
            "vision_available": False,
        }

    def gametime(self) -> dict:
        raw = self._query("time query gametime")
        match = re.search(r"(-?\d+)\s*$", raw.strip())
        if not match:
            raise RconError("Cannot parse game time")
        return {"source": "minecraft_java_rcon", "game_ticks": int(match.group(1))}
