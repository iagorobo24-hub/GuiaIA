# GuiaIA Roadmap and Real Completion Status

Updated: 2026-11-02

| Stage | Deliverable | Status / evidence |
| --- | --- | --- |
| 0. Baseline & separation | Clean separation from Teselia private worlds/secrets, cross-platform base | **COMPLETED & VERIFIED:** Isolated public repository, verified git lineage, cross-platform Windows NTFS / Linux POSIX support. |
| 1. Public developer preview | Independent Python package, MCP stdio gateway, security guards | **COMPLETED & VERIFIED:** Read-only MCP (protocol 2025-11-25), prompt-injection guards, 54/54 Python unit tests PASS. |
| 2. World Observer | Authoritative Fabric 1.21.1 chunk/entity/event snapshot, bounded budget | **COMPLETED & VERIFIED:** Official Fabric mod (`GuiaWorldObserver.java`), 1-chunk boundary, max 16 block types, max 64 entities, atomic writes. |
| 3. Agent tools | Local MCP, typed schemas, audit/policy, permissions | **COMPLETED & VERIFIED:** 5 tools (`guia_status`, `guia_performance`, `guia_diagnose`, `guia_world_observe`, `guia_plan_gather`), fail-closed validation. |
| 4. Companion MVP | Follow, stop, multi-resource gather and physical chest deposit in Fabric | **COMPLETED & VERIFIED:** Real Fabric 1.21.1 4-step mission PASS (`oak_log` + `birch_log` gather/deposit), crash recovery with no dupes PASS, Ed25519 identity bridge PASS, typed natural language controller PASS (305/305 tests). |
| 5. Developer Agent MVP | Diagnose anomaly; isolated disposable sandbox, verify result & comparative report | **COMPLETED & VERIFIED:** Structured diagnosis, disposable loopback sandbox runner (`qa_diagnostic_sandbox.py`), verified entity culling and MSPT reduction without touching production. |
| 6. Vision | Real screenshots from authorized client | **PLANNED:** Authorized client-side capture pipeline. |
| 7. Public stable release | Reproducible install, cross-platform verification, documentation | **IN PROGRESS:** Verified capabilities catalog and getting started guide documented. |

---

## v0.1.0 Criteria (Developer Preview)

- [x] Independent public-source implementation without reusing private world files
- [x] Fixed read-only RCON command allowlist and loopback transport
- [x] MCP stdio supports initialize, tools/list, tools/call in 2025-11 protocol family
- [x] Validated metric snapshots and bounded Spanish gather plan proposals
- [x] Tests for sanitization, prompt injection, policy denial, read-only semantics
- [x] Real live RCON read of Penguin Minecraft status, without in-game mutation
- [x] MCP subprocess smoke integration
- [x] Cross-platform general execution and basic filesystem tests;
      security-sensitive native Windows secret-file entrypoints fail closed
      pending independently verified NTFS ACL handling
- [x] Multi-resource 4-step mission in real Fabric 1.21.1 (`--multi-resource` PASS)
- [x] Safe interruption and crash recovery without item duplication (`--crash-after-deposit` PASS)
- [x] Ed25519 signed session identity bridge and live presence server (`qa_fabric_identity_bridge.py` PASS)
- [x] Priority 0 emergency halt without security nonces
- [x] Disposable diagnostic sandbox with structured comparative reports (`qa_diagnostic_sandbox.py` PASS)
- [x] Public documentation: `GETTING_STARTED.md` and `VERIFIED_CAPABILITIES.md`
- [x] Disposable **local** Git-archive clean checkout on Chromebook: new
      npm ci --offline --ignore-scripts, Node and Python full regression,
      missing-owner CLI denial; no production world changes (2026-11-02)
- [x] Another physical machine clean install: Chromebook git archive SHA-256
      verified on Durán; npm ci on Windows and Ubuntu WSL2, Node 362/364
      Windows (2 PTY-only skipped), 364/364 WSL2 and Python 58/58 on both;
      Windows native private-key commands explicitly fail closed until NTFS
      ACL validation exists (2026-11-02)
- [x] Isolated QA integration: separately enrolled owner + live signed Fabric
      presence + checkpoint witness + signed journal runtime + terminal operator
      (library simulation and standalone TCP/HTTP preflight verified)
- [x] Real Fabric 1.21.1 standalone --qa-operate end-to-end (QA):
      externally prepared synthetic Ed25519 signers, TTY, signed grants,
      real oak gather and chest deposit, 2 durable receipts, 2 spent nonces,
      physical second-client verification; exit 0 (2026-10-30)
- [x] Real Fabric QA: Ed25519 principal revoked after durable mission;
      independent preflight process denies with exit 2, signed checkpoint
      advances to sequence 2 and inventory/journals remain unchanged
      (2026-10-30; synthetic offline identity and localhost witness)
