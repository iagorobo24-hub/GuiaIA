# GuiaIA — Verified Capabilities & Evidentiary Catalog

This document records the concrete, verified capabilities of GuiaIA against real Minecraft Java 1.21.1 / Fabric disposable testbeds, Node.js companion pipelines, and Python MCP diagnostic modules.

---

## 1. Multi-Resource Gather & Deposit Pipeline (Fabric 1.21.1 Real Server)

GuiaIA coordinates multi-step resource acquisition and physical storage in Minecraft worlds under strict cryptographic and durable journal supervision.

### Validated Flow
1. **Gather Step 1**: Locate and fell an oak log block at `(7, 64, 2)`.
2. **Pickup 1**: Approach drop location with `desiredDistance: 0` (`GoalNear(x, y, z, 0)`), ensuring the bot physically occupies the mined cavity. Verify bot inventory receives `minecraft:oak_log`.
3. **Gather Step 2**: Fell a birch log block at `(7, 64, 3)`.
4. **Pickup 2**: Retrieve dropped birch log into bot inventory.
5. **Navigate to Chest**: Pathfind to physical chest at `(4, 64, 3)`.
6. **Deposit 1 & 2**: Sequentially open container window and deposit exactly 1 oak log and 1 birch log.
7. **Monotonic Audit**: Record 4 sequential, ordered journal receipts (`gather`, `gather`, `deposit`, `deposit`).
8. **Crash & In-Flight Interruption Recovery**: In crash test mode (`--crash-after-deposit`), the client is killed immediately after deposit. Upon restart into the same world, inventory and chest verification proves no items were duplicated, and the journal is safely halted in `needs_review`.

### Verification Commands & Exit Codes
- Full Multi-Resource: `python scripts/qa_signed_delivery_real_server.py --multi-resource` -> **EXIT CODE 0**
  - Emits: `GUIAIA_REAL_SIGNED_MULTI_DELIVERY_QA_EVIDENCE={"result":"pass", "gather_receipts":2, "deposit_receipts":2, "ordered_operations":["gather","gather","deposit","deposit"], "physical_chest":{"birch_log":1,"oak_log":1}}`
- Crash Recovery: `python scripts/qa_signed_delivery_real_server.py --crash-after-deposit` -> **EXIT CODE 0** (exit 77 clean review)
- Single Delivery: `python scripts/qa_signed_delivery_real_server.py` -> **EXIT CODE 0**

---

## 2. Cryptographic Identity & Real Fabric Attestation Bridge

On offline/LAN servers, player usernames and UUIDs are spoofable. GuiaIA enforces server-side Ed25519 asymmetric attestation via an official Fabric 1.21.1 mod (`GuiaIdentityBridge.java`).

### 6 Proven Security Properties (`scripts/qa_fabric_identity_bridge.py` -> EXIT CODE 0)
1. **Anti-Collision**: Two successive logins with the same player name obtain distinct session IDs and cryptographic challenges (`GUIAIA_REAL_BRIDGE_CLIENTS_QA_EVIDENCE`).
2. **Signed Server Events**: All `JOIN` and `DISCONNECT` events are signed with the server's PKCS#8 Ed25519 key (`GUIAIA_REAL_FABRIC_BRIDGE_QA_EVIDENCE`).
3. **Reboot Integrity**: Previous session journal files are deleted on server boot to prevent replay of stale attestation (`GUIAIA_REAL_BRIDGE_RESTART_QA_EVIDENCE`).
4. **Live Presence Verification**: Actions require real-time challenge-response queries to the server's live HTTP presence endpoint on port 25594 (`GUIAIA_REAL_SIGNED_DELIVERY_QA_EVIDENCE`).
5. **In-Flight Revocation Gate**: Disconnecting or revoking a player session immediately aborts active companion movement and delivery (`GUIAIA_REAL_SERVER_SESSION_GATE_QA_EVIDENCE`).
6. **Crash Fail-Closed**: An abrupt SIGKILL of the server leaves join events on disk, but live presence queries fail closed, preventing unauthorized offline operation (`GUIAIA_REAL_LIVE_PRESENCE_CRASH_QA_EVIDENCE`).

---

## 3. Secure Companion Controller & Natural Language Parser

Located in `companion/src/secure_companion_controller.js`, the companion controller acts as the central security and task orchestrator.

### Core Capabilities
- **Typed Intent Parser**: Translates natural language messages into typed contracts:
  - Emergency Halt (`"¡Alto!"`, `"Stop"`, `"Detente"`).
  - Follow (`"Guia IA, sígueme"`, `"Follow me"`).
  - Gather (`"Recoge 2 troncos de roble"`).
  - Deposit (`"Deposita los troncos en el cofre"`).
  - Inventory Query (`"Inventario"`).
- **Absolute Emergency Stop Priority**: Emergency halt requires no nonces or session grants and instantly interrupts pathfinding, mining, and interaction loops.
- **Zero-Trust Security Gate**: Before executing any movement or block alteration, the controller validates:
  - Cryptographic session bundle (`verifySessionBundle`).
  - Active live server presence (`verifyLivePresence`).
  - Single-use, time-bounded grant (`verifySessionFollowGrant` / `verifySessionActionGrant`).
  - Witness checkpoint attestation (`submitWitnessCheckpoint`).
- **Inventory Safety**: Hard cap of 36 inventory slots and rejection of untracked or hazardous items.

### Test Suite Status
- Companion Suite: **305/305 PASS** (`npm test --prefix companion`).

---

## 4. Passive Diagnostic Assistant & Sandbox Isolation

GuiaIA provides an automated development and diagnostics workflow that identifies anomalies and tests solutions in disposable staging environments without ever touching production worlds.

### Core Capabilities
- **Read-Only Telemetry**: `guia_diagnose` MCP tool inspects server MSPT, TPS, entity counts, and observer chunk snapshots.
- **Anomaly Detection**: Flags ticks exceeding 50 ms budget, TPS drops below 18, high entity counts (>300), and chunk entity clustering caps (64 entities).
- **Strict Sandbox Isolation**:
  - `validate_sandbox_dir` blocks paths with production markers (`Teselia`, `production`, `prod_server`).
  - `generate_sandbox_server_properties` binds strictly to `127.0.0.1` on loopback.
  - Guarantees zero production mutations (`production_changes: 0`, `production_modified: false`).
- **Comparative Before/After Reports**:
  - Reproduces anomaly in disposable test environment.
  - Takes diagnostic baseline.
  - Applies remediation strictly inside the sandbox.
  - Takes post-mitigation snapshot and computes metrics delta (`mspt_avg_delta`, `entities_loaded_delta`).
  - Emits verifiable evidence: `GUIAIA_DIAGNOSTIC_SANDBOX_QA_EVIDENCE`.

### Test Suite Status
- Unit Tests: `tests/test_diagnostic_sandbox.py` (PASS).
- Python MCP Suite: **54/54 PASS** (`python -m unittest discover -s tests -p "*.py"`).
