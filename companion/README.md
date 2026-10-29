# GuiaIA Companion — first playable QA prototype

**Not a player-ready or secure multiplayer release.** This experiment uses upstream Mineflayer + mineflayer-pathfinder in **Minecraft Java 1.21.1**, but currently connects **only to a local, disposable offline-mode QA server on 127.0.0.1:25598**.

## What works in this initial prototype

- Real Minecraft Java bot connection/respawn, via a separately installable Node.js process.
- Local-operator-only `follow`, `stop` and `status` input commands; no AI model can issue commands yet.
- Only follows an owner entity *visible within 18 blocks*, with adequate health; continuous safety check aborts if the owner is lost/out of range.
- Following uses pathfinding with digging, tower-building, door-opening, free motion, parkour and sprinting disabled.
- The normal companion CLI has no RCON, chat command execution, mining, item collection, building, attacks or filesystem/world saves. **A separate QA-only function now verifies exactly one real oak-log pickup**, without enabling any CLI or public Minecraft world mutation.

**No reliable player identity in offline mode.** The simple username match is only safe inside a loopback-isolated throwaway laboratory controlled by the operator. Never publish the port or point it at Teselia; any real online server integration needs an authenticated account/UUID owner binding, deny-by-default actions and independent approval.

## Unit tests (Node 22+)

```sh
cd companion
npm ci --ignore-scripts
npm test
```

For launch, the script intentionally requires `GUIAIA_QA_OWNER` and an explicit `--qa-local-only` argument, and connects to port 25598. The stdin protocol accepts only `follow`, `stop`, `status`, `quit`, with one command per line.

## Single-block gathering experiment (branch-only)

The new `src/gather.js` implements a **single pre-authorized oak-log operation** for a disposable QA world. It requires an explicit QA-only flag, a configured owner visible within 18 blocks, minimum health, a close target, safe feet/head observations, an exact block allowlist, and an inventory delta before reporting success. The target is configured by the QA operator; chat, MCP and LLM output cannot request or select blocks. It will **never** use `/give` or arbitrary world commands.

