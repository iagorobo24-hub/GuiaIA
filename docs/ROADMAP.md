# GuiaIA roadmap and real completion status

Updated 2026-10-29.

| Stage | Deliverable | Status / evidence |
| --- | --- | --- |
| 0. Baseline & separation | Inventory private Teselia prototype, keep worlds/secrets out | **Partial:** inspected live services, repository code/architecture; original history must remain private |
| 1. Public developer preview | Independent Python package, CI, security docs, tests | **Implemented locally:** read-only MCP, planner, safety guard, 25 tests pass; Linux Penguin lacks pip so install/build only through CI |
| 2. World Observer | Authoritative Fabric chunk/entity/event snapshot, bounded budget | **Prototype:** optional read-only loaded-chunk sampler + strict Python MCP consumer; Java CI and in-world QA required; no event stream yet |
| 3. Agent tools | Local MCP, typed schemas, audit/policy, permissions | **Partial:** 4 MCP tools, deterministic plans, no mutation capabilities; modern 2026 protocol + formal security audit pending |
| 4. Companion MVP | Bot follows, stops, gathers and validates inventory in a fresh world | **Pending:** independent public build and Minecraft in-world integration |
| 5. Developer Agent MVP | Diagnose issue; run isolated QA, verify result, propose deployment | **Pending:** only telemetry-based read-only heuristic diagnosis exists |
| 6. Vision | Real screenshots from authorized client | **Pending** |
| 7. Public stable release | Reproducible install, cross-version QA, video, real playtest | **Pending** |

## v0.1.0 criteria (developer preview)

- [x] Independent public-source implementation without reusing private world files
- [x] Fixed read-only RCON command allowlist and loopback transport
- [x] MCP stdio supports initialize, tools/list, tools/call in 2025-11 protocol family
- [x] Validated metric snapshots and bounded Spanish gather plan proposals
- [x] Tests for sanitization, prompt injection, policy denial, read-only semantics
- [x] Real live RCON read of Penguin Minecraft status, without in-game mutation
- [x] MCP subprocess smoke integration
- [ ] GitHub repository + remote CI confirmation
- [ ] Another-machine clean install

## Future demonstration

> "GuiaIA, enter my world, follow me, investigate why this area lags, test a safe improvement in a disposable copy and show me your evidence."

Today the tool can **read server basics**, inspect synthetic data or operator-provided metrics, and **propose** a diagnostic workflow. It does **not** autonomously follow, observe nearby blocks or modify a world.

## Risks that must block release of state-changing agents

Player identity spoofing on offline-mode servers, unverified chunk save integrity, Cobblemon storage consistency, model prompt injection, lack of robust cancellation, and inability to restore backups. Production Teselia continues as a separate private project.
