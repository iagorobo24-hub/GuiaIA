package dev.guia.observer;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;
import java.util.Properties;
import java.util.TreeMap;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.block.BlockState;
import net.minecraft.entity.Entity;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.registry.Registries;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.util.TypeFilter;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Box;
import net.minecraft.world.World;
import net.minecraft.world.chunk.Chunk;
import net.minecraft.world.chunk.ChunkStatus;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Experimental Fabric 1.21.1 read-only world observer.
 *
 * Never writes to the Minecraft world, runs a command, sees player identities,
 * loads an unloaded chunk, starts a server socket or exports raw private NBT.
 *
 * This implementation is opt-in, intentionally bounded and isolated from GuiaCore.
 */
public final class GuiaWorldObserver implements ModInitializer {
    private static final Logger LOG = LoggerFactory.getLogger("guiaia_world_observer");
    private static final int BLOCK_SAMPLE_CAP = 16;
    private static final int ENTITY_SAMPLE_CAP = 64;
    private static final int TYPE_COUNT_CAP = 16;
    private static final Path GAME = FabricLoader.getInstance().getGameDir();
    private static final Path CONFIG = GAME.resolve("config/guiaia-observer.properties");
    private static final Path OUTPUT_DIR = GAME.resolve("config/guiaia-observer");
    private static final Path OUTPUT = OUTPUT_DIR.resolve("snapshot.json");

    private record Settings(int x, int y, int z, int interval) {}

    @Override
    public void onInitialize() {
        // No files are created, no events are sampled, and no world is read by default.
        Settings s = readSettings();
        if (s == null) {
            LOG.info("GuiaIA World Observer disabled (explicit config required)");
            return;
        }
        ServerTickEvents.END_SERVER_TICK.register(server -> {
            if (server.getTicks() % s.interval() != 0) return;
            try {
                String snapshot = observe(server, s);
                writeAtomic(snapshot);
            } catch (Exception e) {
                // No secrets, coordinates or player identities in logs.
                LOG.warn("GuiaIA observer sampling unavailable; snapshot not advanced ({})",
                        e.getClass().getSimpleName());
            }
        });
        LOG.info("GuiaIA World Observer enabled in bounded, read-only mode");
    }

    private static Settings readSettings() {
        if (!Files.isRegularFile(CONFIG, LinkOption.NOFOLLOW_LINKS)
                || Files.isSymbolicLink(CONFIG)) return null;
        try {
            if (Files.size(CONFIG) > 2048) return null;
            Properties p = new Properties();
            try (var input = Files.newInputStream(CONFIG)) {
                p.load(input);
            }
            if (!"true".equals(p.getProperty("enabled", "").strip())) return null;
            if (!"minecraft:overworld".equals(p.getProperty("dimension", "").strip())) {
                LOG.warn("GuiaIA observer: only the overworld is supported in this preview");
                return null;
            }
            int x = Integer.parseInt(p.getProperty("center_x", ""));
            int y = Integer.parseInt(p.getProperty("center_y", ""));
            int z = Integer.parseInt(p.getProperty("center_z", ""));
            int interval = Integer.parseInt(p.getProperty("interval_ticks", "200"));
            if (Math.abs((long)x) > 29_000_000 || Math.abs((long)z) > 29_000_000
                    || y < -64 || y > 319 || interval < 200 || interval > 72000) {
                LOG.warn("GuiaIA observer: invalid config bounds; disabled");
                return null;
            }
            return new Settings(x, y, z, interval);
        } catch (IOException | NumberFormatException e) {
            LOG.warn("GuiaIA observer: cannot read config; disabled");
            return null;
        }
    }

