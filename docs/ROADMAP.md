# GuiaIA Roadmap and Real Completion Status

> **Updated:** November 3, 2026  
> **Status:** V1.0.0 and V1.1.0 Officially Completed & Verified  

---

## 1. Master Milestone Tracking

| Stage | Milestone / Deliverable | Status / Taxonomic Evidence |
| :---: | :--- | :--- |
| **0** | **Baseline & Separation**<br>Clean separation from private worlds/secrets, cross-platform base. | **COMPLETED & VERIFIED:** Isolated public repository, verified git lineage, cross-platform Windows NTFS / Linux POSIX support. |
| **1** | **Developer Preview (v0.1.0)**<br>Independent Python package, MCP stdio gateway, security guards. | **COMPLETED & VERIFIED:** Read-only MCP (protocol 2025-11-25), prompt-injection guards, 54/54 Python unit tests PASS. |
| **2** | **World Observer**<br>Authoritative Fabric 1.21.1 chunk/entity/event snapshot, bounded budget. | **COMPLETED & VERIFIED:** Official Fabric mod (`GuiaWorldObserver.java`), 1-chunk boundary, max 16 block types, max 64 entities, atomic writes. |
| **3** | **Agent Tools (MCP Suite)**<br>Local MCP, typed schemas, policy enforcement, zero production mutation. | **COMPLETED & VERIFIED:** 5 tools (`guia_status`, `guia_performance`, `guia_diagnose`, `guia_world_observe`, `guia_plan_gather`), fail-closed validation. |
| **4** | **Companion Core V1.0.0**<br>Follow, P0 stop, multi-resource gather and physical chest deposit in Fabric. | **COMPLETED & VERIFIED:** Real Fabric 1.21.1 4-step mission PASS (`oak_log` + `birch_log` gather/deposit), crash recovery with no dupes PASS, Ed25519 identity bridge PASS, typed natural language controller PASS (205 security tests PASS). |
| **5** | **Companion V1.1.0: Advanced Mechanics & Cobblemon**<br>Chained DAG crafting, blueprint construction, Cobblemon 1.8.2 protocol, Web Dashboard, and real disposable lab. | **COMPLETED & VERIFIED:** Real Fabric 1.21.1 + Cobblemon 1.8.2 disposable lab on Durán (`scripts/qa_v1_1_real_minecraft_server.py`) with 7/7 in-game missions PASS. Full technical audit: 477/477 tests PASS, forensic verdict `CLEAN`, `VICTORY CONFIRMED`. |
| **6** | **Companion V1.2.0: Vision & Multi-Agent**<br>Authorized client screenshot capture, bounding box visual grounding, and multi-bot collaboration. | **PLANNED:** Exploration underway. |
| **7** | **Multiplayer Public Beta**<br>One-click installers, managed authentication, and open multiplayer community servers. | **PLANNED:** Following V1.2 release. |

---

## 2. V1.1.0 Acceptance & Verification Criteria (Completed)

- [x] **Chained Tool Crafting DAG Engine (`crafting_planner.js`):**
  - Recursive multi-tier recipe resolution (`oak_log` $\rightarrow$ `oak_planks` $\rightarrow$ `stick` $\rightarrow$ `crafting_table` $\rightarrow$ `wooden_pickaxe`).
  - 3x3 table lifecycle management (placement, interaction, inventory deltas, and recovery).
  - Material validation fail-closed (`insufficient_materials`) and step-count limits.
- [x] **Blueprint Structure Placement Engine (`blueprint_builder.js`):**
  - Construction from NBT and JSON schematic formats.
  - Spatial collision preflight to prevent trapping players or bots.
  - Gravity validation fail-closed (`gravity_unsupported`) for sand, gravel, and unsupported falling blocks.
  - WAL journal with SHA-256 and `fsync` for crash-recovery without block duplication.
- [x] **Authentic Cobblemon 1.8.2 Protocol Engine:**
  - Minecraft 1.21.1 `DataComponentTypes` sanitization for packet `0x15` (`set_slot`), preventing `node-minecraft-protocol` deserializer crashes.
  - Radar entity DataTracker inspection, verified strictly against `/data get entity` NBT on server.
  - Poké Ball captures with consumable tracking, Brigadier party slot verification, and negative ACK loss safety without blind re-throws.
  - Wild battles with polymorphic move dispatch and P0 emergency halt via canonical `stopbattle`.
  - PC box storage deposit/withdrawal verified with persistent JSON player data in `world/cobblemonplayerdata/`.
- [x] **Web Telemetry Dashboard (`web/server.js`):**
  - Real-time bot status, 2D radar, coordinates, inventory viewer, and P0 stop button.
  - Ephemeral 6-digit PIN pairing with `crypto.timingSafeEqual` and permanent lockout after 3 failed attempts.
- [x] **Autonomous Real Disposable Minecraft Laboratory (`scripts/qa_v1_1_real_minecraft_server.py`):**
  - Self-provisioned Adoptium Temurin JRE 21, Fabric Loader 0.16.9, Fabric API, and Cobblemon 1.8.2.
  - All 7 real in-game missions (Missions A–G) executed and verified with exit code 0 (`PASS REAL MINECRAFT`).
- [x] **Comprehensive Technical Audit & Remediation:**
  - 17 findings identified, remediated fail-closed, and certified.
  - 82 adversarial stress scenarios passed without failure.
  - Independent forensic auditor verdict: **`CLEAN`** (0 cheats, 0 mocks in production, 100% genuine state checks).
  - Formal victory audit: **`VICTORY CONFIRMED`**.

---

## 3. Future Roadmap: V1.2.0 and Beyond

### V1.2.0: Vision-Grounded Perception & Multi-Bot Collaboration
- [ ] **Authorized Client-Side Screenshots:** Opt-in screenshot capture pipeline with provenance verification and privacy redaction.
- [ ] **Visual Grounding:** Multimodal models processing in-game visual perspectives for complex spatial tasks (e.g. decorating, terraforming).
- [ ] **Multi-Bot Swarm Coordination:** Cooperative gathering and building missions where multiple GuiaIA bots divide labor via distributed task graphs.

### V1.3.0: Public Multiplayer Beta & Packaging
- [ ] Cross-platform desktop installer (Windows, macOS, Linux).
- [ ] Official Microsoft online-mode authentication flow with parental consent guards.
- [ ] Discord / Webhook integration for companion alerts and world events.
