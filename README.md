# GuiaIA 🧭
### Your AI companion and world-engineering toolkit for Minecraft Java

**Early developer preview — v0.1.0.** GuiaIA is being developed as a Minecraft companion that can help you **play, understand, build and improve your world**. The public repository currently contains a small working foundation: a **read-only local MCP gateway**, a live Minecraft Java RCON status adapter, bounded mission proposals, an isolated performance snapshot analyzer and independent safety guards.

**The player-like companion, vision, in-world construction and autonomous coding agents are roadmap features, not capabilities in this release.** We prefer evidence over impressive-looking demos.

## Why GuiaIA?

- **Companion (planned):** follow players, gather materials, explore, remember adventures and help build.
- **World Observer (partially implemented):** provide trusted observations to an agent, not imaginary world knowledge.
- **Developer Agent (prototype):** investigate performance and propose safe tests and repairs in isolated QA environments.

The initial home for development is Minecraft Java 1.21.1 + Fabric, but the Python gateway is version-neutral and can read basic vanilla Minecraft RCON status. No server plugin or Fabric mod is installed by this repository.

## Try it today (no Minecraft server required)

Requires **Python 3.11+**. The core has no runtime dependencies.

```sh
git clone https://github.com/iagorobo24-hub/GuiaIA.git
cd GuiaIA
PYTHONPATH=src python3 -m guiaia.mcp --snapshot examples/synthetic_world.json
```

This starts a **stdio** MCP server, designed for an MCP-compatible local AI client. It does **not** start an HTTP server, create a bot player or call any paid model.

For a local MCP client, configure its program to `python3` and arguments to `-m guiaia.mcp --snapshot /absolute/path/to/examples/synthetic_world.json` with environment variable `PYTHONPATH=/absolute/path/to/GuiaIA/src`. Detailed examples are in [MCP usage](docs/MCP_USAGE.md).

Once connected, you can ask an agent to use these five tools:

| MCP tool | Working behavior |
| --- | --- |
| `guia_status` | Sanitized player count and game tick information |
| `guia_performance` | Read a trusted metric snapshot or explicitly report unavailable metrics |
| `guia_diagnose` | Propose a performance investigation without mutating anything |
| `guia_world_observe` | Read bounded, fresh Fabric world samples from an optional local observer; rejects unavailable or stale observations |
| `guia_plan_gather` | Validate a bounded Spanish gather request; **only propose**, never execute |

## Connect to a running Minecraft Java server (operator only)

Minecraft **RCON must already be enabled**, reachable only on loopback and secured with an existing password stored in a local file. Do **not** expose RCON to the internet.

```sh
PYTHONPATH=src python3 -m guiaia.mcp --rcon-password-file /absolute/private/path/rcon.secret --rcon-port 25575
```

Only `list` and `time query gametime` are allowed through the adapter, and the output omits usernames. Performance metrics and the nearby world view are not available from this RCON-only adapter. **Do not enter RCON passwords directly into an AI chat.** Do not install experimental plugins into an active multiplayer server.

## Development

```sh
PYTHONPATH=src python3 -m unittest discover -s tests -v
python3 -m compileall -q src tests
```

CI additionally installs and tests the package on Python 3.11, 3.12 and 3.13. Current test results are in [milestones](docs/ROADMAP.md).

## Optional Fabric observer (experimental, QA-only)

A separate [Fabric 1.21.1 World Observer prototype](fabric-observer/README.md) can capture aggregated samples from one already-loaded chunk, without exposing player identifiers. **Do not install it on the production server.** See [observer security/limits](docs/WORLD_OBSERVER.md). Java compilation and real in-world tests are separate release gates.

## Architecture and roadmap

The planned sequence is `observe → plan → policy/approval → execute in QA → verify → promote with authorization`.

See [architecture](docs/ARCHITECTURE.md), [roadmap](docs/ROADMAP.md), [security](SECURITY.md), [publication safeguards](docs/PUBLICATION_GATES.md) and [open-source research](docs/RESEARCH.md).

## Contribute

Suggestions, bug reports, tested integrations and discussions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md). The project is MIT-licensed (see [LICENSE](LICENSE)) and makes no claim of affiliation with Mojang, Microsoft or the Cobblemon team.
