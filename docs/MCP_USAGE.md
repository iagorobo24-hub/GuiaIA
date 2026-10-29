# MCP local setup and verification

This implementation targets **MCP 2025-11-25 and 2025-06-18** over newline-delimited stdio. The newer 2026-07-28 stateless MCP version has not been tested and is not claimed as supported. MCP clients supporting backward compatibility can fall back to a supported version.

## One-shot smoke test

```sh
PYTHONPATH=src python3 - <<'PY'
import json, subprocess, sys
cmd = [sys.executable, "-m", "guiaia.mcp", "--snapshot", "examples/synthetic_world.json"]
requests = [
  {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}},
  {"jsonrpc":"2.0","method":"notifications/initialized"},
  {"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}},
  {"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"guia_diagnose","arguments":{}}},
]
result = subprocess.run(cmd, input="\n".join(map(json.dumps, requests))+"\n", text=True, capture_output=True, check=True)
assert not result.stderr, result.stderr
messages = [json.loads(x) for x in result.stdout.splitlines()]
assert [x["id"] for x in messages] == [1,2,3]
print("MCP stdio smoke passed:", len(messages[1]["result"]["tools"]), "tools")
PY
```

## Connecting a client

Use an MCP client's **stdio** configuration. Example (adjust every path and the client's config format):

```json
{
  "mcpServers": {
    "guiaia": {
      "command": "python3",
      "args": ["-m", "guiaia.mcp", "--snapshot", "/absolute/path/GuiaIA/examples/synthetic_world.json"],
      "env": {"PYTHONPATH": "/absolute/path/GuiaIA/src"}
    }
  }
}
```

The client starts this process locally. Each client invocation has the file-system privileges of the account executing it; stdio alone is not an authentication boundary. Never expose a public MCP bridge or elevated filesystem access.

## Real server

With an operator-owned Minecraft Java server, keep RCON bound to loopback. Configure its password in a protected local file and pass the file **path** on startup. Only two read-only commands are issued from code: `list` and `time query gametime`. Network socket destination is hardcoded to 127.0.0.1.

RCON reports online player counts, max players and game ticks. It does not prove the health of Cobblemon, show the visible scene or expose real TPS/MSPT through this adapter.

## Unsupported

- Arbitrary RCON or command execution.
- In-game movement, mining, crafting, attacking or placement.
- Reading player inventories, private chat, screenshots or unloaded chunks.
- Agent-driven code edits, deployments or world restoration.

These need independently reviewed adapters, explicit operator permissions and real QA.
