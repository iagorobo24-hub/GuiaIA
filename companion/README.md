# GuiaIA Companion — first playable QA prototype

**Not a player-ready or secure multiplayer release.** This experiment uses upstream Mineflayer + mineflayer-pathfinder in **Minecraft Java 1.21.1**, but currently connects **only to a local, disposable offline-mode QA server on 127.0.0.1:25598**.

## What works in this initial prototype

- Real Minecraft Java bot connection/respawn, via a separately installable Node.js process.
- Local-operator-only `follow`, `stop` and `status` input commands; no AI model can issue commands yet.
- Only follows an owner entity *visible within 18 blocks*, with adequate health; continuous safety check aborts if the owner is lost/out of range.
- Following uses pathfinding with digging, tower-building, door-opening, free motion, parkour and sprinting disabled.
- No RCON, chat command execution, mining, item collection, building, attacks or filesystem/world saves managed by this component.

**No reliable player identity in offline mode.** The simple username match is only safe inside a loopback-isolated throwaway laboratory controlled by the operator. Never publish the port or point it at Teselia; any real online server integration needs an authenticated account/UUID owner binding, deny-by-default actions and independent approval.

## Unit tests (Node 22+)

```sh
cd companion
npm ci --ignore-scripts
npm test
```

For launch, the script intentionally requires `GUIAIA_QA_OWNER` and an explicit `--qa-local-only` argument, and connects to port 25598. The stdin protocol accepts only `follow`, `stop`, `status`, `quit`, with one command per line.

**Production and public distribution are blocked** pending a genuine local in-game follow/stop demonstration, stable recovery from disconnection, terrain hazard policy, owner authentication and integration tests under Fabric/Cobblemon. For design context see [Issue #2](https://github.com/iagorobo24-hub/GuiaIA/issues/2).
