# Getting Started with GuiaIA

GuiaIA is an independent, verifiable AI companion, world observer, and development assistant for Minecraft Java 1.21.1 / Fabric.

---

## 1. Prerequisites

- **Java**: JRE or JDK 21 (required by Minecraft 1.21.1 and Fabric Loader).
- **Node.js**: v22.0.0 or higher (v24 LTS recommended).
- **Python**: 3.11 or higher (3.12 recommended).
- **Minecraft Server**: Fabric 1.21.1 server launcher with:
  - Fabric Loader `0.19.5`
  - Fabric API `0.116.17+1.21.1`
  - `guiaia-world-observer-0.1.0-alpha.1.jar`

---

## 2. Installation & Setup

### Clone Repository
```bash
git clone https://github.com/iagorobo24-hub/GuiaIA.git
cd GuiaIA
```

### Install Companion Dependencies
```bash
cd companion
npm install
cd ..
```

### Configure Python Environment
The core MCP gateway and diagnostic tools rely on Python standard library modules with strict type validation:
```bash
# Set PYTHONPATH to include src and scripts
# On Windows PowerShell:
$env:PYTHONPATH = "src;scripts"

# On Linux / macOS:
export PYTHONPATH="src:scripts"
```

---

## 3. Running Unit & Integration Tests

### Companion Test Suite (305 Tests)
Runs complete unit tests covering Mineflayer navigation, inventory verification, signed journals, and the typed companion controller:
```bash
npm test --prefix companion
```

### Python MCP & Diagnostics Suite (54 Tests)
Runs JSON-RPC 2.0 handshake, tool schema validation, prompt-injection defense, and diagnostic sandbox tests:
```bash
python -m unittest discover -s tests -p "*.py"
```

---

## 4. Running the Diagnostic Sandbox

GuiaIA features an isolated diagnostic assistant that investigates performance degradation, excessive entities, or anomalous chunk state in a disposable staging server without touching production worlds.

### Simulated / Mock Mode (Fast Sanity Check)
```bash
python scripts/qa_diagnostic_sandbox.py --mock
```

### Real Disposable Fabric Sandbox
Spawns an isolated Fabric instance bound to loopback `127.0.0.1:25595`, reproduces an entity hotspot, performs structured MCP diagnosis, applies sandbox mitigation, and outputs verified before/after metrics:
```bash
python scripts/qa_diagnostic_sandbox.py \
  --launcher "/path/to/fabric-server-launcher.jar" \
  --fabric-api "/path/to/fabric-api.jar" \
  --mod "fabric-observer/build/libs/guiaia-world-observer-0.1.0-alpha.1.jar"
```

---

## 5. Running Real Multi-Resource Fabric QA

To verify full multi-resource gather, bounded approach, drop pickup, chest navigation, and dual-resource physical deposit in a disposable Minecraft world:
```bash
python scripts/qa_signed_delivery_real_server.py \
  --launcher "/path/to/fabric-server-launcher.jar" \
  --fabric-api "/path/to/fabric-api.jar" \
  --mod "fabric-observer/build/libs/guiaia-world-observer-0.1.0-alpha.1.jar" \
  --multi-resource
```

To test crash recovery during transfer (verifying no duplicate item creation and safe halt in `needs_review`):
```bash
python scripts/qa_signed_delivery_real_server.py \
  --launcher "/path/to/fabric-server-launcher.jar" \
  --fabric-api "/path/to/fabric-api.jar" \
  --mod "fabric-observer/build/libs/guiaia-world-observer-0.1.0-alpha.1.jar" \
  --crash-after-deposit
```

---

## 6. Architecture & Security Architecture

1. **Fail-Closed Isolation**: All disposable tests bind to `127.0.0.1` and run inside empty temporary directories. Access to directories with production names (`Teselia`, `production`) is strictly blocked.
2. **Cryptographic Attestations**: Actions require server-signed Ed25519 tokens from `GuiaIdentityBridge` and fresh live presence challenges.
3. **Emergency Stop**: The command `"¡Alto!"` / `"Stop"` halts all movement and tasks immediately with Priority 0, without requiring security nonces.
