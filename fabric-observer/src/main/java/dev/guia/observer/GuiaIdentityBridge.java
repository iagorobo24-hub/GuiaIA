package dev.guia.observer;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.SecureRandom;
import java.security.Signature;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.Base64;
import java.util.IdentityHashMap;
import java.util.concurrent.ConcurrentHashMap;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import java.util.Map;
import java.util.Properties;
import java.util.UUID;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.server.network.ServerPlayNetworkHandler;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Opt-in, local-only and QA-only server-side connection attestation.
 * This NEVER authenticates an offline Minecraft username or client account.
 * The signed connection proof must be combined with an independently enrolled
 * player's challenge signature and operator authorization before any action.
 */
public final class GuiaIdentityBridge implements ModInitializer {
    private static final Logger LOG = LoggerFactory.getLogger("guiaia_identity_bridge");
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final long TTL_MS = 45000;
    private static final long MAX_EVENTS_BYTES = 131072;
    private static final Path GAME = FabricLoader.getInstance().getGameDir();
    private static final Path CONFIG_DIR = GAME.resolve("config");
    private static final Path CONFIG = CONFIG_DIR.resolve("guiaia-identity-bridge.properties");
    private static final Path PRIVATE_KEY = CONFIG_DIR.resolve("guiaia-identity-key.pk8");
    private static final Path OUTPUT_DIR = CONFIG_DIR.resolve("guiaia-identity-bridge");
    private static final Path EVENTS = OUTPUT_DIR.resolve("events.jsonl");
    private final Map<ServerPlayNetworkHandler, Connection> sessions = new IdentityHashMap<>();
    private Settings settings;
    private GuiaLiveSessionQuery liveQuery;
    private final Map<String, Boolean> liveConnections = new ConcurrentHashMap<>();

    private record Settings(String worldId, PrivateKey privateKey) {}
    private record Connection(String worldId, String username, String id, String challenge) {}

