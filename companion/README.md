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

`src/mission.js` is a bounded **1–3 oak-log mission journal** with a single local operator, explicit owner, preapproved block positions and a file-based durability barrier **before** every block mutation. Each success needs the existing verified block-and-inventory receipt. The ledger uses atomic file replacement, fsync and private `0700`/ `0600` Linux permissions; a `mission.lock` stops concurrent processes.

If Minecraft, the bot or the journal process crashes while a mining step is `dispatching`, recovery changes the state to `needs_review` and **never automatically mines that block again**. An uncertain drop or an interrupted job also blocks further dispatch. Operator cancellation during an active action cannot create a delayed success receipt. Only an *unattempted* paused step can be explicitly resumed. A stale lock after a real crash requires operator confirmation that the original process has stopped before manual intervention; the code does not break it automatically.

**Verified locally:** mission authorization, duplicate prevention, crash-after-dispatch recovery, exclusive process lock, receipt tampering, cancellation and journal permissions (10 focused tests). **Real Minecraft integration:** `scripts/qa_mission_server.py` starts a disposable Fabric 1.21.1 server, plants two oak logs, and asks a QA Mineflayer companion to collect them sequentially and prove the journal survives a process reopen without replay. Check its CI outcome before claiming real multi-block mission completion.

This does **not** offer arbitrary natural-language jobs, free exploration, craft recipes, production storage or secure multiplayer identity. The original Teselia private world and its mission database are never accessed.

**A real, isolated in-game follow/stop demonstration has passed:** [GitHub Actions run 40836717049](https://github.com/iagorobo24-hub/GuiaIA/actions/runs/40836717049) joined two local QA accounts in a disposable Minecraft 1.21.1 server, accepted a follow goal, measured **6.075 blocks of actual companion movement**, and successfully stopped. This proves a small functional QA prototype, not full gameplay autonomy.

**Production and public distribution remain blocked** pending stable reconnect/recovery, comprehensive terrain hazard policy, secure owner authentication, multi-resource and durable inventory verification, and integration tests under actual modpacks (including Cobblemon). For design context see [Issue #2](https://github.com/iagorobo24-hub/GuiaIA/issues/2).
