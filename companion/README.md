# GuiaIA Companion — first playable QA prototype

**Not a player-ready or secure multiplayer release.** This experiment uses upstream Mineflayer + mineflayer-pathfinder in **Minecraft Java 1.21.1**, but currently connects **only to a local, disposable offline-mode QA server on 127.0.0.1:25598**.

## Secure signed delivery — verified isolated Minecraft integration (2026-10-30)

The new [secure delivery laboratory runtime](../docs/SECURE_RUNTIME_LAB_2026-10-30.md)
combines per-action signed Ed25519 permissions, live Fabric session evidence,
independent checkpoint verification, approved bounded gathering, real chest
transfers and durable no-replay mission/deposit journals. The updated end-to-end
runner passed on a fresh disposable Fabric 1.21.1 server: mined oak log,
Mineflayer inventory **1 → 2 → 1**, chest inventory **0 → 1**, one signed
gather receipt, one signed deposit receipt, two spent nonces, and replay denied.
All **319 Node tests** and **54 Python unittest tests** passed locally.

**This is still an isolated QA runtime, not a public playable beta.** The
regular CLI does not expose the signed delivery operation and there is no
standalone real-operator credential bootstrap or integrated interactive UI.
Neither offline usernames nor synthetic QA enrollment authenticate real users.

## What works in this initial prototype

- Real Minecraft Java bot connection/respawn, via a separately installable Node.js process.
- Runtime stdin is limited to status, stop and quit; a bare follow command is **denied** until authenticated, separately approved session-based movement is implemented. No AI model can issue commands.
- The low-level test-only follow controller follows an owner entity visible within 18 blocks and stops if safety deteriorates; this behavior is **not exposed through the runnable CLI**.
- Following uses pathfinding with digging, tower-building, door-opening, free motion, parkour and sprinting disabled.
- The normal companion CLI has no RCON, chat command execution, mining, item collection, building, attacks or filesystem/world saves. **A separate QA-only function now verifies exactly one real oak-log pickup**, without enabling any CLI or public Minecraft world mutation.

**No reliable player identity in offline mode.** The simple username match is only safe inside a loopback-isolated throwaway laboratory controlled by the operator. Never publish the port or point it at Teselia; any real online server integration needs an authenticated account/UUID owner binding, deny-by-default actions and independent approval.

## Unit tests (Node 22+)

```sh
cd companion
npm ci --ignore-scripts
npm test
```

For launch, the script requires GUIAIA_QA_OWNER and an explicit --qa-local-only argument, and connects to port 25598. The stdin protocol permits status, stop and quit; follow returns signed_session_authorization_required without moving. The low-level follow controller remains usable only by explicit disposable test harnesses. See the QA runtime action-surface report in docs.

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


## Signed short-lived follow in isolated QA

The low-level follow controller can now be wrapped by
src/qa_authorized_follow.js. This experiment requires an operator-signed
Ed25519 **follow-specific** capability (max 10 seconds), a separately
signed owner/session proof bound to a real Fabric connection, fresh
Fabric JVM presence, and a separately pinned revocation checkpoint.
The permission nonce is durably spent before starting pathfinding.

While moving, the wrapper rechecks the live session, principal revocation,
the witness and health/distance safety. A bounded watchdog cancels follow
even if the live query never returns. No arbitrary block or inventory
operations are exposed. The runnable stdin CLI **still denies follow**;
the wrapper is for the disposable QA harness only. A production feature
must have authenticated real players and a protected off-host witness.
See docs/GUIAIA_SIGNED_FOLLOW_QA_2026-10-29.md.

## Signed durable gather-to-chest delivery (disposable QA only)

The opt-in QA delivery pipeline joins the existing durable gather and
chest-deposit journals with an exact operator-signed Ed25519 plan bound to
the live Fabric session and a separately pinned revocation witness.
The plan issuer ties its signature to both persisted journal IDs, targets,
materials, quantities and the named chest. The signed adapter can stop
movement or world operations when its live authority expires or is revoked.
A bounded navigation adapter approaches *only* approved coordinates; it
cannot open arbitrary mission, chat or LLM command surfaces.

A read-only report shows signed task progress and uncertain operations
without confirming Minecraft world state. A failed or interrupted step
is never replayed without a new, operator-reviewed authorization.
The runnable CLI does NOT enable this flow. It is not a production agent.

