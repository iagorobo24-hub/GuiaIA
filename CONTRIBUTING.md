# Contributing to GuiaIA

Welcome to the **GuiaIA** open-source project! We are building an authentic, verified AI companion for Minecraft Java 1.21.1 and Fabric / Cobblemon.

We welcome bug reports, feature requests, code contributions, and architectural improvements. To maintain the safety, integrity, and cryptographic rigor of the project, please review these guidelines before submitting a pull request.

---

## 1. Core Principles & Philosophy

Every contribution to GuiaIA must adhere to these foundational engineering standards:

1. **Zero-Trust & Fail-Closed Architecture:**
   - Any state-changing action in the game world must be verifiable.
   - If a cryptographic signature is missing, a network packet is lost, or a state file is corrupted, the system must **fail closed** (halt safely, block mutations, log the event), never fail open or proceed on assumptions.
2. **Honest Test Taxonomy:**
   - Never classify a simulated or mock test as a "Real Minecraft" test.
   - If a test uses in-memory maps or mocks, label it `PASS SIMULADO`.
   - Only tests that interact with live Minecraft server sockets, real block physics, and authentic NBT packets may be labeled `PASS REAL MINECRAFT`.
3. **No Synthetic Success:**
   - A bot must never report that an item was mined, crafted, deposited, or captured without verifying the physical delta in inventory or world state.
4. **Data Privacy & World Protection:**
   - Do not commit world saves, private server configs, player UUIDs, session secrets, or RCON passwords.
   - The bot must never destroy or modify player structures without explicit schematic boundaries and preflight verification.

---

## 2. Environment Setup

### Prerequisites
- **Node.js:** v20.x or v22.x LTS
- **Python:** 3.11 or newer
- **Java:** Adoptium Temurin OpenJDK 21 (JRE 21.0.13+9 or newer)
- **Git:** Standard git client

### Installation
Clone the repository and install the dependencies:

```bash
git clone https://github.com/iagorobo24-hub/GuiaIA.git
cd GuiaIA

# Install Companion (Node.js) dependencies
cd companion
npm ci
cd ..

# (Optional) Set up Python virtual environment for MCP / World Observer
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\Activate.ps1
pip install -e .
```

---

## 3. Running the Verification Test Suites

Before opening a pull request, all existing test suites must pass cleanly without skipping or weakening existing security assertions.

### 3.1 Security & Cryptographic Battery (205 tests)
Validates Ed25519 signatures, session tokens, replay prevention, timingSafeEqual PIN pairing, and crash recovery:

```bash
cd companion
npm run test:security
```

### 3.2 Product & Mechanics Battery (165 tests)
Validates DAG crafting planning, blueprint construction, Cobblemon adapters, and local witness synchronization:

```bash
cd companion
npm run test:product
```

### 3.3 Acceptance QA Matrix
Runs the full 4-tier acceptance matrix:

```bash
cd companion
node --test test/v1_1_product_qa_matrix.test.js
```

### 3.4 Real Minecraft Laboratory (E2E in Fabric 1.21.1)
Runs the self-contained disposable server that verifies the 7 in-game missions (crafting, mining, blueprint placement, Cobblemon radar, capture, battle, and PC storage):

```bash
# From repository root:
python scripts/qa_v1_1_real_minecraft_server.py
```

---

## 4. Mandatory Safety & Process Rules

When working in this codebase, the following safety constraints are strictly mandatory:

> [!CAUTION]
> **Prohibited Process Commands:**
> Never execute broad process-killing commands like `taskkill /IM` (e.g. `taskkill /IM node.exe`) or title filters (`taskkill /FI "WINDOWTITLE..."`).
> If a server port is occupied, find the specific PID with `netstat -ano | findstr :<port>` and terminate only that specific PID with `taskkill /PID <pid>`.

> [!WARNING]
> **Isolated Hardware Boundary:**
> Under no circumstances may code connect to, interact with, or attempt to communicate with external isolated test hardware (such as Chromebook Teselia). Any test requiring multi-host infrastructure must be tagged as manual or isolated.

---

## 5. Development Guidelines & Conventions

### Coding Standards
- **JavaScript / Node.js:** Standard JavaScript (ES2022+), no compilation step required for companion modules. Use descriptive naming and strict invariant checks.
- **Crypto & Secrets:** Always use the Node.js built-in `crypto` module. Use `crypto.timingSafeEqual` for sensitive token/PIN comparisons.
- **File System Persistence:** State-changing file operations must use atomic write patterns (`write to temp` $\rightarrow$ `fsync` $\rightarrow$ `rename` $\rightarrow$ `directory fsync`).
- **Git Commit Messages:** Follow the [Conventional Commits](https://www.conventionalcommits.org/) format:
  - `feat(...)`: A new feature or capability.
  - `fix(...)`: A bug fix or fail-closed hardening.
  - `test(...)`: Adding or updating test suites.
  - `docs(...)`: Documentation updates.
  - `chore(...)`: Routine maintenance tasks.

---

## 6. How to Submit a Pull Request

1. Fork the repository and create a feature branch (`git checkout -b feat/my-new-feature`).
2. Implement your changes following the architectural principles and coding standards.
3. Add corresponding unit and integration tests under `companion/test/`.
4. Ensure all test batteries pass (`npm run test:security` and `npm run test:product`).
5. Commit your changes with clear conventional commit messages.
6. Push to your fork and submit a Pull Request to the `main` branch.
7. Include a clear description of the problem solved, architectural implications, and verification evidence.

Thank you for helping make GuiaIA the most reliable and secure AI companion for Minecraft!
