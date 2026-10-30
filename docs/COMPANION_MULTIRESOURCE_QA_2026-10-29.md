# GuiaIA — Multi-resource + bounded navigation QA (2026-10-29)

## Scope

Public repository `iagorobo24-hub/GuiaIA`, branch `feature/companion-multiresource-qa`. All tests ran using a **disposable local-only Minecraft Java 1.21.1/Fabric laboratory** on a GitHub Actions runner. RCON disabled, no production server connection, no private world or Teselia code modified.

## Implemented

- A reviewed, strict allowlist containing only `oak_log` and `birch_log`. Unknown names are rejected before any mining.
- Every authorized mission target can include its exact `block` type. The mission journal confirms target coordinates, type, player and sandbox-only scope match the gather adapter.
- Each success must have the approved type, the corresponding item name and a real inventory increase. The durable journal records a receipt for the correct item type.
- Legacy oak-only journal records are still supported and covered by tests; no state migration or replay is attempted.
- Optional navigation is restricted to one preselected target, a maximum initial distance of 10 blocks, an owner visible within 18 blocks, minimum health and a continuously monitored owner/distance limit. Pathfinder in QA cannot dig, build towers, open doors or use parkour shortcuts. An unsafe or unreachable position is rejected before digging.
- Failed or unverifiable world changes still block automated replay as `needs_review`; failed navigation before digging can pause for explicit operator review/resume.
- Nothing connects chat, MCP, an LLM or a live-world companion CLI to this experiment.

## Verification

**Python:** 50 tests passed locally and on GitHub Actions Python 3.11, 3.12 and 3.13.

**Node 22:** 40 tests passed locally and on the dedicated GitHub Actions suite, including 7 new checks for mixed resource receipts, strict type matching, forged results, target distance limits, navigation failures and backwards compatibility.

**Real Minecraft/Fabric:** [GitHub Actions run 40848585045](https://github.com/iagorobo24-hub/GuiaIA/actions/runs/40848585045) passed all steps, including `Two distinct resources, bounded navigation and durable receipts`. Recorded evidence:

| Proof | Verified observation |
| --- | --- |
| Real Minecraft connected | `real_minecraft_server=true` |
| Allowed material names | `oak_log`, `birch_log` |
| Mission steps | 2 authorized targets |
| Initial inventory | oak 0, birch 0 |
| Final inventory | **oak 1, birch 1** |
| Durable receipts | 2 correctly typed receipts |
| Real walking | birch navigation used, **5.627 blocks** of measured displacement |
| Journal reopened | `persisted_reopen=true` |
| Repeated completed mission | `replay_denied=true` |
| Confirmed block mutations | 2 |
| Live world affected | **No**, `production=false`, `sandbox_only=true` |

The same run passed the older Fabric observation, stress, follow/stop, single-oak and 2-oak durable-mission tests. Stress figures from this run remain single-run synthetic measurements, **not** a production performance guarantee.

## Boundaries and next gates

This is a **bounded laboratory demonstration**, not an autonomous survival agent. Unimplemented or unverified areas include real owner authentication / UUID binding, realistic terrain and water/lava hazards, multi-stage path recovery, inventory durability after a **Minecraft server** crash, other material drops/tools, Cobblemon modpack compatibility and storage/deposit into real chests.

Next independent phase: exact authorized chest location, verified decrease in player inventory and matching increase in chest inventory, write-ahead journal receipt and crash-recovery that never blindly repeats an uncertain deposit. Only after that should broader materials/crafting be considered. **Do not deploy to Teselia.**