See docs/QA_DELIVERY_PIPELINE_HANDOFF.md,
docs/QA_SIGNED_DELIVERY_HANDOFF.md,
docs/QA_DELIVERY_PLAN_ISSUER_HANDOFF.md,
docs/QA_BOUNDED_NAVIGATION_V5_HANDOFF.md,
docs/QA_DELIVERY_READOUT_V6_HANDOFF.md and
docs/evidence/GUIAIA_DELIVERY_V6_PENGUIN_2026-10-29.json.

## Local signed operator console (disposable QA only)

The security runtime in `src/secure_delivery_runtime.js` now accepts an
optional **independent operator-signed single-use follow grant** in addition to
the signed gather and deposit grants. All grants must be tied to the same
current signed connection and pre-enrolled principal; duplicate nonces are
rejected before any action. Its `follow()`, `inventory()`, `status()`,
`runNext()`, `runAll()`, and `stop()` methods share one cancellation and
world-action coordination boundary.

`src/trusted_local_operator_console.js` provides a deliberately small,
same-process operator interface. After **a trusted bootstrap has constructed a
signed secure runtime**, instantiate
`createTrustedLocalOperatorConsole(runtime)` and optionally attach it with
`attachTrustedLocalOperatorStdin(operator)` to a real local TTY. Piped stdin
is rejected. Supported Spanish commands are `estado`, `inventario`,
`sigueme`, `siguiente`, `mision`, `para`, `ayuda`, `salir`
(English equivalents also accepted). Unknown commands, coordinates supplied
by the user, multiline instructions and shell/game commands are rejected.
The mission and chest are **preapproved**, not picked from chat or CLI text.

`para` immediately cancels active navigation and records journal cancellation;
it is not queued behind a slow remote check. EOF triggers the same fail-closed
stop. Each follow permit can be attempted once and expires promptly.
Interrupted or uncertain journal steps **cannot automatically resume**.

**Security limit:** a local TTY does not authenticate a Minecraft account.
The constructor requires independently obtained signed proofs, operator
permissions, Fabric live presence, and the registry checkpoint witness.
The current QA harness generates synthetic lab keys for these inputs;
it does not provide an onboarding path for real users or a standalone
public server configuration. `npm start` remains the deliberately restricted
legacy QA CLI, and no production command surface is enabled.

## Offline principal-key onboarding and revocation (independent QA handoff)

A separate, non-Minecraft CLI now supports an **offline three-signature
enrollment ceremony**: a principal-signed Ed25519 key-possession request;
an independently approved operator-signed ticket; and final principal
consent bound to that exact ticket. Files must be outside the repository,
in owner-private directories, and key pairs are provisioned separately.
The operator's approval or revocation signature requires an interactive
local TTY, an exact confirmation string and an independently reviewed
identity/key fingerprint. This is a QA workflow, **not online Minecraft
authentication**. No grants, sessions, bots, or world actions are issued.

Use `npm run principal:offline-qa -- ...` and see the documented modes and
limits in [OFFLINE_PRINCIPAL_HANDOFF_QA_2026-10-30.md](../docs/OFFLINE_PRINCIPAL_HANDOFF_QA_2026-10-30.md).
The verified handoff is compatible with the existing restricted
`openQaPrincipalRegistry.applySignedChange` call but **does not register
anything itself**. An independently signed revocation ticket can be
verified in read-only mode and later applied by the authorized QA
registry to deny future sessions and prevent ID reuse. Private keys
are never generated by this CLI, printed, or written into Git.

A terminal prompt or a key signature alone does not prove who a real
player is. Real Minecraft account authentication, externally hosted trust
anchors and a deployable authenticated operator runtime remain blocked.

## Enrollment-bound signed Fabric session (QA only)

`src/qa_principal_session_binding.js` uses an independently enrolled
principal Ed25519 private key, real signed Fabric JOIN/DISCONNECT audit
reader, fresh signed live-presence authority and separately pinned
checkpoint witness to mint a short-lived **session proof only**. It
rechecks all authorities after network awaits to prevent issuing a
session following revocation, connection loss or challenge rotation.
The output passes the existing `verifySessionBundle` checks.

See [QA_PRINCIPAL_SESSION_BINDING_2026-10-30.md](../docs/QA_PRINCIPAL_SESSION_BINDING_2026-10-30.md)
for the complete verified scope and negative tests. The local lab's
offline-mode nickname/UUID cannot establish a Microsoft/Minecraft
account identity. The local-only QA operator launcher has now passed
real Fabric 1.21.1 integration, but remains a lab-only tool, not a
general gameplay release. External identity and witness remain blocked.

## Pre-enrolled principal + standalone signed operator (QA only)

The new `qa_operator.js` unifies existing registry, bridge, live
presence, signed remote checkpoint, owner-key session, durable journals,
one-use Ed25519 grants and the restricted local operator console.