- [x] In-process mid-mission revocation: Ed25519 enrolled principal revoked
      during chest opening or gather navigation; fresh signed presence and
      witness checked before transfer/dig, with no unauthorized world action
      (isolated runtime QA, 2026-10-30)
- [x] Independently signed QA revocation while running operator owns exclusive
      registry lock; real Fabric 1.21.1 interrupted after physical gather,
      before deposit: 1 gather receipt, 0 deposit receipts, 0 chest stock,
      1 spent nonce, durable cancellation, signed witness sequence 2,
      denied next step and clean TTY exit (2026-10-31)
- [x] Standalone Ed25519 witness CLI in a separate local process: signed CAS,
      independent private credential files, restart persistence, deny on
      invalid/stale state, and full Fabric 1.21.1 standalone operator QA PASS
      with physical deposit and subsequent revocation (2026-10-31)
- [x] Offline-only SSH transport preflight: pinned host-key fingerprint,
      Ed25519 identity, exact host/port and strict local-forward arguments;
      5 negative/positive QA tests without network use (2026-11-02)
- [x] Independent QA witness on Durán WSL2 and operator on Chromebook:
      Tailscale Serve HTTPS + userspace tailscale nc, verified TLS certificate,
      Ed25519 pinned remote signer, signed checkpoint CAS sequence 0 -> 1,
      forged/replay/rollback denial, disconnect fail-closed and signed recovery;
      no public endpoint and no real Minecraft session (2026-11-02)
- [x] Local QA witness/remote client absolute HTTP deadlines of 1500 ms:
      slow-trickle attacks bounded, 14/14 focused, Node 366/366 and Python
      58/58 PASS; no live cross-host Minecraft rerun (2026-11-02)
- [x] Real disposable Fabric 1.21.1 witness-outage test: physical gather,
      independent witness shutdown before deposit, zero chest transfer,
      no journal/nonce mutation, durable cancellation and signed witness
      restart with independent preflight; offline identities, same Chromebook
      (2026-11-02; see QA_REAL_FABRIC_WITNESS_OUTAGE_2026-11-02.md)
- [x] Physical two-host QA witness process restart (Durán WSL2, Chromebook):
      verified HTTPS/TLS, signed CAS sequence 0 -> 1, forgery/replay/rollback
      denial, link outage fail-closed in 1566 ms, independent process SIGTERM,
      persisted signed head and recovery without key rotation; ephemeral
      secrets/Serve cleaned (2026-11-02; QA_REMOTE_WITNESS_PROCESS_RESTART_2026-11-02.md)
- [x] Disposable real Fabric 1.21.1 mission gated by physical Durán WSL2
      Ed25519 witness over tailnet-verified HTTPS: real oak gather, local
      client transport deliberately severed before signed chest deposit,
      zero deposit, unchanged journals, durable cancellation, checkpoint
      sequence 1 and preflight restored without replay; Node 368/368 and
      Python 58/58 PASS (2026-11-02; QA_REAL_FABRIC_PHYSICAL_WITNESS_2026-11-02.md)
- [x] Cobblemon 1.8.2 loaded in a separate real Fabric 1.21.1 world:
      read-only GuiaIA observer MCP roundtrip PASS (diamond block, sheep,
      16 blocks, private snapshot), negative JAR-identity gate PASS, Python
      58/58 and Node 368/368 PASS; Mineflayer connection accepted by server
      but client spawn not completed (2026-11-02; QA_COBBLEMON_OBSERVER_2026-11-02.md)
- [x] Instrument the isolated Cobblemon Mineflayer protocol failure:
      state transitions reach PLAY; 79 PLAY packets then observed
      play.toClient decoder error for impossible array length; original
      16-second spawn timeout was a symptom, not root cause. No data or
      authorizations bypassed; see QA_COBBLEMON_OBSERVER_2026-11-02.md
- [ ] Identify the precise malformed/unsupported 1.21.1 packet schema,
      fix only verified version-specific decoding or adopt a native Fabric
      client, then prove spawned bot before enabling any physical action
- [ ] Establish a Fabric/Cobblemon-compatible operator client or signed
      server-side execution bridge, preserving all identity, one-shot grant,
      witness and fail-closed controls; rerun physical gather/deposit and
      witness-outage QA against a disposable Cobblemon world
- [ ] Operationalize authenticated remote witness for a real isolated
      Fabric/Cobblemon world: deployment hardening, restart and crash tests,
      host authorization, account identity and controlled multiplayer beta
- [ ] Official online-mode Minecraft account identity and consent before beta
- [ ] Independent user-facing installation and controlled multiplayer beta
