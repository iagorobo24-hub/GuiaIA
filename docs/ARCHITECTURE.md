# GuiaIA System Architecture

## Boundaries & Component Overview

```text
User / Operator / Chat UI / Agent
               |
               v
   Authenticated Tool Gateway (MCP stdio, protocol 2025-11-25)
               |
               +--- [Priority 0: Emergency Halt] ---> Immediate Bot Stop (No nonce required)
               |
               +--- [Companion Planner / Controller]
               |          |
               |          v (Strict Security Gate)
               |          * Ed25519 Session Attestation (Fabric Bridge)
               |          * Live Presence Challenge (HTTP 25594)
               |          * Time-bounded Single-Use Grant (10s expiry)
               |          * Independent Witness Checkpoint
               |          |
               |          v
               |    Mineflayer Bot Actions (Follow, Gather, Physical Chest Deposit)
               |
               +--- [World Observer]
               |          |
               |          v
               |    Fabric 1.21.1 Observer Mod (GuiaWorldObserver)
               |    * Bounded loaded chunk sampler (center_x, center_y, center_z)
               |    * Max 16 block types, max 64 entities
               |    * Privacy-safe: No player names, UUIDs, coordinates, or raw NBT
               |
               +--- [Developer Diagnostic Assistant & Sandbox]
                          |
                          v
                    Isolated Disposable Fabric Sandbox (qa_diagnostic_sandbox.py)
                    * Ephemeral temporary directories (guiaia-diagnostic-sandbox-*)
                    * Loopback only (127.0.0.1:25595)
                    * Guaranteed zero production mutation (production_changes: 0)
                    * Structured Before / After Comparative Metric Reports
```

---

## 1. Security Architecture & Trust Model

### A. Priority 0 Emergency Stop
When an emergency stop command is issued (`"¡Alto!"`, `"Stop"`, `"Detente"`), the controller intercepts it immediately:
- Does **not** require cryptographic grants, session nonces, or witness consensus.
- Immediately cancels Mineflayer pathfinding goals (`pathfinder.setGoal(null)`).
- Stops active mining / block digging (`bot.stopDigging()`).
- Halts following loops and marks active operations aborted.

### B. Two-Tier Zero-Trust State Execution
Before executing any state-changing world interaction (mining blocks, traversing terrain, depositing items into containers), the companion controller verifies:
1. **Server Session Bundle**: A valid, unexpired session signed with the server's Ed25519 private key.
2. **Fresh Live Presence**: Direct query to the Fabric server's live HTTP session query endpoint (port 25594) verifying the player is actively connected on the server thread.
3. **Single-Use Action Grant**: An Ed25519 grant issued specifically for the target block or region, expiring within 10 seconds.
4. **External Witness Ledger**: Submission of a checkpoint to a durable witness to detect and prevent replay attacks.

---

## 2. World Observer & Privacy Protection

The Fabric 1.21.1 World Observer (`GuiaWorldObserver.java`) is designed with strict resource budgets and privacy boundaries:
- **Sampling Interval**: Governed by `interval_ticks` (minimum 200 ticks = 10s).
- **Spatial Scope**: Exactly 1 loaded chunk, `y` band of 17 blocks (`center_y - 8` to `center_y + 8`).
- **Entity Cap**: Bounded at 64 non-player entities. Player identifiers and UUIDs are strictly stripped.
- **Atomic Persistence**: Writes atomically via temporary files with cross-platform fallback for POSIX and Windows NTFS permissions.

---

## 3. Developer Diagnostic Sandbox

The diagnostic assistant automates investigation of server degradation and mod behavior:
1. **Detection**: `guia_diagnose` evaluates MSPT budget (>50ms), TPS (<18), and entity accumulation/clustering.
2. **Reproduction in Sandbox**: Spawns a completely isolated disposable Fabric instance on loopback (`127.0.0.1:25595`) with flat test worlds.
3. **Production Guard**: `validate_sandbox_dir` prevents any path containing production markers (`Teselia`, `production`, `prod_server`) from being used.
4. **Remediation & Comparative Diff**: Applies candidate fixes (e.g. entity culling, bounding simulation) exclusively within the sandbox and outputs structured deltas (`mspt_avg_delta`, `entities_loaded_delta`).