`npm run operator:qa -- --qa-preflight /tmp/guiaia-operator-qa-EXAMPLE/config.json`
verifies a pre-provisioned session in a separate Node process, **without
connecting a bot or enabling world actions**. A matching config file
with previously approved journals and externally signed grants can be
used with `--qa-operate`, which additionally requires a local TTY.
No new principals, grants or worlds are created by the launcher.

The integration passed signed TCP and HTTP checkpoint preflight as well
as a **real disposable Fabric 1.21.1 gather/deposit from a local TTY**,
with durable receipts, one-use grant spending, second-client chest
verification and exit code 0. A follow-up in the same real Fabric QA world
also revokes the enrolled principal, advances the signed checkpoint and
confirms that a new, separate preflight process refuses the old credential
without changing journals or chest contents. The operator and principal keys
are still synthetic QA signers, and the witness still runs on loopback.
See [QA_INTEGRATED_OPERATOR_BOOT_2026-10-30.md](../docs/QA_INTEGRATED_OPERATOR_BOOT_2026-10-30.md)
and [the actual Fabric evidence](../docs/GUIAIA_STANDALONE_REAL_FABRIC_QA_2026-10-30.md).

### In-flight revocation guards

The signed QA chest adapter now rechecks principal revocation, live Fabric
presence and pinned checkpoint **after async chest opening, immediately before
transfer**. Gather already rechecks after movement. Three deterministic
integration tests cover signed revocation during chest opening or movement and
witness withdrawal: no extra world mutation, no fake receipt or automatic
nonce reuse. See [QA_INFLIGHT_REVOCATION_2026-10-30.md](../docs/QA_INFLIGHT_REVOCATION_2026-10-30.md).
These race tests inject a simulated bot. **Separately**, the standalone QA
operator has now passed an actual Fabric 1.21.1 integration: a second Node
process submitted a signed revocation while its registry lock was held;
the running operator cancelled the undelivered chest step, advanced the
locally hosted signed witness and refused another step. The chest contained
zero deposited logs. See
[QA_EXTERNAL_LIVE_REVOCATION_2026-10-31.md](../docs/QA_EXTERNAL_LIVE_REVOCATION_2026-10-31.md).
This remains offline, localhost QA—not remote-host or account authentication.

### Standalone checkpoint witness (QA only)

`node companion/qa_witness.js --qa-serve /tmp/guiaia-witness-config-qa-EXAMPLE/config.json`
starts an isolated **separate Node process** holding its own Ed25519
witness private key. The JSON config requires version `1`, `sandboxOnly: true`,
`worldId`, disposable `directory`, `operatorPublicKeyFile` and
`witnessPrivateKeyFile`. It must be private (0700 parent, 0600 files).
The service binds only `127.0.0.1` and accepts only signed checkpoint CAS;
it does **not** have the operator or principal private keys and must not
be exposed directly over a network. The launcher's actual real-Fabric QA
mode was retested using `GUIAIA_QA_STANDALONE_WITNESS=1`, with physical
chest verification, durable receipts, signed revocation and code 0.
Read [the evidence and limitations](../docs/QA_STANDALONE_WITNESS_2026-10-31.md).
A different *process* is verified; a different *computer* is not yet verified.

### Future cross-host witness: SSH offline preflight only

`node qa_witness_tunnel_check.js --qa-check /tmp/guiaia-witness-tunnel-qa-EXAMPLE/config.json`
validates a **private, synthetic QA** SSH configuration without making a
connection. It requires a pinned Ed25519 SSH host key and a locally valid
private OpenSSH identity, exact host/port, restricted loopback forwarding
settings and pinned operator/witness public keys. The output explicitly
reports `connected:false`. It does not start SSH, create a tunnel, or make
the witness available on another machine. See
[QA_SSH_TUNNEL_OFFLINE_PREFLIGHT_2026-11-02.md](../docs/QA_SSH_TUNNEL_OFFLINE_PREFLIGHT_2026-11-02.md).
An actual second host, authenticated transport and failure tests are pending.

### Real Fabric witness-outage and restart QA

The disposable `scripts/qa_signed_delivery_real_server.py --standalone-witness-outage`
scenario shuts down the independently running, loopback-only QA checkpoint
witness **after one physically confirmed gather** and before the signed chest
deposit. It demands an authorization denial with no inventory mutation or
false deposit receipt. A clean witness restart must recover its signed
checkpoint and allow a new identity-only preflight, without automatically
replaying the cancelled world action. This test passed against real Fabric
1.21.1 with synthetic offline identities. It is **not** a cross-host witness
outage test. See [the evidence](../docs/QA_REAL_FABRIC_WITNESS_OUTAGE_2026-11-02.md).

