# GuiaIA P0 observer security and bounded-load assessment (2026-10-29)

**Status:** Experimental independent QA branch, **not** production deployment approval.

## Audited boundaries

- **Minecraft server integrity:** observer code reads one already loaded chunk (sample of 16 blocks at a configured Y), up to 64 non-player entities in a bounded Y band, at most once per 200 ticks, without generating chunks or executing game commands.
- **Observer opt-in:** configuration missing, malformed, disabled or non-overworld means no active tick sampling.
- **Local output privacy:** on POSIX/Linux, the module creates its dedicated directory with `0700`, sets `0700` on reuse, and uses `0600` for temporary snapshots; an atomic rename replaces the resulting snapshot. It rejects symlinked final directory/file paths and a symlinked `config` directory on startup/use. The CI now checks the actual resulting permission bits.
- **MCP snapshot consumer:** opens final component once with `O_NOFOLLOW` where supported, rejects non-regular objects, JSON duplicate keys, >8 KiB payloads, stale/future timestamps, invalid booleans, unsupported source/dimension and impossible chunk/entity counts. The generic operator snapshot mode has a separate 16 KiB limit.
- **RCON exposure:** loopback-only, command allowlist `list` or `time query gametime`; operator credential file is bounded (512 bytes) and opened with a no-follow file descriptor for each query. Tool-level RCON failures return sanitized errors, not stack traces or secrets.
- **Companion QA:** the initial bot only accepts `follow`, `stop`, `status`, `quit` from local process stdin, loopback-only offline-mode Minecraft at port 25598, with an explicit QA flag and owner name. It does not accept model/ingame chat commands. Follow has distance/health/owner-presence checks, and attempts to disable building/digging pathfinder shortcuts. This **does not** establish authentication security on offline-mode multiplayer.

## Reproducible checks and limitations

**Confirmed by GitHub Actions** (Fabric 1.21.1 Java 21 on disposable, loopback-only Minecraft server):

- Baseline observer disabled with 160 frozen sheep: tick-query average **0.50 ms/tick**.
- Observer enabled with same 160 sheep: tick-query average **0.40 ms/tick**, entity sampler returned the capped **64**.
- Observer enabled with 320 frozen sheep: tick-query average **0.80 ms/tick**, entity sampler still capped **64** and block sample stayed at 16.
- First stress evidence: [CI run 40836505634](https://github.com/iagorobo24-hub/GuiaIA/actions/runs/40836505634), commit `07beffa`. Values are **one runner and one server each**, rounded to one decimal. A difference of -0.1 ms between two runs is **not proof of overhead improvement**.
- Independent rerun: [CI run 40836717049](https://github.com/iagorobo24-hub/GuiaIA/actions/runs/40836717049), commit `703a210`: control 160 sheep **0.8 ms/tick**, observer 160 sheep **0.8 ms/tick** (difference **0.0 ms/tick**), observer 320 sheep **2.2 ms/tick**, with 64 capped observed entities and 16 sampled blocks. These are separate low-cost QA runs, **not** synchronized/controlled benchmarks suitable for production overhead claims.
- Earlier [run 40832434066](https://github.com/iagorobo24-hub/GuiaIA/actions/runs/40832434066) verified disabled default, real diamond-block and sheep observations, successful real Fabric-to-MCP roundtrip and no force load of a distant chunk.

**Pending gates or limitations:**

1. **Benchmark quality:** repeated matched A/B trials, loaded-modpack comparison and high-density real Cobblemon entity samples; no conclusions about production server performance from synthetic sheep.
2. **Filesystem threats:** the runtime assumes an operator-controlled game directory and parent directories. These are not adversarial local multiuser sandbox isolation; race-free traversal through untrusted symlinked parent paths is not independently proved.
3. **Cross-platform ACLs:** directory permission implementation explicitly relies on POSIX semantics. Behavior on non-POSIX OSes has not been validated; the current QA target is Linux.
4. **Production identity:** username authentication in local-only offline-mode bot QA **is not secure owner verification** for arbitrary multiplayer servers. No production bot credentials, gamer accounts, public server integrations or autonomous world edits are authorized.
5. **Real companion gameplay:** [run 40836717049](https://github.com/iagorobo24-hub/GuiaIA/actions/runs/40836717049) **PASSED** a real Minecraft 1.21.1 QA login with two Mineflayer accounts, owner detection, accepted follow goal, **6.075 blocks of measured bot movement**, safety monitor and stop. This is a *local sandbox-only prototype*. Full gathering/inventory evidence, secure identity, modpack compatibility, hazardous terrain, anti-cheat behavior and recovery remain future work.
6. **Performance guarantees:** CI low-load MSPT numbers do not establish overhead under peak production load or server watchdog constraints.

**Disposition:** Retain all new functionality on a feature branch. Do not deploy any module to the concurrent Teselia development server or merge with production code merely based on CI success.
