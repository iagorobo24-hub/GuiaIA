# GuiaIA Roadmap and Real Completion Status

Updated: 2026-10-30

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
- [x] Cross-platform Windows NTFS / Linux execution and permission fallbacks
- [x] Multi-resource 4-step mission in real Fabric 1.21.1 (`--multi-resource` PASS)
- [x] Safe interruption and crash recovery without item duplication (`--crash-after-deposit` PASS)
- [x] Ed25519 signed session identity bridge and live presence server (`qa_fabric_identity_bridge.py` PASS)
- [x] Priority 0 emergency halt without security nonces
- [x] Disposable diagnostic sandbox with structured comparative reports (`qa_diagnostic_sandbox.py` PASS)
- [x] Public documentation: `GETTING_STARTED.md` and `VERIFIED_CAPABILITIES.md`
- [ ] Another-machine clean install confirmation