### Two physical hosts in a real disposable Fabric mission (QA)

The `--physical-witness-outage` scenario has now completed on real isolated
Fabric 1.21.1 with the independent signing witness on **Durán WSL2** and the
enrolled offline operator on the Chromebook. The test-only
`qa_physical_witness_proxy.js` pins the tailnet HTTPS certificate/SNI and
uses a client-side outage marker to cut network access after an authorized
physical gather, before a chest deposit. The operator denied the deposit,
left zero items in the chest, durably cancelled the action and confirmed the
same remote signed checkpoint after transport restoration, with no automatic
replay. The full Node regression passed **368/368**, Python **58/58**.
This **does not** claim a full Durán outage, Microsoft authentication,
Cobblemon compatibility or production readiness. See
[physical witness Fabric evidence](../docs/QA_REAL_FABRIC_PHYSICAL_WITNESS_2026-11-02.md).

### Windows native vs Ubuntu WSL2 credential safety (QA)

Native Windows supports the dependency installation, most Node tests and
Python tests, but **must not be used to store or load QA private signing keys**
with the current POSIX-mode-based utilities. The external witness CLI,
SSH tunnel preflight and offline principal handoff explicitly deny native
Windows until verified NTFS ACL isolation exists. Use Linux/Ubuntu WSL2 for
these QA ceremonies with private directories and mode-0600 files instead.
On 2026-11-02, independently transferred Git-archive sources passed the full
Node suite on Durán WSL2 (364/364) and the native Windows test suite with
362 passed, 2 Linux-PTY skips and 0 failures. Python: 58/58 on both.
The witness-in-another-host test is **not complete**: TCP/443 from the
Chromebook to Durán's tailnet HTTPS listener timed out despite Tailscale
ping and file transfer success. See
[the cross-host acceptance report](../docs/QA_CROSS_HOST_DURAN_WINDOWS_WSL_2026-11-02.md).

### Physically separate QA witness: signed cross-host checkpoint verified

On 2026-11-02, an Ed25519 signing witness ran in Durán Ubuntu WSL2 while
the operator's separate signing key stayed on the Chromebook. With Tailscale
Serve **HTTPS tailnet-only** and `tailscale nc` (Chromebook user-space
networking), the standard pinned checkpoint client verified signed CAS
bootstrap (sequence 0), update (sequence 1), forged/replayed ticket denial,
wrong witness key denial, rollback denial, outage fail-closed and recovery.
The HTTPS certificate was validated without bypass and no public Funnel was
enabled. **This is synthetic QA, not a live multiplayer Minecraft session**.
See [the cross-host signed witness report](../docs/QA_SIGNED_WITNESS_PHYSICAL_HOST_2026-11-02.md).
The one-off tunnel and signing secrets must not be deployed as a product.
A subsequent physical two-host test also restarted the **Durán witness process**
with its existing signed head and the same private signer after shutting off
and restoring the tailnet HTTPS link. The Chromebook verified sequence 1,
rejected replay, and denied access during the outage in 1566 ms. All QA keys,
proxies and temporary Tailscale Serve were removed afterwards. This was
**not** a real Fabric mission or a Durán/WSL reboot. See
[the physical witness restart evidence](../docs/QA_REMOTE_WITNESS_PROCESS_RESTART_2026-11-02.md).

### Cobblemon 1.8.2 / Minecraft Fabric 1.21.1 (isolated QA)

The disposable `scripts/qa_fabric_server.py --cobblemon <jar> --cobblemon-smoke`
scenario loaded Cobblemon **and** the real GuiaIA observer, verified a private
read-only snapshot (16 sampled blocks, 1 diamond block and 1 sheep), and
completed the normal MCP tool roundtrip: **PASS**. The Cobblemon JAR identity
is pinned, the server is loopback-only, and the test world is removed.

The separate signed-operator trial did **not** pass: Mineflayer did not
complete player startup with this modded server. An independent probe saw
the server accept a synthetic player, but the Mineflayer `spawn` event timed
out after 16 seconds. The exact protocol cause is **unconfirmed**. No physical
gather, signed chest deposit, Pokémon actions or official online accounts
are validated by this test. Do not bypass identity or checkpoint gates to
work around modded-client incompatibility. See
[the Cobblemon evidence](../docs/QA_COBBLEMON_OBSERVER_2026-11-02.md).
