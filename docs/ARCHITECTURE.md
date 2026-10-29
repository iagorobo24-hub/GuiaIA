# Architecture proposal — Companion + World Observer + Developer Agent

## Boundaries

```text
User/chat/agent client
       |
   Authenticated Tool Gateway (MCP optional, default localhost)
       |       policy + budgets + audit + cancel
       +--> Companion Planner -> typed goals -> safe skills -> Bot/Fabric
       +--> World Observer -> server snapshots / bot perception / client vision
       +--> Developer Planner -> diagnostics -> isolated QA / worktree -> validation
                                  |
                              approval-gated deployment, never automatic
```

## Data sources and limitations

- **Bot perspective:** Mineflayer knows nearby loaded blocks, entities, inventory, weather and game events; it does not know unobserved chunks or see the client screen.
- **Server perspective:** dedicated Fabric mod can expose authoritative bounded snapshots of loaded worlds, player-presence and performance summaries. All Minecraft server API reads/actions must honor the game's main-thread contract.
- **Client perspective:** optional client-side component can capture images and UI when explicitly activated. Do not describe NBT/world-state data as computer vision.
- **Ops perspective:** read-only logs, tick timings, service health, mod/version manifest, selected redacted diagnostics.
- **Persistence:** durable, append-only action/event ledger with idempotency keys and provenance; separate from world/player save files.

## Tool groups (proposed contract, not implemented)

- `observe.status`, `observe.nearby`, `observe.region`, `observe.entities`, `observe.inventory`, `observe.events`, `observe.performance`: bounded/read-only, cursors and pagination.
- `vision.capture`: requires a connected authorized Minecraft client; records capture source and timestamp.
- `play.follow`, `play.navigate`, `play.gather`, `play.craft`, `play.build_preview`: narrow action schemas, hard time/radius/count limits.
- `ops.diagnose`, `dev.inspect_project`, `dev.plan_change`, `dev.run_qa`, `dev.verify`: work against an isolated staging environment.
- `world.apply_build`, `ops.restart`, `ops.restore`, `dev.promote`: privileged; disabled by default, authorization + preflight + rollback required.
- `control.stop`, `control.pause`, `control.status`: available without model inference.

## Trust and permission rules

Policy uses principal identity, role, capability, world ID, target region, expiry, quota, current server state, and approval receipt. Two-tier control: the model only issues typed requests; an independent executor applies policy and verifies postconditions. No unrestricted RCON, code evaluation or shell. Emergency stop does not depend on the model. In offline-mode servers, a player name/UUID alone is not adequate identity proof.

## Autonomous development workflow

1. Create a read-only evidence bundle (version hashes, timing samples, game events, world snapshot provenance).
2. Hypothesize root cause and produce a reproducible test in a **separate** test world.
3. Modify only relevant code in an isolated repository checkout where necessary.
4. Run build/tests, launch isolated Fabric + mods, test in-world, collect quantitative before/after metrics.
5. Produce diff, evidence, risk, rollback and explicit approval request for production changes.
6. Deploy only through a distinct operator action, after verified backup and safety gates.

## Lightweight resource strategy

Run observation/event collection cheaply on Penguin; bound polling and entity scans, avoid chunk forcing and large image capture. Heavy model inference, build and expensive QA should use an external capable machine or on-demand service when authorized. Keep the production game thread responsive.

## Compatibility

First target: **Minecraft Java 1.21.1 / Fabric**, existing GuiaIA proof of concept and Cobblemon Teselia. Version adapters should make vanilla/other supported Fabric builds possible. Never assume third-party Fabric MCP mods that only advertise newer Minecraft versions can be used on 1.21.1.
