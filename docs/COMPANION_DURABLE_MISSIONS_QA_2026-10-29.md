# GuiaIA — Durable QA mission milestone (2026-10-29)

**Scope:** public repository `iagorobo24-hub/GuiaIA`, branch `feature/companion-durable-missions`. No private Teselia world, code, server, data files or services were modified by this work. The Minecraft server used for integration is a disposable CI fixture bound to `127.0.0.1` with RCON disabled.

## Functionality implemented

- `companion/src/mission.js`: a local-operator-only journal of **1–3 preselected oak logs**; all target positions are explicit, bounded, unique and matched against the corresponding gather adapter before dispatch.
- One durable `dispatching` receipt with an operation ID is fsynced to a private JSON journal before any call to `gatherOne()`. Each successful step requires the existing Minecraft world-block and inventory delta verification before saving a completion receipt. Journal file mode `0600`; directory mode `0700`; Linux operator-owned QA directory required.
- A process restart after dispatch with unknown outcome changes the mission to `needs_review` and **never repeats that block automatically**. Cancelling during execution cannot turn a late success into an acknowledged receipt. Unverified item collection also blocks automatic retry.
- Only unattempted, safely paused steps can be explicitly resumed. The lock file prevents concurrent writers. An abandoned lock after a real crash **must be manually reviewed after stopping the old process**; it is never silently reclaimed.
- No chat, LLM or MCP command path to the mission runner; no credential for a production account; no autonomous multi-resource search.

## Verification

**Python:** 50 tests passed. **Node:** 33 tests passed, including 10 new tests for completed missions, rollback prevention, concurrency, interruption, receipt tampering, stale-lock behavior and permission boundaries. The Node 22 CI passed on the original mission implementation commit `199fd6e` (mission code unchanged since); Python 3.11/3.12/3.13 CI passed again on corrected commit `76dc275`. The complete real Fabric QA also passed on commit `76dc275`.

**Full Minecraft Java 1.21.1 + Fabric integration:** [GitHub Actions run 40845713226](https://github.com/iagorobo24-hub/GuiaIA/actions/runs/40845713226) **SUCCESS**. The integration step `Durable two-step Minecraft mission and restart without replay` records:

| Observed gate | Evidence |
| --- | --- |
| Real login | `real_minecraft_login=true` |
| Authorized targets and dispatches | 2 planted oak-log blocks, 2 steps |
| Persistent verified receipts | `receipts=2` |
| Actual Mineflayer inventory | `inventory_before=0`, `inventory_after=2`, `items_verified=2` |
| Restart/reopen without retry | `restored_after_reopen=true`, `completed_replay_denied=true` |
| Owner not stealing test drops | `owner_outside_pickup_range=true` |
| Private journal modes | `journal_directory_private=true`, `journal_file_private=true` |
| Isolation | `production=false`, `world=disposable_fabric_qa` |

In the same run the earlier baseline Fabric observer, entity stress, independent single-block gather and real bot follow/stop also passed.

### Important failed attempt and correction

The first expanded CI run `40844967853` failed **before reaching the mission test**, during the older follow/stop QA: the two QA players spawned randomly more than 18 blocks apart, triggering the correct safety refusal `owner_out_of_range`. The Minecraft QA world now has a dedicated elevated platform, `spawnRadius=0` and explicit fixed world spawn. The 18-block controller safety limit was **not changed**. The corrected run passed.

## Not yet certified or production-ready

- No real production account identity/authenticated owner UUID, and QA uses offline-mode solely on loopback.
- No automatic path discovery, hazard handling beyond a small allowlist, Cobblemon compatibility, secure modpack install or actual-world performance measurements.
- No proof of crash recovery after abrupt power loss of a live Minecraft server; the unit tests emulate interruption after the journal dispatch barrier and verify fail-closed restart, while the live CI reopens a *completed* mission.
- No support for open-ended resource types, crafting, storage/deposits, AI-generated commands, cross-process multiwriter leases or automated conflict resolution.
- The local journal assumes an operator-controlled parent directory on Linux, and its small 1–3 block limit is deliberate for this isolated acceptance.
- Production server release, branch merge and Teselia integration remain blocked until their own authentication, load and recovery gates are met.

**Verdict:** durable, bounded, real-Minecraft QA milestone completed. Do not treat it as a deployable autonomous companion.