`npm test` checks refusals, missing owner/health, timeouts, concurrent jobs, cancellation and real inventory-delta evidence with mocks. The Minecraft Java 1.21.1 trial **[passed on GitHub Actions run 40839192159](https://github.com/iagorobo24-hub/GuiaIA/actions/runs/40839192159)**: real Mineflayer inventory increased from **0 to 1 oak log** while the world target changed from **oak_log to air**. A follow-up real run initially exposed unreliable item pickup even though the block was broken; the experiment now includes a bounded, non-digging approach to the approved drop location when inventory verification is missing. The disposable QA also moves the owner outside the item's pickup radius so only the companion can collect the test drop. This is a *single-block lab experiment*, not autonomous foraging, and is not connected to the companion CLI. Repeatable live QA of the new pickup behavior is required before wider rollout.

## Durable mission runner (separate QA-only engine)

`src/mission.js` is a bounded **1–3 preauthorized oak/birch-log mission journal** with a single local operator, explicit owner, preapproved block positions and a file-based durability barrier **before** every block mutation. Each success needs the existing verified block-and-inventory receipt. The ledger uses atomic file replacement, fsync and private `0700`/ `0600` Linux permissions; a `mission.lock` stops concurrent processes.

If Minecraft, the bot or the journal process crashes while a mining step is `dispatching`, recovery changes the state to `needs_review` and **never automatically mines that block again**. An uncertain drop or an interrupted job also blocks further dispatch. Operator cancellation during an active action cannot create a delayed success receipt. Only an *unattempted* paused step can be explicitly resumed. A stale lock after a real crash requires operator confirmation that the original process has stopped before manual intervention; the code does not break it automatically.

**Verified locally:** mission authorization, duplicate prevention, crash-after-dispatch recovery, exclusive process lock, receipt tampering, cancellation and journal permissions (10 focused tests). **Real Minecraft integration passed:** [run 40845713226](https://github.com/iagorobo24-hub/GuiaIA/actions/runs/40845713226) collected two oak logs with two durable receipts and confirmed reopening without replay.

This does **not** offer arbitrary natural-language jobs, free exploration, craft recipes, production storage or secure multiplayer identity. The original Teselia private world and its mission database are never accessed.

**A real, isolated in-game follow/stop demonstration has passed:** [GitHub Actions run 40836717049](https://github.com/iagorobo24-hub/GuiaIA/actions/runs/40836717049) joined two local QA accounts in a disposable Minecraft 1.21.1 server, accepted a follow goal, measured **6.075 blocks of actual companion movement**, and successfully stopped. This proves a small functional QA prototype, not full gameplay autonomy.

## Multi-resource navigation (branch-only)

The experimental mission engine now supports **two explicit allowlisted types**, `oak_log` and `birch_log`, at a maximum of three pre-approved coordinates per mission. A typed journal receipt cannot be satisfied with inventory from another resource. The QA-only gatherer can navigate up to 10 blocks to an approved resource while continuously checking the owner-distance and health safety conditions; its pathfinder cannot dig or construct shortcuts.

**Minecraft QA passed:** [run 40848585045](https://github.com/iagorobo24-hub/GuiaIA/actions/runs/40848585045) observed actual inventories **oak 0 → 1** and **birch 0 → 1**, **5.627 blocks** of movement toward the birch target, two persisted receipts, a successful journal reopen, and denial of a repeated completed mission. See [full validation report](../docs/COMPANION_MULTIRESOURCE_QA_2026-10-29.md). This is not an open-ended exploration or general mining system and has no external command interface.

## Verified chest deposits and gather-to-storage QA (branch-only)

The laboratory companion now places **one oak and one birch log into a real Minecraft chest** and records both the player's decrease and the chest's increase in a private, durable journal. [Independent real chest QA](https://github.com/iagorobo24-hub/GuiaIA/actions/runs/40854617901) passed with synthetic test items; the stronger [full gather-to-chest QA](https://github.com/iagorobo24-hub/GuiaIA/actions/runs/40855197839) passed with materials actually harvested by the bot, **no synthetic inventory injection**, two mining receipts, two deposit receipts, chest reopened and replay denied. [Validation report](../docs/COMPANION_CHEST_DEPOSIT_2026-10-29.md).

## Reconciliation across real Minecraft restarts (QA-only)

A passive [recovery audit](../docs/COMPANION_RESTART_RECONCILIATION_QA_2026-10-29.md) now compares actual player/chest slot counts with the durable journal **without touching or recovering the journal**. [Two real restarts after save](https://github.com/iagorobo24-hub/GuiaIA/actions/runs/40859271349) maintained oak and birch in the real chest. More importantly, a [deliberate synthetic bot crash after a real chest transfer but before the receipt](https://github.com/iagorobo24-hub/GuiaIA/actions/runs/40860839434) preserved the object in the chest while the journal remained `transferring` with zero receipts. The audit refused any automatic retry, left the stale lock intact and required manual review. It never claims to prove a power loss DURING the Minecraft server save.

## Operator-signed single-use chest permissions (QA-only)

The new [out-of-band operator capability gate](../docs/COMPANION_OPERATOR_CAPABILITIES_QA_2026-10-29.md) verifies Ed25519 signatures, exact world, bot, chest position, item, count and short expiry, then durably consumes a one-time nonce **before** allowing the existing QA chest adapter to mutate the world. A [real Minecraft 1.21.1 QA run](https://github.com/iagorobo24-hub/GuiaIA/actions/runs/40873598259) refused unsigned and wrong-chest attempts; approved two separate signed grants, observed real inventory-to-chest changes and rejected grant reuse. This authorizes a trusted operator's scoped action only; an offline Minecraft username or UUID **does not authenticate the player**. The older raw QA adapters are still accessible to internal tests, not exposed to users; a global mandatory policy gate has not been integrated.

## Session-bound offline identity contract (experimental QA only)

A new [triple-signed session contract](../docs/COMPANION_OFFLINE_SESSION_IDENTITY_QA_2026-10-29.md) requires separate trusted-server connection evidence, proof of a pre-enrolled player's key, and a session-bound operator grant. Connection ID, random challenge, identity, world, exact chest, inventory and grant nonce must match; disconnection, revocation, expiry or replay fail closed. A [Minecraft 1.21.1 QA run](https://github.com/iagorobo24-hub/GuiaIA/actions/runs/40878801233) confirms that mismatched sessions and fake permissions cannot alter the real chest, while two permitted operations succeed. **The signed server bridge and player proof are SIMULATED by the test harness, not generated by a deployed Fabric identity service.** The gateway only exposes authorized deposits; historical QA adapters remain accessible internally and there is no globally enforced production action boundary.

## Fabric server-signed connection bridge (separate lab-only milestone)

[Real server JOIN/DISCONNECT QA](https://github.com/iagorobo24-hub/GuiaIA/actions/runs/40881777326) now proves that a Fabric 1.21.1 server can create and sign Ed25519 evidence of **actual connection handlers**, including two distinct IDs/challenges for the same unverified offline nickname, and that disconnected or stale sessions are not present in the tested audit log. The separate [pinned-key evidence reader](../docs/COMPANION_REAL_FABRIC_CONNECTION_BRIDGE_QA_2026-10-29.md) rejects forged or expired records. No private key is committed and the actual server bridge is default-off and restricted to disposable /tmp QA worlds.

**Production and public distribution remain blocked** until owner keys are safely enrolled outside Minecraft, the server provides a live authenticated-session check instead of merely a signed event log, mandatory authorization covers all world-modifying actions, in-flight server storage fault recovery is validated, and Cobblemon compatibility is established. For design context see [Issue #2](https://github.com/iagorobo24-hub/GuiaIA/issues/2).

## Live server-presence guard (isolated QA only)

An opt-in QA-only Fabric module answers a short-lived Ed25519-signed
nonce challenge on 127.0.0.1:25594 from the running server's live
connection-handler table. src/live_presence.js validates the reply using the
separately pinned public key. The experimental requireLivePresence gateway
requires it before consuming a one-use grant or opening a chest, addressing
stale JOIN files after a sudden server death in the disposable lab.
This is not production authentication, does not cover a server crash after
a successful query, and is not enforced by every legacy QA adapter.
See docs/COMPANION_LIVE_SERVER_PRESENCE_QA_2026-10-29.md.

## Principal registry checkpoint (QA only)

The signed out-of-band principal registry now checks a separate local
high-water-mark file before every trust/revocation read. Restoring only one
file or interrupting a two-file update fails closed. exportCheckpoint()
provides a value that an authorized operator MAY pin outside the same writable
filesystem; opening with externallyPinnedCheckpoint enforces that exact
value, including when both local files were rolled back together. The library
does not manage an external trusted store; unpinned dual-file rollback remains
possible. See docs/PRINCIPAL_ROLLBACK_CHECKPOINT_QA_2026-10-29.md.

## Independent checkpoint witness protocol (QA only)

The new opt-in requireRemoteCheckpoint action guard obtains a fresh signed
high-water mark from a separate local witness process before reserving a
single-use grant. The witness accepts only Ed25519 operator-signed bootstrap
and compare-and-swap monotonic advances; client and witness sign/check all
scope, key, nonce and revision fields. Test coverage includes a killed witness,
persistent restart, forged updates, coherent local registry rollback and
pre-world-mutation denial. **This is still a localhost proof, not a remotely
protected immutable authority.** It shares the user's disk and can itself be
rolled back by someone who controls that disk. See
docs/PRINCIPAL_INDEPENDENT_WITNESS_QA_2026-10-29.md.
