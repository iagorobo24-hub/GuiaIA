# World Observer boundary

The public MCP gateway's `guia_world_observe` tool consumes a **local, authenticated-by-file-access** and **fresh** read-only snapshot from the separate Fabric mod prototype.

The emitter and consumer agree on schema 1: `source=fabric_loaded_chunks`, `dimension=minecraft:overworld`, `game_ticks`, `sample_epoch_ms`, `chunks_loaded<=1`, `blocks_sampled<=16`, `entities_loaded<=64`, `entities_capped`, `block_counts`, `entity_counts` and privacy provenance booleans.

The consumer rejects a file bigger than 8 KiB, malformed data, duplicate JSON keys, symlinks, stale samples (>120 s), future samples (>15 s), invalid Minecraft registry IDs and unsupported dimensions.

The counts are an **incomplete sample of one operator-configured loaded chunk**, not a claim that the AI can see everything, locate rare ores or inspect arbitrary unloaded regions. No player names/UUIDs, chat or coordinates are returned. The mod is disabled unless separately configured by the operator.

Only use in a disposable QA world until a real integration test and review validates read behavior, performance and privacy. The dedicated production Teselia instance is explicitly excluded from this phase.

## Sources and version checks

- Fabric Yarn 1.21.1+build.3 ServerChunkManager documents loaded-chunk methods: https://maven.fabricmc.net/docs/yarn-1.21.1+build.3/net/minecraft/server/world/ServerChunkManager.html
- MinecraftServer tick times and getTicks: https://maven.fabricmc.net/docs/yarn-1.21.1+build.3/net/minecraft/server/MinecraftServer.html
- Fabric development instructions: https://docs.fabricmc.net/
