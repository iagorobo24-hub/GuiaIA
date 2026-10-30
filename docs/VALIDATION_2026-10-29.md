# GuiaIA Phase 1 + Phase 2 validation record — 2026-10-29

## Scope and isolation

Public repository: `iagorobo24-hub/GuiaIA`. Work branch: `feature/stabilize-and-fabric-qa`.

**Production Teselia is not part of this test.** Another development session is working on Teselia. All new code, tests and commits in this phase belong solely to the independent public GuiaIA repository. The Fabric integration test executes on a disposable **GitHub Actions Ubuntu runner**. Its synthetic Minecraft world is deleted automatically by the runner when the test ends. Minecraft binds to `127.0.0.1:25596`, RCON is disabled and no external user can connect.

No production mod was installed; no game-world or production service was restarted, no private credentials/world coordinates were imported and no Minecraft production code was edited.

## Phase 1 — Python gateway hardening

Verified changes:

- MCP tools now catch the explicit `RconError` exception and return a sanitized tool-level error rather than leaking a stack trace or interrupting the MCP request stream.
- JSON-RPC rejects boolean, floating, structured or abnormally long request IDs; duplicate initialization is denied.
- The operator-selected RCON password path rejects symlinks at setup.
- Added five regression tests for safe RCON errors, continued protocol operation, bad IDs, duplicate initialization and symlink credential paths.

Python regression suite: **44 tests passed locally** (vs. 39 beforehand). GitHub Actions Python matrix 3.11, 3.12 and 3.13 also passed on branch commit `f9d31ef`, [run 40832434033](https://github.com/iagorobo24-hub/GuiaIA/actions/runs/40832434033).

Important boundaries: This is a **read-only developer preview**, not a formally MCP-certified implementation nor a security review suitable for operating against arbitrary untrusted servers. No autonomous mining, world edits or agent deployment are implemented.

## Phase 2 — Fabric 1.21.1 real-server QA

The first run `40831199616` loaded Minecraft 1.21.1, Fabric 0.19.5, Fabric API 0.116.17+1.21.1 and the observer; the QA test failed to see the newly spawned sheep. A second run with added evidence `40831672506` proved the observer emitted a real chunk snapshot with `blocks_sampled=16`, `chunks_loaded=1` and `minecraft:diamond_block=1`; entity count was zero because the sheep had spawned in mid-air in a superflat world, outside the observation band after falling.

The third run **`40832042688` PASSED**, with:
- Explicitly disabled by default, with no initial snapshot;
- Opt-in Fabric callback active on an actual disposable Minecraft Java 1.21.1 server;
- One already-loaded chunk observed, `blocks_sampled=16`;
- One test diamond block present in `block_counts`;
- One test sheep present in `entity_counts`;
- `mspt_avg=0.72` reported for one low-load sample, **not** a benchmark or production performance guarantee;
- Valid JSON parsed with the strict Python schema checker and no player identifiers present.

Link: https://github.com/iagorobo24-hub/GuiaIA/actions/runs/40832042688

The extended integration run **`40832434066` PASSED** on branch commit `f9d31ef`:

- The real server-generated JSON was served by the actual MCP `tools/call` for `guia_world_observe`, preserving its real registry counts;
- A distant chunk that was never loaded returned `chunks_loaded=0`, `blocks_sampled=0` and `entities_loaded=0`, demonstrating that this read-only observer did not force-load it;
- The mod still started disabled without a configuration and loaded only after explicit opt-in;
- Real test block and sheep still observed correctly; `mspt_avg=0.47` in a low-load QA snapshot (not an overhead benchmark);
- The temporary Minecraft server was bound to `127.0.0.1` with RCON disabled and the QA world was disposable.

Evidence: https://github.com/iagorobo24-hub/GuiaIA/actions/runs/40832434066

This validates the **bounded real-world observation and MCP read path** for one disposable Minecraft Java 1.21.1 + Fabric test environment. It does **not** validate high-density load, production security hardening or full Minecraft gameplay autonomy.

## Outstanding gates before production readiness

- Repeated real-world QA on multiple versions/mod combinations, especially target modpacks;
- Loaded-chunk/large-entity-count benchmark and bounded server-tick overhead measurement with a matched baseline;
- Dedicated security review of the snapshot file boundary, races, local filesystem permissions and invalid configuration;
- Independent integration testing by a different developer/host, including reproducible installation;
- No release/push to a production Minecraft server without backups, explicit authorization and a stable Teselia baseline.

**Verdict:** a functional experimental Fabric observer has been proven in a disposable Minecraft 1.21.1 server. This is not yet authorization to install it in Teselia or call the general-purpose agent ready for gameplay.