    private static String observe(MinecraftServer server, Settings s) {
        // This callback runs on the server thread. It never requests chunk generation.
        ServerWorld world = server.getWorld(World.OVERWORLD);
        if (world == null) throw new IllegalStateException("World not loaded");
        int cx = Math.floorDiv(s.x(), 16);
        int cz = Math.floorDiv(s.z(), 16);
        int loaded = 0;
        int sampled = 0;
        boolean capped = false;
        Map<String, Integer> blocks = new TreeMap<>();
        Map<String, Integer> entities = new TreeMap<>();
        if (world.getChunkManager().isChunkLoaded(cx, cz)) {
            Chunk chunk = world.getChunkManager().getChunk(cx, cz, ChunkStatus.FULL, false);
            if (chunk != null) {
                loaded = 1;
                int chunkX = cx * 16;
                int chunkZ = cz * 16;
                for (int i = 0; i < BLOCK_SAMPLE_CAP; i++) {
                    int bx = chunkX + ((i * 3) & 15);
                    int bz = chunkZ + ((i * 7) & 15);
                    BlockState state = chunk.getBlockState(new BlockPos(bx, s.y(), bz));
                    String id = safeId(Registries.BLOCK.getId(state.getBlock()).toString());
                    if (id != null) blocks.merge(id, 1, Integer::sum);
                    sampled++;
                }
                // Cap entity collection *before* iteration, rather than retrieving a full list.
                var batch = new ArrayList<Entity>(ENTITY_SAMPLE_CAP);
                Box area = new Box(chunkX, s.y() - 8, chunkZ,
                        chunkX + 16, s.y() + 9, chunkZ + 16);
                world.collectEntitiesByType(
                        TypeFilter.instanceOf(Entity.class),
                        area,
                        entity -> !(entity instanceof PlayerEntity),
                        batch,
                        ENTITY_SAMPLE_CAP);
                capped = batch.size() == ENTITY_SAMPLE_CAP;
                for (Entity entity : batch) {
                    String id = safeId(Registries.ENTITY_TYPE.getId(entity.getType()).toString());
                    if (id != null) entities.merge(id, 1, Integer::sum);
                }
            }
        }
        // Recent server tick timings are nanoseconds. This is a sample, NOT authoritative TPS.
        long total = 0;
        int count = 0;
        for (long nanos : server.getTickTimes()) {
            if (nanos > 0 && nanos <= 1_000_000_000L) {
                total += nanos;
                count++;
            }
        }
        double mspt = count > 0 ? (total / (double)count) / 1_000_000.0 : -1;
        StringBuilder json = new StringBuilder(1024);
        json.append('{')
            .append("\"schema_version\":1,")
            .append("\"source\":\"fabric_loaded_chunks\",")
            .append("\"dimension\":\"minecraft:overworld\",")
            .append("\"game_ticks\":").append(server.getTicks()).append(',')
            .append("\"sample_epoch_ms\":").append(System.currentTimeMillis()).append(',')
            .append("\"players_online\":").append(server.getCurrentPlayerCount()).append(',')
            .append("\"chunks_loaded\":").append(loaded).append(',')
            .append("\"blocks_sampled\":").append(sampled).append(',')
            .append("\"entities_loaded\":").append(entities.values().stream().mapToInt(Integer::intValue).sum()).append(',')
            .append("\"entities_capped\":").append(capped).append(',')
            .append("\"sample_scope\":\"one_loaded_chunk_y_band_17\",")
            .append("\"sampled_from_loaded_only\":true,")
            .append("\"player_identifiers_excluded\":true,");
        if (mspt >= 0) json.append("\"mspt_avg\":").append(Math.round(mspt * 100.0) / 100.0).append(',');
        appendCounts(json, "block_counts", blocks);
        json.append(',');
        appendCounts(json, "entity_counts", entities);
        return json.append('}').toString();
    }

    private static void appendCounts(StringBuilder json, String field, Map<String,Integer> values) {
        json.append('"').append(field).append("\":{");
        int count = 0;
        for (var entry : values.entrySet()) {
            if (count >= TYPE_COUNT_CAP) break;
            if (count++ > 0) json.append(',');
            json.append('"').append(entry.getKey()).append("\":").append(entry.getValue());
        }
        json.append('}');
    }

    private static String safeId(String raw) {
        if (raw == null || raw.length() > 72 || !raw.matches("[a-z0-9_.-]+:[a-z0-9_./-]+")) {
            return null;
        }
        return raw;
    }

    private static void writeAtomic(String contents) throws IOException {
        if (contents.length() > 8192
                || Files.isSymbolicLink(OUTPUT_DIR) || Files.isSymbolicLink(OUTPUT)) {
            throw new IOException("Output path invalid");
        }
        Files.createDirectories(OUTPUT_DIR);
        Path temp = Files.createTempFile(OUTPUT_DIR, "snapshot-", ".tmp");
        try {
            try {
                Files.setPosixFilePermissions(temp, PosixFilePermissions.fromString("rw-------"));
            } catch (UnsupportedOperationException ignored) {
                // Non-POSIX filesystem: operator must secure the containing directory.
            }
            Files.writeString(temp, contents, StandardCharsets.UTF_8,
                    StandardOpenOption.TRUNCATE_EXISTING);
            Files.move(temp, OUTPUT, StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException e) {
            Files.deleteIfExists(temp);
            throw e;
        }
    }
}
