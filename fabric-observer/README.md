# GuiaIA World Observer — Fabric 1.21.1 (experimental QA)

**Do not install on production Teselia or any valued world.** This module is a standalone, opt-in, server-only mod prototype. It is not a gameplay bot and never modifies blocks, NBT or player inventories.

## Design

- Compatible target: Minecraft Java 1.21.1, Fabric loader 0.19.5, Fabric API 0.116.17+1.21.1, JDK 21.
- **Default OFF**: the module only activates if `config/guiaia-observer.properties` exists with `enabled=true`, a valid operator-selected center and dimension `minecraft:overworld`.
- Samples **one already-loaded chunk**, 16 block states at one configured Y, and up to 64 non-player entities in a 17-block-high band, no more frequently than every 200 server ticks.
- Never forces an unloaded chunk, enumerates all world entities or includes player identifiers/chat or absolute observation coordinates in output.
- Outputs a bounded local JSON snapshot to `config/guiaia-observer/snapshot.json`; uses temp file + atomic replacement to avoid partial reads.
- Intentionally no admin commands, RCON, socket listener, movement, inventory mutation or model calls.
- Aggregated MSPT is an indicative server tick-time sample; not a proof of TPS or root cause.

## Build (separate machine / isolated CI)

```sh
cd fabric-observer
gradle --no-daemon build
```

Use Gradle 8.10.2 and Java 21. The GitHub workflow `Fabric Observer Build (isolated)` builds it without modifying the private Minecraft project. The mod is *not* deployed by CI.

## Run in an expendable QA server only

1. Use a disposable **Minecraft 1.21.1 Fabric** server with pinned Fabric API. Never point it at a real world.
2. Place the **remapped** build JAR in the QA `mods/` folder.
3. Copy `observer.properties.example` to the QA server `config/guiaia-observer.properties`, set `enabled=true`, and configure `center_x`, `center_y`, `center_z` for a test chunk already loaded for unrelated gameplay.
4. Restart the **QA server** and inspect `config/guiaia-observer/snapshot.json`; if the chunk isn't loaded, it reports zero and never loads it.
5. In a local, same-user MCP client, launch the Python gateway with `--snapshot /absolute/path/config/guiaia-observer/snapshot.json`, then call `guia_world_observe`. Snapshots older than 120 seconds are rejected.

The snapshot is local. Keep directories private and never forward the raw file externally without review.

## Current evidence and gaps

- Python tests cover schema, privacy, stale samples, bounds, invalid keys, and fail-closed semantics.
- Java compilation must pass isolated GitHub CI before suggesting binary testing.
- **Not yet demonstrated** in a running Minecraft QA world. No real end-to-end Fabric-to-MCP world observation is claimed until that occurs.
- Any future wider observation must require explicit per-world access control, query quotas and server-thread budgets.

## Real Fabric JOIN/DISCONNECT evidence (separate opt-in QA entrypoint)

The same experimental Fabric JAR also contains the independently disabled GuiaIdentityBridge. It **never authenticates an offline username**. It records the actual Minecraft server networking handler's JOIN and DISCONNECT events, creates a fresh random UUIDv4 connection ID and challenge per login, and signs each event with Ed25519 using a locally supplied private PKCS#8 key. All evidence is local, bounded and permission-restricted. No player chat, admin commands or network port is exposed.

This bridge will only enable in a disposable directory under /tmp/guiaia-fabric-bridge-qa- with the exact QA configuration and a private key file with permission 0600. It is disabled for actual valued or production worlds by construction. The private key must **never** be committed, shared with an assistant or stored inside the bot. Verify the event records using an independently pinned public key, not a key learned from the event record itself.

[Real Fabric 1.21.1 QA proof](https://github.com/iagorobo24-hub/GuiaIA/actions/runs/40881777326) demonstrated two same-name offline connections with distinct signed IDs and challenges, valid disconnects, tampering denial, disabled-by-default behavior and stale-log clearing on restart. See [the bridge security report](../docs/COMPANION_REAL_FABRIC_CONNECTION_BRIDGE_QA_2026-10-29.md).

**Important:** the passive event file is not a trustworthy live-connection service under failure, and owner enrolment/ownership proof is not implemented. Do not deploy the bridge to Teselia or use it to authorize gameplay until the genuine session and owner-verification barrier is complete.