    @Override
    public void onInitialize() {
        settings = readSettings();
        if (settings == null) {
            LOG.info("GuiaIA Identity Bridge disabled (isolated explicit QA setup required)");
            return;
        }
        try {
            // Startup resets *only the disposable bridge's event stream*.
            // A prior JVM's join MUST NOT be considered live after restart.
            ensurePrivateDirectory(OUTPUT_DIR);
            if (Files.isSymbolicLink(EVENTS)) throw new IOException("Unsafe event file");
            Files.writeString(EVENTS, "", java.nio.charset.StandardCharsets.US_ASCII,
                    StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
            privateFile(EVENTS);
            liveQuery = new GuiaLiveSessionQuery(settings.worldId(),
                    settings.privateKey(), liveConnections::containsKey);
        } catch (Exception e) {
            settings = null;
            if (liveQuery != null) { liveQuery.close(); liveQuery = null; }
            LOG.warn("GuiaIA Identity Bridge disabled: cannot initialize QA audit or presence listener");
            return;
        }
        ServerLifecycleEvents.SERVER_STOPPING.register(server -> {
            liveConnections.clear();
            if (liveQuery != null) liveQuery.close();
        });
        ServerPlayConnectionEvents.JOIN.register((handler, sender, server) -> {
            try { joined(handler); }
            catch (Exception e) {
                // No player names, signatures or keys in logs.
                LOG.warn("GuiaIA bridge JOIN attestation unavailable ({})",
                        e.getClass().getSimpleName());
            }
        });
        ServerPlayConnectionEvents.DISCONNECT.register((handler, server) -> {
            try { disconnected(handler); }
            catch (Exception e) {
                LOG.warn("GuiaIA bridge DISCONNECT attestation unavailable ({})",
                        e.getClass().getSimpleName());
            }
        });
        LOG.info("GuiaIA Identity Bridge enabled in isolated read-only QA mode");
    }

    private static Settings readSettings() {
        try {
            // Hard production guard. Cannot enable outside specifically
            // named disposable test directories even if properties copied.
            String location = GAME.toRealPath().toString();
            if (!location.startsWith("/tmp/guiaia-fabric-bridge-qa-") ||
                    Files.isSymbolicLink(CONFIG_DIR) ||
                    !Files.isRegularFile(CONFIG, LinkOption.NOFOLLOW_LINKS) ||
                    !Files.isRegularFile(PRIVATE_KEY, LinkOption.NOFOLLOW_LINKS) ||
                    Files.size(CONFIG) > 2048 ||
                    Files.size(PRIVATE_KEY) < 40 ||
                    Files.size(PRIVATE_KEY) > 256) return null;
            Properties p = new Properties();
            try (var in = Files.newInputStream(CONFIG)) { p.load(in); }
            if (!"true".equals(p.getProperty("enabled")) ||
                    !"true".equals(p.getProperty("qa_only"))) return null;
            String worldId = p.getProperty("world_id", "");
            if (!worldId.matches("[A-Za-z0-9:_-]{1,64}")) return null;
            // Operators generate PKCS#8 Ed25519 DER outside the JVM and
            // install it with 0600 permissions inside disposable config.
            if (!Files.getPosixFilePermissions(PRIVATE_KEY).equals(
                    PosixFilePermissions.fromString("rw-------"))) return null;
            byte[] encoded = Files.readAllBytes(PRIVATE_KEY);
            PrivateKey key;
            try {
                key = KeyFactory.getInstance("Ed25519")
                        .generatePrivate(new PKCS8EncodedKeySpec(encoded));
            } finally {
                java.util.Arrays.fill(encoded, (byte) 0);
            }
            return new Settings(worldId, key);
        } catch (Exception e) {
            return null;
        }
    }

    private void joined(ServerPlayNetworkHandler handler) throws Exception {
        String username = handler.player.getName().getString();
        if (!username.matches("[A-Za-z0-9_]{3,16}")) return;
        // Keys are the actual *server network handlers*, never username/UUID.
        Connection old = sessions.remove(handler);
        if (old != null) {
            liveConnections.remove(old.id());
            emit("disconnect", old);
        }
        String id = UUID.randomUUID().toString();
        byte[] bytes = new byte[24];
        RANDOM.nextBytes(bytes);
        StringBuilder challenge = new StringBuilder(48);
        for (byte value : bytes) challenge.append(String.format("%02x", value & 0xff));
        java.util.Arrays.fill(bytes, (byte) 0);
        Connection current = new Connection(settings.worldId(), username,
                id, challenge.toString());
        // Durable proof first; do not advertise a connection in memory when
        // the private audit output cannot be committed.
        emit("join", current);
        sessions.put(handler, current);
        liveConnections.put(current.id(), Boolean.TRUE);
    }

    private void disconnected(ServerPlayNetworkHandler handler) throws Exception {
        Connection current = sessions.remove(handler);
        if (current != null) {
            // Revoke live presence before touching the potentially failing journal.
            liveConnections.remove(current.id());
            emit("disconnect", current);
        }
    }

    private void emit(String event, Connection c) throws Exception {
        if (settings == null) throw new IllegalStateException("Bridge disabled");
        long now = System.currentTimeMillis();
        String audience = event.equals("join") ? "guiaia:server-connection:v1"
                : "guiaia:server-disconnect:v1";
        // Exact property order matches the verifier's JSON.stringify().
        // Values are constrained to safe ASCII by validation/generation.
        String payload = "{"
                + "\"aud\":\"" + audience + "\","
                + "\"worldId\":\"" + c.worldId() + "\","
                + "\"connectionId\":\"" + c.id() + "\","
                + "\"username\":\"" + c.username() + "\","
                + "\"challenge\":\"" + c.challenge() + "\","
                + "\"issuedAt\":" + now + ","
                + "\"expiresAt\":" + (now + TTL_MS) + "}";
        Signature signer = Signature.getInstance("Ed25519");
        signer.initSign(settings.privateKey());
        signer.update(payload.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        String signature = Base64.getUrlEncoder().withoutPadding()
                .encodeToString(signer.sign());
        String line = "{\"event\":\"" + event + "\",\"payload\":"
                + payload + ",\"signature\":\"" + signature + "\"}\n";
        byte[] data = line.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        if (data.length > 1024 || Files.isSymbolicLink(EVENTS) ||
                !Files.isRegularFile(EVENTS, LinkOption.NOFOLLOW_LINKS)) {
            throw new IOException("Unsafe identity audit file");
        }
        try (FileChannel file = FileChannel.open(EVENTS,
                StandardOpenOption.APPEND, StandardOpenOption.WRITE,
                LinkOption.NOFOLLOW_LINKS)) {
            if (file.size() + data.length > MAX_EVENTS_BYTES)
                throw new IOException("Identity event audit full: fail closed");
            ByteBuffer buffer = ByteBuffer.wrap(data);
            while (buffer.hasRemaining()) file.write(buffer);
            file.force(true);
        }
    }

    private static void ensurePrivateDirectory(Path directory) throws IOException {
        if (Files.isSymbolicLink(CONFIG_DIR) || Files.isSymbolicLink(directory))
            throw new IOException("Unsafe bridge directory");
        Files.createDirectories(directory);
        Files.setPosixFilePermissions(directory,
                PosixFilePermissions.fromString("rwx------"));
    }

    private static void privateFile(Path file) throws IOException {
        Files.setPosixFilePermissions(file,
                PosixFilePermissions.fromString("rw-------"));
    }
}
